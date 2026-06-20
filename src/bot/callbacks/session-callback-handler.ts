import { InlineKeyboard, type Bot, type Context } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { fetchCurrentAgent } from "../../app/services/agent-selection-service.js";
import { clearSession, getCurrentSession, setCurrentSession } from "../../app/services/session-service.js";
import type { SessionInfo } from "../../app/types/session.js";
import { clearCurrentAgent, getCurrentProject } from "../../app/stores/settings-store.js";
import { clearAllInteractionState, interactionManager } from "../../app/managers/interaction-manager.js";
import { keyboardManager } from "../keyboards/keyboard-manager.js";
import { appendInlineMenuCancelButton, ensureActiveInlineMenu } from "../menus/inline-menu.js";
import { isForegroundBusy } from "../../app/services/run-control-service.js";
import { replyBusyBlocked } from "../messages/busy-blocked-renderer.js";
import { logger } from "../../utils/logger.js";
import { safeBackgroundTask } from "../../utils/safe-background-task.js";
import { config } from "../../config.js";
import { t } from "../../i18n/index.js";
import { attachToSession, detachAttachedSession } from "../../app/services/attach-service.js";
import { fetchCurrentModelFromSession } from "../../app/services/model-selection-service.js";
import { foregroundSessionState } from "../../app/managers/foreground-session-state-manager.js";
import { assistantRunState } from "../../app/managers/assistant-run-state-manager.js";
import { pinnedMessageManager } from "../pinned/pinned-message-manager.js";
import { clearPromptResponseMode } from "../handlers/prompt.js";
import { renderAssistantFinalPartsSafe } from "../messages/assistant-rendering.js";
import { sendRenderedBotPart } from "../messages/telegram-text.js";
import {
  buildSessionSelectionMenuView,
  parseBackgroundSessionCallback,
  parseSessionIdCallback,
  parseSessionPageCallback,
  SESSION_CALLBACK_PREFIX,
  loadSessionPage,
} from "../menus/session-selection-menu.js";

const SESSION_SELECT_PREFIX = "session:select:";
const SESSION_RENAME_PREFIX = "session:rename:";
const SESSION_DELETE_PREFIX = "session:delete:";
const SESSION_DELETE_CONFIRM_PREFIX = "session:delete:confirm:";
const SESSION_DELETE_CANCEL_PREFIX = "session:delete:cancel:";
const RENAME_CANCEL_CALLBACK = "rename:cancel";

export interface SessionSelectDeps {
  bot: Bot<Context>;
  ensureEventSubscription: (directory: string) => Promise<void>;
}

interface SelectSessionByIdOptions {
  source: "menu" | "background_notification";
  deleteCallbackMessage: boolean;
  removeCallbackReplyMarkup: boolean;
  postSelectAction: "preview" | "latest_assistant_response" | "none";
}

type SessionPreviewItem = {
  role: "user" | "assistant";
  text: string;
  created: number;
};

const PREVIEW_MESSAGES_LIMIT = 6;
const LATEST_ASSISTANT_RESPONSE_MESSAGES_LIMIT = 20;
const PREVIEW_ITEM_MAX_LENGTH = 420;
const TELEGRAM_MESSAGE_LIMIT = 4096;

type SessionMessageLike = {
  info: {
    role?: string;
    summary?: boolean;
    time?: {
      created?: number;
    };
  };
  parts: Array<{ type: string; text?: string }>;
};

type SessionRenameMetadata = {
  action: "session_rename";
  sessionId: string;
  directory: string;
  currentTitle: string;
};

async function removeCallbackReplyMarkup(ctx: Context): Promise<void> {
  try {
    await ctx.editMessageReplyMarkup();
  } catch (err) {
    logger.debug("[Sessions] Failed to remove background session button:", err);
  }
}

