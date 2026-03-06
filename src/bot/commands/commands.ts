import { CommandContext, Context, InlineKeyboard } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { getCurrentProject } from "../../settings/manager.js";
import {
  clearSession,
  getCurrentSession,
  setCurrentSession,
  type SessionInfo,
} from "../../session/manager.js";
import { ingestSessionInfoForCache } from "../../session/cache-manager.js";
import { interactionManager } from "../../interaction/manager.js";
import type { InteractionState } from "../../interaction/types.js";
import { summaryAggregator } from "../../summary/aggregator.js";
import { getStoredAgent } from "../../agent/manager.js";
import { getStoredModel } from "../../model/manager.js";
import { safeBackgroundTask } from "../../utils/safe-background-task.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { getScopeFromContext, getScopeKeyFromContext, getThreadSendOptions } from "../scope.js";

const COMMANDS_CALLBACK_PREFIX = "commands:";
const COMMANDS_CALLBACK_SELECT_PREFIX = `${COMMANDS_CALLBACK_PREFIX}select:`;
const COMMANDS_CALLBACK_CANCEL = `${COMMANDS_CALLBACK_PREFIX}cancel`;
const COMMANDS_CALLBACK_EXECUTE = `${COMMANDS_CALLBACK_PREFIX}execute`;
const MAX_INLINE_BUTTON_LABEL_LENGTH = 64;

interface CommandItem {
  name: string;
  description?: string;
}

interface CommandsListMetadata {
  flow: "commands";
  stage: "list";
  messageId: number;
  projectDirectory: string;
  commands: CommandItem[];
}

interface CommandsConfirmMetadata {
  flow: "commands";
  stage: "confirm";
  messageId: number;
  projectDirectory: string;
  commandName: string;
}

type CommandsMetadata = CommandsListMetadata | CommandsConfirmMetadata;

interface ExecuteCommandParams {
  projectDirectory: string;
  commandName: string;
  argumentsText: string;
}

export interface ExecuteCommandDeps {
  ensureEventSubscription: (directory: string) => Promise<void>;
}

function formatExecutingCommandMessage(commandName: string, args: string): string {
  const commandText = `／${commandName}`;
  const argsSuffix = args ? ` ${args}` : "";
  return `${t("commands.executing_prefix")}\n${commandText}${argsSuffix}`;
}

function normalizeDirectoryForCommandApi(directory: string): string {
  return directory.replace(/\\/g, "/");
}

function getCallbackMessageId(ctx: Context): number | null {
  const message = ctx.callbackQuery?.message;
  if (!message || !("message_id" in message)) {
    return null;
  }

  const messageId = (message as { message_id?: number }).message_id;
  return typeof messageId === "number" ? messageId : null;
}

function formatCommandButtonLabel(command: CommandItem): string {
  const description = command.description?.trim() || t("commands.no_description");
  const rawLabel = `/${command.name} - ${description}`;

  if (rawLabel.length <= MAX_INLINE_BUTTON_LABEL_LENGTH) {
    return rawLabel;
  }

  return `${rawLabel.slice(0, MAX_INLINE_BUTTON_LABEL_LENGTH - 3)}...`;
}

function buildCommandsListKeyboard(commands: CommandItem[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  commands.forEach((command, index) => {
    keyboard
      .text(formatCommandButtonLabel(command), `${COMMANDS_CALLBACK_SELECT_PREFIX}${index}`)
      .row();
  });

  keyboard.text(t("commands.button.cancel"), COMMANDS_CALLBACK_CANCEL);
  return keyboard;
}

function buildCommandsConfirmKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(t("commands.button.execute"), COMMANDS_CALLBACK_EXECUTE)
    .text(t("commands.button.cancel"), COMMANDS_CALLBACK_CANCEL);
}

function parseCommandItems(value: unknown): CommandItem[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const commands: CommandItem[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      return null;
    }

    const commandName = (item as { name?: unknown }).name;
    if (typeof commandName !== "string" || !commandName.trim()) {
      return null;
    }

    const description = (item as { description?: unknown }).description;
    commands.push({
      name: commandName,
      description: typeof description === "string" ? description : undefined,
    });
  }

  return commands;
}

function parseCommandsMetadata(state: InteractionState | null): CommandsMetadata | null {
  if (!state || state.kind !== "custom") {
    return null;
  }

  const flow = state.metadata.flow;
  const stage = state.metadata.stage;
  const messageId = state.metadata.messageId;
  const projectDirectory = state.metadata.projectDirectory;

  if (
    flow !== "commands" ||
    typeof messageId !== "number" ||
    typeof projectDirectory !== "string"
  ) {
    return null;
  }

  if (stage === "list") {
    const commands = parseCommandItems(state.metadata.commands);
    if (!commands) {
      return null;
    }

    return {
      flow,
      stage,
      messageId,
      projectDirectory,
      commands,
    };
  }

  if (stage === "confirm") {
    const commandName = state.metadata.commandName;
    if (typeof commandName !== "string" || !commandName.trim()) {
      return null;
    }

    return {
      flow,
      stage,
      messageId,
      projectDirectory,
      commandName,
    };
  }

  return null;
}

