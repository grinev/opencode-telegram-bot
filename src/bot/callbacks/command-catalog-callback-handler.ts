import type { Bot, Context } from "grammy";
import type { AppContainer } from "../../app/bootstrap/app-container.js";
import { config } from "../../config.js";
import type { CommandCatalogItem } from "../../app/services/command-catalog-service.js";
import {
  clearSession,
  getCurrentSession,
  setCurrentSession,
} from "../../app/services/session-service.js";
import type { SessionInfo } from "../../app/types/session.js";
import { ingestSessionInfoForCache } from "../../app/services/session-cache-service.js";
import type { InteractionState } from "../../app/types/interaction.js";
import { getStoredAgent, resolveProjectAgent } from "../../app/services/agent-selection-service.js";
import { getStoredModel } from "../../app/services/model-selection-service.js";
import { safeBackgroundTask } from "../../utils/safe-background-task.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { cancelMenu } from "./feedback.js";
import {
  attachToSession,
  detachAttachedSession,
  markAttachedSessionBusy,
  markAttachedSessionIdle,
} from "../../app/services/attach-service.js";
import { opencodeClient } from "../../opencode/client.js";
import {
  buildCommandsConfirmKeyboard,
  buildCommandsListKeyboard,
  calculateCommandsPaginationRange,
  COMMANDS_CALLBACK_CANCEL,
  COMMANDS_CALLBACK_EXECUTE,
  COMMANDS_CALLBACK_PREFIX,
  formatCommandsSelectText,
  formatExecutingCommandMessage,
  parseCommandPageCallback,
  parseCommandSelectCallback,
} from "../menus/command-catalog-menu.js";

interface CommandsListMetadata {
  flow: "commands";
  stage: "list";
  messageId: number;
  projectDirectory: string;
  commands: CommandCatalogItem[];
  page: number;
}

interface CommandsConfirmMetadata {
  flow: "commands";
  stage: "confirm";
  messageId: number;
  projectDirectory: string;
  commandName: string;
}

export type CommandsMetadata = CommandsListMetadata | CommandsConfirmMetadata;

export interface ExecuteCommandParams {
  projectDirectory: string;
  commandName: string;
  argumentsText: string;
}

export type ExecuteCommandDeps = Pick<
  AppContainer,
  | "assistantRunState"
  | "attachManager"
  | "ensureEventSubscription"
  | "externalUserInputSuppressionManager"
  | "foregroundSessionState"
  | "interactionManager"
  | "keyboardManager"
  | "permissionManager"
  | "pinnedMessageManager"
  | "questionManager"
  | "resetAggregator"
  | "resetInteractions"
  | "summaryAggregator"
> & {
  bot: Bot<Context>;
};

function getCallbackMessageId(ctx: Context): number | null {
  const message = ctx.callbackQuery?.message;
  if (!message || !("message_id" in message)) {
    return null;
  }

  const messageId = (message as { message_id?: number }).message_id;
  return typeof messageId === "number" ? messageId : null;
}