async function selectSessionById(
  ctx: Context,
  deps: SessionSelectDeps,
  sessionId: string,
  options: SelectSessionByIdOptions,
): Promise<void> {
  const currentProject = getCurrentProject();

  if (!currentProject) {
    clearAllInteractionState("session_select_project_missing");
    await ctx.answerCallbackQuery();
    await ctx.reply(t("sessions.select_project_first"));
    return;
  }

  const { data: session, error } = await opencodeClient.session.get({
    sessionID: sessionId,
    directory: currentProject.worktree,
  });

  if (error || !session) {
    throw error || new Error("Failed to get session details");
  }

  logger.info(
    `[Bot] Session selected: id=${session.id}, title="${session.title}", project=${currentProject.worktree}, source=${options.source}`,
  );

  const sessionInfo: SessionInfo = {
    id: session.id,
    title: session.title,
    directory: currentProject.worktree,
  };
  setCurrentSession(sessionInfo);
  clearAllInteractionState("session_switched");

  await ctx.answerCallbackQuery();

  let loadingMessageId: number | null = null;
  if (ctx.chat) {
    try {
      const loadingMessage = await ctx.api.sendMessage(ctx.chat.id, t("sessions.loading_context"));
      loadingMessageId = loadingMessage.message_id;
    } catch (err) {
      logger.error("[Sessions] Failed to send loading message:", err);
    }
  }

  try {
    await attachToSession({
      bot: deps.bot,
      chatId: ctx.chat!.id,
      session: sessionInfo,
      ensureEventSubscription: deps.ensureEventSubscription,
    });
  } catch (err) {
    if (loadingMessageId) {
      try {
        await ctx.api.deleteMessage(ctx.chat!.id, loadingMessageId);
      } catch (deleteError) {
        logger.debug("[Sessions] Failed to delete loading message after follow error:", deleteError);
      }
    }
    logger.error("[Sessions] Error following selected session:", err);
    throw err;
  }

  if (ctx.chat) {
    const chatId = ctx.chat.id;

    clearCurrentAgent();

    const currentAgent = await fetchCurrentAgent();

    keyboardManager.updateAgent(currentAgent);

    const currentModel = await fetchCurrentModelFromSession();
    keyboardManager.updateModel(currentModel);

    await pinnedMessageManager.refreshContextLimit();

    const currentSession = getCurrentSession();
    if (currentSession) {
      await pinnedMessageManager.loadContextFromHistory(currentSession.id, currentProject.worktree);
    }

    const contextInfo = pinnedMessageManager.getContextInfo() ?? keyboardManager.getContextInfo();
    if (contextInfo) {
      keyboardManager.updateContext(contextInfo.tokensUsed, contextInfo.tokensLimit);
    }

    if (loadingMessageId) {
      try {
        await ctx.api.deleteMessage(chatId, loadingMessageId);
      } catch (err) {
        logger.debug("[Sessions] Failed to delete loading message:", err);
      }
    }

    const keyboard = keyboardManager.getKeyboard();
    try {
      await ctx.api.sendMessage(chatId, t("sessions.selected", { title: session.title }), {
        reply_markup: keyboard,
      });
    } catch (err) {
      logger.error("[Sessions] Failed to send selection message:", err);
    }

    if (options.postSelectAction === "preview") {
      safeBackgroundTask({
        taskName: "sessions.sendPreview",
        task: () =>
          sendSessionPreview(
            ctx.api,
            chatId,
            null,
            session.title,
            session.id,
            currentProject.worktree,
          ),
      });
    }

    if (options.postSelectAction === "latest_assistant_response") {
      safeBackgroundTask({
        taskName: "sessions.sendLatestAssistantResponse",
        task: () => sendLatestAssistantResponse(ctx.api, chatId, session.id, currentProject.worktree),
      });
    }
  }

  if (options.removeCallbackReplyMarkup) {
    await removeCallbackReplyMarkup(ctx);
  }

  if (options.deleteCallbackMessage) {
    await ctx.deleteMessage();
  }
}