function clearCommandsInteraction(reason: string, scopeKey: string): void {
  const metadata = parseCommandsMetadata(interactionManager.getSnapshot(scopeKey));
  if (metadata) {
    interactionManager.clear(reason, scopeKey);
  }
}

async function getCommandList(projectDirectory: string): Promise<CommandItem[]> {
  const { data, error } = await opencodeClient.command.list({
    directory: normalizeDirectoryForCommandApi(projectDirectory),
  });

  if (error || !data) {
    throw error || new Error("No command data received");
  }

  return data
    .filter((command) => typeof command.name === "string" && command.name.trim().length > 0)
    .map((command) => ({
      name: command.name,
      description: command.description,
    }));
}

function parseSelectIndex(data: string): number | null {
  if (!data.startsWith(COMMANDS_CALLBACK_SELECT_PREFIX)) {
    return null;
  }

  const rawIndex = data.slice(COMMANDS_CALLBACK_SELECT_PREFIX.length);
  const index = Number(rawIndex);

  if (!Number.isInteger(index) || index < 0) {
    return null;
  }

  return index;
}

async function isSessionBusy(sessionId: string, directory: string): Promise<boolean> {
  try {
    const { data, error } = await opencodeClient.session.status({ directory });

    if (error || !data) {
      logger.warn("[Commands] Failed to check session status before command:", error);
      return false;
    }

    const sessionStatus = (data as Record<string, { type?: string }>)[sessionId];
    if (!sessionStatus) {
      return false;
    }

    return sessionStatus.type === "busy";
  } catch (err) {
    logger.warn("[Commands] Error checking session status before command:", err);
    return false;
  }
}

async function ensureSessionForProject(
  ctx: Context,
  projectDirectory: string,
): Promise<SessionInfo | null> {
  const scopeKey = getScopeKeyFromContext(ctx);
  let currentSession = getCurrentSession(scopeKey);

  if (currentSession && currentSession.directory !== projectDirectory) {
    logger.warn(
      `[Commands] Session/project mismatch detected. sessionDirectory=${currentSession.directory}, projectDirectory=${projectDirectory}. Resetting session context.`,
    );
    clearSession(scopeKey);
    await ctx.reply(t("bot.session_reset_project_mismatch"));
    currentSession = null;
  }

  if (currentSession) {
    return currentSession;
  }

  await ctx.reply(t("bot.creating_session"));

  const { data: session, error } = await opencodeClient.session.create({
    directory: projectDirectory,
  });

  if (error || !session) {
    await ctx.reply(t("bot.create_session_error"));
    return null;
  }

  const sessionInfo: SessionInfo = {
    id: session.id,
    title: session.title,
    directory: projectDirectory,
  };

  setCurrentSession(sessionInfo, scopeKey);
  summaryAggregator.setSession(sessionInfo.id);
  await ingestSessionInfoForCache(session);
  await ctx.reply(t("bot.session_created", { title: session.title }));

  return sessionInfo;
}

async function executeCommand(
  ctx: Context,
  deps: ExecuteCommandDeps,
  params: ExecuteCommandParams,
): Promise<void> {
  if (!ctx.chat) {
    return;
  }

  const args = params.argumentsText.trim();
  const threadId = getScopeFromContext(ctx)?.threadId ?? null;
  await ctx.reply(formatExecutingCommandMessage(params.commandName, args));

  const session = await ensureSessionForProject(ctx, params.projectDirectory);
  if (!session) {
    return;
  }

  await deps.ensureEventSubscription(session.directory);
  summaryAggregator.setSession(session.id);

  const sessionIsBusy = await isSessionBusy(session.id, session.directory);
  if (sessionIsBusy) {
    await ctx.reply(t("bot.session_busy"));
    return;
  }

  const scopeKey = getScopeKeyFromContext(ctx);
  const currentAgent = getStoredAgent(scopeKey);
  const storedModel = getStoredModel(scopeKey);
  const model =
    storedModel.providerID && storedModel.modelID
      ? `${storedModel.providerID}/${storedModel.modelID}`
      : undefined;

  safeBackgroundTask({
    taskName: "session.command",
    task: () =>
      opencodeClient.session.command({
        sessionID: session.id,
        directory: session.directory,
        command: params.commandName,
        arguments: args,
        agent: currentAgent,
        model,
        variant: storedModel.variant,
      }),
    onSuccess: ({ error }) => {
      if (error) {
        logger.error("[Commands] OpenCode API returned an error for session.command", {
          sessionId: session.id,
          command: params.commandName,
          args,
        });
        logger.error("[Commands] session.command error details:", error);
        void ctx.api
          .sendMessage(ctx.chat!.id, t("commands.execute_error"), getThreadSendOptions(threadId))
          .catch(() => {});
        return;
      }

      logger.info(
        `[Commands] session.command completed: session=${session.id}, command=/${params.commandName}`,
      );
    },
    onError: (error) => {
      logger.error("[Commands] session.command background task failed", {
        sessionId: session.id,
        command: params.commandName,
        args,
      });
      logger.error("[Commands] session.command background failure details:", error);
      void ctx.api
        .sendMessage(ctx.chat!.id, t("commands.execute_error"), getThreadSendOptions(threadId))
        .catch(() => {});
    },
  });
}