function parseCommandItems(value: unknown): CommandCatalogItem[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const commands: CommandCatalogItem[] = [];
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

export function parseCommandsMetadata(state: InteractionState | null): CommandsMetadata | null {
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

    const page =
      typeof state.metadata.page === "number" && Number.isInteger(state.metadata.page)
        ? Math.max(0, state.metadata.page)
        : 0;

    return {
      flow,
      stage,
      messageId,
      projectDirectory,
      commands,
      page,
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

export function clearCommandsInteraction(
  deps: Pick<AppContainer, "interactionManager">,
  reason: string,
): void {
  const metadata = parseCommandsMetadata(deps.interactionManager.getSnapshot());
  if (metadata) {
    deps.interactionManager.clear(reason);
  }
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
  deps: ExecuteCommandDeps,
  projectDirectory: string,
): Promise<SessionInfo | null> {
  let currentSession = getCurrentSession();

  if (currentSession && currentSession.directory !== projectDirectory) {
    logger.warn(
      `[Commands] Session/project mismatch detected. sessionDirectory=${currentSession.directory}, projectDirectory=${projectDirectory}. Resetting session context.`,
    );
    detachAttachedSession("session_mismatch_reset", deps);
    clearSession();
    deps.summaryAggregator.clear();
    deps.foregroundSessionState.clearAll("session_mismatch_reset");
    deps.assistantRunState.clearAll("session_mismatch_reset");
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

  setCurrentSession(sessionInfo);
  await ingestSessionInfoForCache(session);
  await ctx.reply(t("bot.session_created", { title: session.title }));

  return sessionInfo;
}

export async function executeCommand(
  ctx: Context,
  deps: ExecuteCommandDeps,
  params: ExecuteCommandParams,
): Promise<void> {
  if (!ctx.chat) {
    return;
  }

  const args = params.argumentsText.trim();
  const executingMessage = formatExecutingCommandMessage(params.commandName, args);
  await ctx.reply(executingMessage.text, { entities: executingMessage.entities });

  const session = await ensureSessionForProject(ctx, deps, params.projectDirectory);
  if (!session) {
    return;
  }

  await attachToSession({
    ...deps,
    chatId: ctx.chat.id,
    session,
  });

  const sessionIsBusy = await isSessionBusy(session.id, session.directory);
  if (sessionIsBusy) {
    await ctx.reply(t("bot.session_busy"));
    return;
  }

  const currentAgent = await resolveProjectAgent(getStoredAgent());
  const storedModel = getStoredModel();
  const model =
    storedModel.providerID && storedModel.modelID
      ? `${storedModel.providerID}/${storedModel.modelID}`
      : undefined;

  deps.foregroundSessionState.markBusy(session.id, session.directory);
  await markAttachedSessionBusy(session.id, deps);
  deps.assistantRunState.startRun(session.id, {
    startedAt: Date.now(),
    configuredAgent: currentAgent,
    configuredProviderID: storedModel.providerID,
    configuredModelID: storedModel.modelID,
  });
  deps.externalUserInputSuppressionManager.register(
    session.id,
    args ? `/${params.commandName} ${args}` : `/${params.commandName}`,
  );

  safeBackgroundTask({
    taskName: "session.command",
    task: () =>
      opencodeClient.session.command({
        sessionID: session.id,
        directory: session.directory,
        command: params.commandName,
        arguments: args,
        agent: currentAgent,
        ...(model !== undefined ? { model } : {}),
        ...(storedModel.variant !== undefined ? { variant: storedModel.variant } : {}),
      }),
    onSuccess: ({ error }) => {
      if (error) {
        deps.foregroundSessionState.markIdle(session.id);
        void markAttachedSessionIdle(session.id, deps);
        deps.assistantRunState.clearRun(session.id, "session_command_api_error");
        logger.error("[Commands] OpenCode API returned an error for session.command", {
          sessionId: session.id,
          command: params.commandName,
          args,
        });
        logger.error("[Commands] session.command error details:", error);
        if (deps.attachManager.isAttachedSession(session.id)) {
          void ctx.api.sendMessage(ctx.chat!.id, t("commands.execute_error")).catch(() => {});
        }
        return;
      }

      logger.info(
        `[Commands] session.command completed: session=${session.id}, command=/${params.commandName}`,
      );
    },
    onError: (error) => {
      deps.foregroundSessionState.markIdle(session.id);
      void markAttachedSessionIdle(session.id, deps);
      deps.assistantRunState.clearRun(session.id, "session_command_background_error");
      logger.error("[Commands] session.command background task failed", {
        sessionId: session.id,
        command: params.commandName,
        args,
      });
      logger.error("[Commands] session.command background failure details:", error);
      if (deps.attachManager.isAttachedSession(session.id)) {
        void ctx.api.sendMessage(ctx.chat!.id, t("commands.execute_error")).catch(() => {});
      }
    },
  });
}

export async function handleCommandsCallback(
  ctx: Context,
  deps: ExecuteCommandDeps,
): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith(COMMANDS_CALLBACK_PREFIX)) {
    return false;
  }

  const metadata = parseCommandsMetadata(deps.interactionManager.getSnapshot());
  const callbackMessageId = getCallbackMessageId(ctx);

  if (!metadata || callbackMessageId === null || metadata.messageId !== callbackMessageId) {
    await ctx.answerCallbackQuery({ text: t("commands.inactive_callback"), show_alert: true });
    return true;
  }

  try {
    if (data === COMMANDS_CALLBACK_CANCEL) {
      clearCommandsInteraction(deps, "commands_cancelled");
      await cancelMenu(ctx);
      return true;
    }

    if (data === COMMANDS_CALLBACK_EXECUTE) {
      if (metadata.stage !== "confirm") {
        await ctx.answerCallbackQuery({ text: t("commands.inactive_callback"), show_alert: true });
        return true;
      }

      clearCommandsInteraction(deps, "commands_execute_clicked");
      await ctx.answerCallbackQuery({ text: t("commands.execute_callback") });
      await ctx.deleteMessage().catch(() => {});

      await executeCommand(ctx, deps, {
        projectDirectory: metadata.projectDirectory,
        commandName: metadata.commandName,
        argumentsText: "",
      });
      return true;
    }

    const page = parseCommandPageCallback(data);
    if (page !== null) {
      if (metadata.stage !== "list") {
        await ctx.answerCallbackQuery({ text: t("callback.processing_error") });
        return true;
      }

      const pageSize = config.bot.commandsListLimit;
      const { page: normalizedPage, totalPages } = calculateCommandsPaginationRange(
        metadata.commands.length,
        page,
        pageSize,
      );

      if (page >= totalPages || page < 0) {
        await ctx.answerCallbackQuery({ text: t("commands.page_empty_callback") });
        return true;
      }

      const keyboard = buildCommandsListKeyboard(metadata.commands, normalizedPage, pageSize);
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(formatCommandsSelectText(normalizedPage), {
        reply_markup: keyboard,
      });

      deps.interactionManager.transition({
        expectedInput: "callback",
        metadata: {
          flow: "commands",
          stage: "list",
          messageId: metadata.messageId,
          projectDirectory: metadata.projectDirectory,
          commands: metadata.commands,
          page: normalizedPage,
        },
      });

      return true;
    }

    const commandIndex = parseCommandSelectCallback(data);
    if (commandIndex === null || metadata.stage !== "list") {
      await ctx.answerCallbackQuery({ text: t("callback.processing_error") });
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

    deps.interactionManager.transition({
      expectedInput: "mixed",
      metadata: {
        flow: "commands",
        stage: "confirm",
        messageId: metadata.messageId,
        projectDirectory: metadata.projectDirectory,
        commandName: selectedCommand.name,
      },
    });

    return true;
  } catch (error) {
    logger.error("[Commands] Error handling command callback:", error);
    clearCommandsInteraction(deps, "commands_callback_error");
    await ctx.answerCallbackQuery({ text: t("callback.processing_error") }).catch(() => {});
    return true;
  }
}