function shouldBlockBackgroundSessionOpen(): boolean {
  const activeInteraction = interactionManager.getSnapshot();
  return activeInteraction !== null && activeInteraction.kind !== "inline";
}

export async function handleBackgroundSessionOpen(
  ctx: Context,
  deps: SessionSelectDeps,
): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data) {
    return false;
  }

  const payload = parseBackgroundSessionCallback(data);
  if (!payload) {
    return false;
  }

  if (isForegroundBusy()) {
    await replyBusyBlocked(ctx);
    return true;
  }

  if (shouldBlockBackgroundSessionOpen()) {
    await ctx.answerCallbackQuery({ text: t("interaction.blocked.finish_current") }).catch(() => {});
    return true;
  }

  try {
    await selectSessionById(ctx, deps, payload.sessionId, {
      source: "background_notification",
      deleteCallbackMessage: false,
      removeCallbackReplyMarkup: true,
      postSelectAction: payload.kind === "assistant_response" ? "latest_assistant_response" : "none",
    });
  } catch (error) {
    logger.error("[Sessions] Error selecting background session:", error);
    await ctx.answerCallbackQuery({ text: t("sessions.select_error"), show_alert: true }).catch(
      () => {},
    );
  }

  return true;
}

export async function handleSessionSelect(ctx: Context, deps: SessionSelectDeps): Promise<boolean> {
  const callbackQuery = ctx.callbackQuery;
  if (!callbackQuery?.data || !callbackQuery.data.startsWith(SESSION_CALLBACK_PREFIX)) {
    return false;
  }

  if (isForegroundBusy()) {
    await replyBusyBlocked(ctx);
    return true;
  }

  const page = parseSessionPageCallback(callbackQuery.data);
  const sessionId = parseSessionIdCallback(callbackQuery.data);

  const isActiveMenu = await ensureActiveInlineMenu(ctx, "session");
  if (!isActiveMenu) {
    return true;
  }

  try {
    const currentProject = getCurrentProject();

    if (!currentProject) {
      clearAllInteractionState("session_select_project_missing");
      await ctx.answerCallbackQuery();
      await ctx.reply(t("sessions.select_project_first"));
      return true;
    }

    if (page !== null) {
      try {
        const pageSize = config.bot.sessionsListLimit;
        const pageData = await loadSessionPage(currentProject.worktree, page, pageSize);
        if (pageData.sessions.length === 0) {
          await ctx.answerCallbackQuery({ text: t("sessions.page_empty_callback") });
          return true;
        }

        const { text, keyboard } = buildSessionSelectionMenuView(pageData, pageSize);
        appendInlineMenuCancelButton(keyboard, "session");
        await ctx.editMessageText(text, {
          reply_markup: keyboard,
        });
        await ctx.answerCallbackQuery();
      } catch (error) {
        logger.error("[Sessions] Error loading sessions page:", error);
        await ctx.answerCallbackQuery({ text: t("sessions.page_load_error_callback") });
      }

      return true;
    }

    if (!sessionId) {
      await ctx.answerCallbackQuery({ text: t("callback.processing_error") });
      return true;
    }

    if (callbackQuery.data.startsWith(SESSION_SELECT_PREFIX)) {
      const selectSessionId = callbackQuery.data.slice(SESSION_SELECT_PREFIX.length);
      if (!selectSessionId) {
        await ctx.answerCallbackQuery({ text: t("callback.processing_error") });
        return true;
      }

      await selectSessionById(ctx, deps, selectSessionId, {
        source: "menu",
        deleteCallbackMessage: false,
        removeCallbackReplyMarkup: true,
        postSelectAction: "none",
      });
    } else if (callbackQuery.data.startsWith(SESSION_RENAME_PREFIX)) {
      const renameSessionId = callbackQuery.data.slice(SESSION_RENAME_PREFIX.length);
      if (!renameSessionId) {
        await ctx.answerCallbackQuery({ text: t("callback.processing_error") });
        return true;
      }

      await handleSessionRenameCallback(ctx, renameSessionId, currentProject.worktree);
    } else if (callbackQuery.data.startsWith(SESSION_DELETE_CANCEL_PREFIX)) {
      await handleSessionDeleteCancelCallback(ctx, currentProject.worktree);
    } else if (callbackQuery.data.startsWith(SESSION_DELETE_CONFIRM_PREFIX)) {
      const confirmSessionId = callbackQuery.data.slice(SESSION_DELETE_CONFIRM_PREFIX.length);
      if (!confirmSessionId) {
        await ctx.answerCallbackQuery({ text: t("callback.processing_error") });
        return true;
      }

      await handleSessionDeleteConfirmCallback(ctx, confirmSessionId, currentProject.worktree);
    } else if (callbackQuery.data.startsWith(SESSION_DELETE_PREFIX)) {
      const deleteSessionId = callbackQuery.data.slice(SESSION_DELETE_PREFIX.length);
      if (!deleteSessionId) {
        await ctx.answerCallbackQuery({ text: t("callback.processing_error") });
        return true;
      }

      await handleSessionDeleteCallback(ctx, deleteSessionId, currentProject.worktree);
    } else {
      await handleSessionPreviewCallback(ctx, sessionId, currentProject.worktree);
    }
  } catch (error) {
    clearAllInteractionState("session_select_error");
    logger.error("[Sessions] Error selecting session:", error);
    await ctx.answerCallbackQuery();
    await ctx.reply(t("sessions.select_error"));
  }

  return true;
}

