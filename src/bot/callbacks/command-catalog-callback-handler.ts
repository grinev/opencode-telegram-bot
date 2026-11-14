import type { Bot, Context } from "grammy";
import type { AppContainer } from "../../app/bootstrap/app-container.js";
import { config } from "../../config.js";
import {
  loadCommandCatalog,
  type CommandCatalogItem,
} from "../../app/services/command-catalog-service.js";
import { getCurrentProject } from "../../app/stores/settings-store.js";
import { isForegroundBusy } from "../../app/services/run-control-service.js";
import { replyBusyBlocked } from "../messages/busy-blocked-renderer.js";
import {
  clearSession,
  getCurrentSession,
  setCurrentSession,
} from "../../app/services/session-service.js";
import type { SessionInfo } from "../../app/types/session.js";
import { ingestSessionInfoForCache } from "../../app/services/session-cache-service.js";
import type { InteractionState } from "../../app/types/interaction.js";
import { DEFAULT_ALLOWED_INTERACTION_COMMANDS } from "../../app/managers/interaction-manager.js";
import { getStoredAgent, resolveProjectAgent } from "../../app/services/agent-selection-service.js";
import { getStoredModel } from "../../app/services/model-selection-service.js";
import { safeBackgroundTask } from "../../utils/safe-background-task.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { formatSessionTitle } from "../../app/formatters/session-title-formatter.js";
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
  buildCommandsSearchView,
  calculateCommandsPaginationRange,
  COMMANDS_CALLBACK_CANCEL,
  COMMANDS_CALLBACK_EXECUTE,
  COMMANDS_CALLBACK_PREFIX,
  COMMANDS_CALLBACK_SEARCH,
  COMMANDS_SEARCH_QUERY_MAX_LENGTH,
  filterCommandsForSearch,
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
  | "goalManager"
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
  await ctx.reply(t("bot.session_created", { title: formatSessionTitle(session.title) }));

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

  if (data === COMMANDS_CALLBACK_SEARCH || data.startsWith(`${COMMANDS_CALLBACK_SEARCH}:`)) {
    return handleCommandsSearchCallback(ctx, deps);
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

type CommandsSearchDeps = Pick<AppContainer, "interactionManager">;

function commandsSearchState(deps: CommandsSearchDeps): Record<string, unknown> | null {
  const state = deps.interactionManager.getSnapshot();
  return state?.kind === "custom" && state.metadata.flow === "commands-search"
    ? state.metadata
    : null;
}

function sameCommandsSearch(deps: CommandsSearchDeps, state: Record<string, unknown>): boolean {
  const current = commandsSearchState(deps);
  return !!current && current.token === state.token && current.stage === state.stage;
}

function startCommandsSearch(deps: CommandsSearchDeps): void {
  deps.interactionManager.start({
    kind: "custom",
    expectedInput: "text",
    allowedCommands: [],
    metadata: { flow: "commands-search", stage: "input", token: Symbol("commands-search") },
  });
}

export async function handleCommandsSearchTextInput(
  ctx: Context,
  deps: CommandsSearchDeps,
): Promise<boolean> {
  const state = commandsSearchState(deps);
  if (!state || state.stage !== "input" || ctx.message?.text === undefined) return false;
  const query = ctx.message.text.slice(0, COMMANDS_SEARCH_QUERY_MAX_LENGTH);
  if (!query.trim()) return true;
  try {
    const project = getCurrentProject();
    if (!project) throw new Error("Project no longer selected");
    const commands = filterCommandsForSearch(await loadCommandCatalog(project.worktree), query);
    if (!sameCommandsSearch(deps, state)) return true;
    const view = buildCommandsSearchView(commands, query, 0, config.bot.commandsListLimit);
    const sent = await ctx.reply(view.text, { reply_markup: view.keyboard });
    if (!sameCommandsSearch(deps, state)) return true;
    deps.interactionManager.transition({
      expectedInput: "callback",
      metadata: {
        ...state,
        stage: "results",
        query,
        commands,
        projectDirectory: project.worktree,
        messageId: sent.message_id,
      },
    });
  } catch (error) {
    logger.error("[Commands] Error searching commands:", error);
    if (sameCommandsSearch(deps, state)) {
      deps.interactionManager.clear("commands_search_error");
      await ctx.reply(t("commands.fetch_error"));
    }
  }
  return true;
}

async function handleCommandsSearchCallback(
  ctx: Context,
  deps: ExecuteCommandDeps,
): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (isForegroundBusy(deps)) {
    await replyBusyBlocked(ctx);
    return true;
  }
  if (data === COMMANDS_CALLBACK_SEARCH) {
    const metadata = parseCommandsMetadata(deps.interactionManager.getSnapshot());
    if (metadata?.stage !== "list" || metadata.messageId !== getCallbackMessageId(ctx)) {
      await ctx.answerCallbackQuery({ text: t("inline.inactive_callback"), show_alert: true });
      return true;
    }
    const initial = deps.interactionManager.getSnapshot();
    await ctx.answerCallbackQuery().catch(() => {});
    await ctx.deleteMessage().catch(() => {});
    const current = deps.interactionManager.getSnapshot();
    if (
      current?.metadata.flow !== "commands" ||
      current.metadata.stage !== "list" ||
      current.metadata.messageId !== initial?.metadata.messageId
    )
      return true;
    startCommandsSearch(deps);
    await ctx.reply(t("commands.search.prompt"));
    return true;
  }
  const state = commandsSearchState(deps);
  if (!state || state.stage !== "results" || state.messageId !== getCallbackMessageId(ctx)) {
    await ctx.answerCallbackQuery({ text: t("inline.inactive_callback"), show_alert: true });
    return true;
  }
  if (data === `${COMMANDS_CALLBACK_SEARCH}:cancel`) {
    deps.interactionManager.clear("commands_search_cancelled");
    await cancelMenu(ctx);
    return true;
  }
  if (data === `${COMMANDS_CALLBACK_SEARCH}:again`) {
    await ctx.answerCallbackQuery().catch(() => {});
    await ctx.deleteMessage().catch(() => {});
    if (!sameCommandsSearch(deps, state)) return true;
    startCommandsSearch(deps);
    await ctx.reply(t("commands.search.prompt"));
    return true;
  }
  if (data?.startsWith(`${COMMANDS_CALLBACK_SEARCH}:page:`)) {
    const raw = data.slice(`${COMMANDS_CALLBACK_SEARCH}:page:`.length);
    if (!/^\d+$/.test(raw) || typeof state.query !== "string") return true;
    try {
      const project = getCurrentProject();
      if (!project) throw new Error("Project no longer selected");
      const commands = filterCommandsForSearch(
        await loadCommandCatalog(project.worktree),
        state.query,
      );
      if (!sameCommandsSearch(deps, state)) {
        await ctx.answerCallbackQuery().catch(() => {});
        return true;
      }
      const view = buildCommandsSearchView(
        commands,
        state.query,
        Number(raw),
        config.bot.commandsListLimit,
      );
      await ctx.editMessageText(view.text, { reply_markup: view.keyboard });
      if (!sameCommandsSearch(deps, state)) {
        await ctx.answerCallbackQuery().catch(() => {});
        return true;
      }
      deps.interactionManager.transition({
        expectedInput: "callback",
        metadata: { ...state, commands, projectDirectory: project.worktree },
      });
      await ctx.answerCallbackQuery();
    } catch (error) {
      logger.error("[Commands] Error loading search page:", error);
      await ctx.answerCallbackQuery({ text: t("commands.page_load_error_callback") });
    }
    return true;
  }
  if (data?.startsWith(`${COMMANDS_CALLBACK_SEARCH}:result:`)) {
    const raw = data.slice(`${COMMANDS_CALLBACK_SEARCH}:result:`.length);
    const commands = parseCommandItems(state.commands);
    const selectedCommand = /^\d+$/.test(raw) ? commands?.[Number(raw)] : undefined;
    if (!selectedCommand || typeof state.projectDirectory !== "string") {
      await ctx.answerCallbackQuery({ text: t("inline.inactive_callback"), show_alert: true });
      return true;
    }
    try {
      await ctx.answerCallbackQuery();
      if (!sameCommandsSearch(deps, state)) return true;
      await ctx.editMessageText(t("commands.confirm", { command: `/${selectedCommand.name}` }), {
        reply_markup: buildCommandsConfirmKeyboard(),
      });
      if (!sameCommandsSearch(deps, state)) return true;
      deps.interactionManager.transition({
        expectedInput: "mixed",
        allowedCommands: [...DEFAULT_ALLOWED_INTERACTION_COMMANDS],
        metadata: {
          flow: "commands",
          stage: "confirm",
          messageId: state.messageId,
          projectDirectory: state.projectDirectory,
          commandName: selectedCommand.name,
        },
      });
    } catch (error) {
      logger.error("[Commands] Error selecting search result:", error);
      if (sameCommandsSearch(deps, state)) {
        deps.interactionManager.clear("commands_search_select_error");
        await ctx.answerCallbackQuery({ text: t("callback.processing_error") }).catch(() => {});
      } else {
        await ctx.answerCallbackQuery().catch(() => {});
      }
    }
  }
  return true;
}