export async function commandsCommand(ctx: CommandContext<Context>): Promise<void> {
  try {
    const scopeKey = getScopeKeyFromContext(ctx);
    const currentProject = getCurrentProject(scopeKey);
    if (!currentProject) {
      await ctx.reply(t("bot.project_not_selected"));
      return;
    }

    const commands = await getCommandList(currentProject.worktree);
    if (commands.length === 0) {
      await ctx.reply(t("commands.empty"));
      return;
    }

    const keyboard = buildCommandsListKeyboard(commands);
    const message = await ctx.reply(t("commands.select"), {
      reply_markup: keyboard,
    });

    interactionManager.start(
      {
        kind: "custom",
        expectedInput: "callback",
        metadata: {
          flow: "commands",
          stage: "list",
          messageId: message.message_id,
          projectDirectory: currentProject.worktree,
          commands,
        },
      },
      scopeKey,
    );
  } catch (error) {
    logger.error("[Commands] Error fetching commands list:", error);
    await ctx.reply(t("commands.fetch_error"));
  }
}

export async function handleCommandsCallback(
  ctx: Context,
  deps: ExecuteCommandDeps,
): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith(COMMANDS_CALLBACK_PREFIX)) {
    return false;
  }

  const scopeKey = getScopeKeyFromContext(ctx);
  const metadata = parseCommandsMetadata(interactionManager.getSnapshot(scopeKey));
  const callbackMessageId = getCallbackMessageId(ctx);

  if (!metadata || callbackMessageId === null || metadata.messageId !== callbackMessageId) {
    await ctx.answerCallbackQuery({ text: t("commands.inactive_callback"), show_alert: true });
    return true;
  }

  try {
    if (data === COMMANDS_CALLBACK_CANCEL) {
      clearCommandsInteraction("commands_cancelled", scopeKey);
      await ctx.answerCallbackQuery({ text: t("commands.cancelled_callback") });
      await ctx.deleteMessage().catch(() => {});
      return true;
    }

    if (data === COMMANDS_CALLBACK_EXECUTE) {
      if (metadata.stage !== "confirm") {
        await ctx.answerCallbackQuery({ text: t("commands.inactive_callback"), show_alert: true });
        return true;
      }

      clearCommandsInteraction("commands_execute_clicked", scopeKey);
      await ctx.answerCallbackQuery({ text: t("commands.execute_callback") });
      await ctx.deleteMessage().catch(() => {});

      await executeCommand(ctx, deps, {
        projectDirectory: metadata.projectDirectory,
        commandName: metadata.commandName,
        argumentsText: "",
      });
      return true;
    }

    const commandIndex = parseSelectIndex(data);
    if (commandIndex === null || metadata.stage !== "list") {
      await ctx.answerCallbackQuery({ text: t("callback.processing_error"), show_alert: true });
      return true;
    }

    const selectedCommand = metadata.commands[commandIndex];
    if (!selectedCommand) {
      await ctx.answerCallbackQuery({ text: t("commands.inactive_callback"), show_alert: true });
      return true;
    }

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(t("commands.confirm", { command: `/${selectedCommand.name}` }), {
      reply_markup: buildCommandsConfirmKeyboard(),
    });

    interactionManager.transition(
      {
        expectedInput: "mixed",
        metadata: {
          flow: "commands",
          stage: "confirm",
          messageId: metadata.messageId,
          projectDirectory: metadata.projectDirectory,
          commandName: selectedCommand.name,
        },
      },
      scopeKey,
    );

    return true;
  } catch (error) {
    logger.error("[Commands] Error handling command callback:", error);
    clearCommandsInteraction("commands_callback_error", scopeKey);
    await ctx.answerCallbackQuery({ text: t("callback.processing_error") }).catch(() => {});
    return true;
  }
}

export async function handleCommandTextArguments(
  ctx: Context,
  deps: ExecuteCommandDeps,
): Promise<boolean> {
  const text = ctx.message?.text;
  if (!text || text.startsWith("/")) {
    return false;
  }

  const scopeKey = getScopeKeyFromContext(ctx);
  const metadata = parseCommandsMetadata(interactionManager.getSnapshot(scopeKey));
  if (!metadata || metadata.stage !== "confirm") {
    return false;
  }

  const argumentsText = text.trim();
  if (!argumentsText) {
    await ctx.reply(t("commands.arguments_empty"));
    return true;
  }

  clearCommandsInteraction("commands_arguments_submitted", scopeKey);

  if (ctx.chat) {
    await ctx.api.deleteMessage(ctx.chat.id, metadata.messageId).catch(() => {});
  }

  await executeCommand(ctx, deps, {
    projectDirectory: metadata.projectDirectory,
    commandName: metadata.commandName,
    argumentsText,
  });

  return true;
}