function buildSessionPreviewKeyboard(sessionId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text(t("sessions.button.select"), `${SESSION_SELECT_PREFIX}${sessionId}`)
    .text(t("sessions.button.rename"), `${SESSION_RENAME_PREFIX}${sessionId}`)
    .row()
    .text(t("sessions.button.delete"), `${SESSION_DELETE_PREFIX}${sessionId}`)
    .text(t("sessions.button.close"), "inline:cancel:session");
}

async function handleSessionPreviewCallback(
  ctx: Context,
  sessionId: string,
  directory: string,
): Promise<void> {
  const { data: session, error } = await opencodeClient.session.get({
    sessionID: sessionId,
    directory,
  });

  if (error || !session) {
    await ctx.answerCallbackQuery({ text: t("sessions.select_error"), show_alert: true });
    return;
  }

  const previewItems = await loadSessionPreview(sessionId, directory);
  const previewText = formatSessionPreview(session.title, previewItems);
  const keyboard = buildSessionPreviewKeyboard(sessionId);

  try {
    await ctx.editMessageText(previewText, { reply_markup: keyboard });
  } catch (err) {
    logger.warn("[Sessions] Failed to edit message for preview, sending new:", err);
    await ctx.reply(previewText, { reply_markup: keyboard });
  }

  await ctx.answerCallbackQuery();
  logger.info(`[Sessions] Preview shown for session: id=${sessionId}, title="${session.title}"`);
}

async function handleSessionRenameCallback(
  ctx: Context,
  sessionId: string,
  directory: string,
): Promise<void> {
  const { data: session, error } = await opencodeClient.session.get({
    sessionID: sessionId,
    directory,
  });

  if (error || !session) {
    await ctx.answerCallbackQuery({ text: t("sessions.select_error"), show_alert: true });
    return;
  }

  const keyboard = new InlineKeyboard().text(t("sessions.rename.cancel"), RENAME_CANCEL_CALLBACK);

  try {
    await ctx.editMessageText(t("sessions.rename.prompt", { title: session.title }), {
      reply_markup: keyboard,
    });
  } catch (err) {
    logger.warn("[Sessions] Failed to edit message for rename prompt:", err);
  }

  interactionManager.start({
    kind: "custom",
    expectedInput: "text",
    metadata: {
      action: "session_rename",
      sessionId,
      directory,
      currentTitle: session.title,
    },
  });

  await ctx.answerCallbackQuery();
  logger.info(`[Sessions] Rename flow started for session: id=${sessionId}`);
}

export async function handleRenameCancelCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (data !== RENAME_CANCEL_CALLBACK) {
    return false;
  }

  const state = interactionManager.getSnapshot();
  if (!state || state.kind !== "custom" || state.metadata?.action !== "session_rename") {
    await ctx.answerCallbackQuery({ text: t("callback.processing_error") });
    return true;
  }

  const { sessionId, directory } = state.metadata as SessionRenameMetadata;
  interactionManager.clear("rename_cancelled");

  const { data: session } = await opencodeClient.session.get({ sessionID: sessionId, directory });
  if (session) {
    const previewItems = await loadSessionPreview(sessionId, directory);
    const previewText = formatSessionPreview(session.title, previewItems);
    const keyboard = buildSessionPreviewKeyboard(sessionId);
    try {
      await ctx.editMessageText(previewText, { reply_markup: keyboard });
    } catch (err) {
      logger.warn("[Sessions] Failed to restore preview after rename cancel:", err);
    }
  }

  await ctx.answerCallbackQuery();
  logger.info(`[Sessions] Rename cancelled for session: id=${sessionId}`);
  return true;
}

export async function handleRenameTextAnswer(ctx: Context): Promise<boolean> {
  const state = interactionManager.getSnapshot();
  if (!state || state.kind !== "custom" || state.metadata?.action !== "session_rename") {
    return false;
  }

  const text = ctx.message?.text;
  if (!text || text.startsWith("/")) {
    return false;
  }

  const { sessionId, directory } = state.metadata as SessionRenameMetadata;
  const newTitle = text.trim();
  if (!newTitle) {
    await ctx.reply(t("sessions.rename.empty"));
    return true;
  }

  try {
    const { data: updatedSession, error } = await opencodeClient.session.update({
      sessionID: sessionId,
      directory,
      title: newTitle,
    });

    if (error || !updatedSession) {
      throw error || new Error("Failed to update session");
    }

    const currentSession = getCurrentSession();
    if (currentSession?.id === sessionId) {
      setCurrentSession({ id: sessionId, title: newTitle, directory });
      if (pinnedMessageManager.isInitialized()) {
        await pinnedMessageManager.onSessionChange(sessionId, newTitle);
      }
    }

    interactionManager.clear("rename_completed");
    await ctx.reply(t("sessions.rename.success", { title: newTitle }));
    logger.info(`[Sessions] Session renamed successfully: ${newTitle}`);
  } catch (error) {
    logger.error("[Sessions] Error renaming session:", error);
    await ctx.reply(t("sessions.rename.error"));
  }

  return true;
}

async function handleSessionDeleteCallback(
  ctx: Context,
  sessionId: string,
  directory: string,
): Promise<void> {
  const { data: session, error } = await opencodeClient.session.get({
    sessionID: sessionId,
    directory,
  });

  if (error || !session) {
    await ctx.answerCallbackQuery({ text: t("sessions.select_error"), show_alert: true });
    return;
  }

  const keyboard = new InlineKeyboard()
    .text(t("sessions.delete.yes"), `${SESSION_DELETE_CONFIRM_PREFIX}${sessionId}`)
    .text(t("sessions.delete.no"), `${SESSION_DELETE_CANCEL_PREFIX}${sessionId}`);

  try {
    await ctx.editMessageText(t("sessions.delete.confirm", { title: session.title }), {
      reply_markup: keyboard,
    });
  } catch (err) {
    logger.warn("[Sessions] Failed to edit message for delete confirm:", err);
  }

  await ctx.answerCallbackQuery();
  logger.info(`[Sessions] Delete confirmation shown for session: id=${sessionId}`);
}

async function handleSessionDeleteConfirmCallback(
  ctx: Context,
  sessionId: string,
  directory: string,
): Promise<void> {
  try {
    const { data: sessionBeforeDelete, error: getError } = await opencodeClient.session.get({
      sessionID: sessionId,
      directory,
    });
    if (getError) {
      logger.warn("[Sessions] Failed to fetch session before delete:", getError);
    }

    const deletedTitle = sessionBeforeDelete?.title ?? sessionId;
    const { error } = await opencodeClient.session.delete({ sessionID: sessionId, directory });
    if (error) {
      const isNotFound = (error as { status?: number })?.status === 404;
      const errorMessage = isNotFound
        ? t("sessions.delete.not_found")
        : t("sessions.delete.error");
      await ctx.editMessageText(errorMessage).catch(() => {});
      await ctx.answerCallbackQuery({ text: errorMessage, show_alert: true });
      return;
    }

    const currentSession = getCurrentSession();
    if (currentSession?.id === sessionId) {
      detachAttachedSession("session_deleted");
      clearPromptResponseMode(sessionId);
      foregroundSessionState.markIdle(sessionId);
      assistantRunState.clearRun(sessionId, "session_deleted");
      clearAllInteractionState("session_deleted");
      clearSession();

      if (pinnedMessageManager.isInitialized()) {
        await pinnedMessageManager.clear();
      }

      if (ctx.chat) {
        keyboardManager.initialize(ctx.api, ctx.chat.id);
      }

      await pinnedMessageManager.refreshContextLimit();
      keyboardManager.updateContext(0, pinnedMessageManager.getContextLimit());
    } else {
      clearAllInteractionState("session_deleted_other");
    }

    const successMessage = t("sessions.delete.success", { title: deletedTitle });
    try {
      await ctx.editMessageText(successMessage);
    } catch (err) {
      logger.warn("[Sessions] Failed to edit message after delete:", err);
      await ctx.reply(successMessage);
    }

    await ctx.answerCallbackQuery();
    logger.info(`[Sessions] Session deleted: id=${sessionId}`);
  } catch (error) {
    logger.error("[Sessions] Error deleting session:", error);
    await ctx.editMessageText(t("sessions.delete.error")).catch(() => ctx.reply(t("sessions.delete.error")));
    await ctx.answerCallbackQuery({ text: t("sessions.delete.error"), show_alert: true }).catch(() => {});
  }
}

async function handleSessionDeleteCancelCallback(ctx: Context, directory: string): Promise<void> {
  const data = ctx.callbackQuery?.data;
  const sessionId = data?.startsWith(SESSION_DELETE_CANCEL_PREFIX)
    ? data.slice(SESSION_DELETE_CANCEL_PREFIX.length)
    : null;

  if (sessionId) {
    const { data: session } = await opencodeClient.session.get({ sessionID: sessionId, directory });
    if (session) {
      const previewItems = await loadSessionPreview(sessionId, directory);
      const previewText = formatSessionPreview(session.title, previewItems);
      const keyboard = buildSessionPreviewKeyboard(sessionId);
      try {
        await ctx.editMessageText(previewText, { reply_markup: keyboard });
      } catch (err) {
        logger.warn("[Sessions] Failed to restore preview after delete cancel:", err);
      }
    }
  }

  await ctx.answerCallbackQuery();
  logger.info(`[Sessions] Delete cancelled for session: id=${sessionId}`);
}

function extractTextParts(
  parts: Array<{ type: string; text?: string }>,
  options: { trim?: boolean } = {},
): string | null {
  const textParts = parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string);

  if (textParts.length === 0) {
    return null;
  }

  const text = textParts.join("");
  const normalizedText = options.trim === false ? text : text.trim();
  return normalizedText.trim().length > 0 ? normalizedText : null;
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  const clipped = text.slice(0, Math.max(0, maxLength - 3)).trimEnd();
  return `${clipped}...`;
}

async function loadSessionPreview(
  sessionId: string,
  directory: string,
): Promise<SessionPreviewItem[]> {
  try {
    const { data: messages, error } = await opencodeClient.session.messages({
      sessionID: sessionId,
      directory,
      limit: PREVIEW_MESSAGES_LIMIT,
    });

    if (error || !messages) {
      logger.warn("[Sessions] Failed to fetch session messages:", error);
      return [];
    }

    const items = messages
      .map(({ info, parts }) => {
        const role = info.role as "user" | "assistant" | undefined;
        if (role !== "user" && role !== "assistant") {
          return null;
        }

        if (role === "assistant" && (info as { summary?: boolean }).summary) {
          return null;
        }

        const text = extractTextParts(parts as Array<{ type: string; text?: string }>);
        if (!text) {
          return null;
        }

        const created = info.time?.created ?? 0;
        return {
          role,
          text: truncateText(text, PREVIEW_ITEM_MAX_LENGTH),
          created,
        } as SessionPreviewItem;
      })
      .filter((item): item is SessionPreviewItem => Boolean(item));

    return items.sort((a, b) => a.created - b.created);
  } catch (err) {
    logger.error("[Sessions] Error loading session preview:", err);
    return [];
  }
}

function formatSessionPreview(_sessionTitle: string, items: SessionPreviewItem[]): string {
  const lines: string[] = [];

  if (items.length === 0) {
    lines.push(t("sessions.preview.empty"));
    return lines.join("\n");
  }

  lines.push(t("sessions.preview.title"));

  items.forEach((item, index) => {
    const label = item.role === "user" ? t("sessions.preview.you") : t("sessions.preview.agent");
    lines.push(`${label} ${item.text}`);
    if (index < items.length - 1) {
      lines.push("");
    }
  });

  const rawMessage = lines.join("\n");
  return truncateText(rawMessage, TELEGRAM_MESSAGE_LIMIT);
}

async function sendSessionPreview(
  api: Context["api"],
  chatId: number,
  messageId: number | null,
  sessionTitle: string,
  sessionId: string,
  directory: string,
): Promise<void> {
  const previewItems = await loadSessionPreview(sessionId, directory);
  const finalText = formatSessionPreview(sessionTitle, previewItems);

  if (messageId) {
    try {
      await api.editMessageText(chatId, messageId, finalText);
      return;
    } catch (err) {
      logger.warn("[Sessions] Failed to edit preview message, sending new one:", err);
    }
  }

  try {
    await api.sendMessage(chatId, finalText);
  } catch (err) {
    logger.error("[Sessions] Failed to send session preview message:", err);
  }
}

async function loadLatestAssistantResponse(
  sessionId: string,
  directory: string,
): Promise<string | null> {
  try {
    const { data: messages, error } = await opencodeClient.session.messages({
      sessionID: sessionId,
      directory,
      limit: LATEST_ASSISTANT_RESPONSE_MESSAGES_LIMIT,
    });

    if (error || !messages) {
      logger.warn("[Sessions] Failed to fetch latest assistant response:", error);
      return null;
    }

    const latestResponse = (messages as SessionMessageLike[]).reduce<{
      text: string;
      created: number;
    } | null>((latest, message) => {
      if (message.info.role !== "assistant" || message.info.summary) {
        return latest;
      }

      const text = extractTextParts(message.parts, { trim: false });
      if (!text) {
        return latest;
      }

      const created = message.info.time?.created ?? 0;
      if (!latest || created >= latest.created) {
        return { text, created };
      }

      return latest;
    }, null);

    return latestResponse?.text ?? null;
  } catch (err) {
    logger.error("[Sessions] Error loading latest assistant response:", err);
    return null;
  }
}

async function sendLatestAssistantResponse(
  api: Context["api"],
  chatId: number,
  sessionId: string,
  directory: string,
): Promise<void> {
  const responseText = await loadLatestAssistantResponse(sessionId, directory);
  if (!responseText) {
    return;
  }

  const parts = renderAssistantFinalPartsSafe(responseText, TELEGRAM_MESSAGE_LIMIT);
  for (const part of parts) {
    await sendRenderedBotPart({
      api,
      chatId,
      part,
    });
  }
}
