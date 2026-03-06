import { CommandContext, Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { setCurrentSession, SessionInfo } from "../../session/manager.js";
import {
  TOPIC_SESSION_STATUS,
  getCurrentProject,
  setCurrentAgent,
  setCurrentModel,
  setCurrentProject,
} from "../../settings/manager.js";
import { clearAllInteractionState } from "../../interaction/cleanup.js";
import { INTERACTION_CLEAR_REASON } from "../../interaction/constants.js";
import { summaryAggregator } from "../../summary/aggregator.js";
import { pinnedMessageManager } from "../../pinned/manager.js";
import { keyboardManager } from "../../keyboard/manager.js";
import {
  appendInlineMenuCancelButton,
  ensureActiveInlineMenu,
  replyWithInlineMenu,
} from "../handlers/inline-menu.js";
import { logger } from "../../utils/logger.js";
import { safeBackgroundTask } from "../../utils/safe-background-task.js";
import { config } from "../../config.js";
import { getDateLocale, t } from "../../i18n/index.js";
import { getStoredAgent } from "../../agent/manager.js";
import { getStoredModel } from "../../model/manager.js";
import { createMainKeyboard } from "../utils/keyboard.js";
import { formatVariantForButton } from "../../variant/manager.js";
import {
  createScopeKeyFromParams,
  GENERAL_TOPIC_THREAD_ID,
  GLOBAL_SCOPE_KEY,
  SCOPE_CONTEXT,
  getScopeFromContext,
  getScopeKeyFromContext,
  getThreadSendOptions,
  isTopicScope,
} from "../scope.js";
import {
  BOT_I18N_KEY,
  CHAT_TYPE,
  TELEGRAM_CHAT_FIELD,
  TELEGRAM_ERROR_MARKER,
} from "../constants.js";
import {
  getTopicBindingBySessionId,
  getTopicBindingsByChat,
  registerTopicSessionBinding,
} from "../../topic/manager.js";
import { TOPIC_COLORS } from "../../topic/colors.js";
import { formatTopicTitle } from "../../topic/title-format.js";
import { buildTopicThreadLink } from "../utils/topic-link.js";

const SESSION_CALLBACK_PREFIX = "session:";
const SESSION_PAGE_CALLBACK_PREFIX = "session:page:";
const SESSION_FETCH_EXTRA_COUNT = 1;

type SessionListItem = {
  id: string;
  title: string;
  directory: string;
  time: {
    created: number;
  };
};

type SessionPage = {
  sessions: SessionListItem[];
  hasNext: boolean;
  page: number;
};

function buildSessionPageCallback(page: number): string {
  return `${SESSION_PAGE_CALLBACK_PREFIX}${page}`;
}

function parseSessionPageCallback(data: string): number | null {
  if (!data.startsWith(SESSION_PAGE_CALLBACK_PREFIX)) {
    return null;
  }

  const rawPage = data.slice(SESSION_PAGE_CALLBACK_PREFIX.length);
  const page = Number(rawPage);
  if (!Number.isInteger(page) || page < 0) {
    return null;
  }

  return page;
}

function parseSessionIdCallback(data: string): string | null {
  if (!data.startsWith(SESSION_CALLBACK_PREFIX)) {
    return null;
  }

  if (data.startsWith(SESSION_PAGE_CALLBACK_PREFIX)) {
    return null;
  }

  const sessionId = data.slice(SESSION_CALLBACK_PREFIX.length);
  return sessionId.length > 0 ? sessionId : null;
}

function formatSessionsSelectText(page: number): string {
  if (page === 0) {
    return t("sessions.select");
  }

  return t("sessions.select_page", { page: page + 1 });
}

function isGeneralForumScope(ctx: Context): boolean {
  const scope = getScopeFromContext(ctx);
  const isForumEnabled =
    ctx.chat?.type === CHAT_TYPE.SUPERGROUP &&
    Reflect.get(ctx.chat, TELEGRAM_CHAT_FIELD.IS_FORUM) === true;

  return Boolean(
    isForumEnabled &&
    scope?.context === SCOPE_CONTEXT.GROUP_GENERAL &&
    (scope.threadId === null || scope.threadId === GENERAL_TOPIC_THREAD_ID),
  );
}

function formatGeneralOverview(chatId: number): string {
  const bindings = getTopicBindingsByChat(chatId).filter(
    (binding) => binding.threadId !== GENERAL_TOPIC_THREAD_ID,
  );

  if (bindings.length === 0) {
    return t(BOT_I18N_KEY.SESSIONS_GENERAL_EMPTY);
  }

  const lines = [t(BOT_I18N_KEY.SESSIONS_GENERAL_OVERVIEW)];
  for (const binding of bindings) {
    lines.push(
      t(BOT_I18N_KEY.SESSIONS_GENERAL_ITEM, {
        topic: binding.topicName ?? String(binding.threadId),
        thread: String(binding.threadId),
        status: binding.status,
      }),
    );
  }

  return lines.join("\n");
}

function getErrorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message.toLowerCase();
  }

  const description =
    typeof error === "object" && error !== null ? Reflect.get(error, "description") : null;
  if (typeof description === "string") {
    return description.toLowerCase();
  }

  return String(error).toLowerCase();
}

function clearInteractionWithScope(reason: string, scopeKey: string): void {
  if (scopeKey === GLOBAL_SCOPE_KEY) {
    clearAllInteractionState(reason);
    return;
  }

  clearAllInteractionState(reason, scopeKey);
}

async function loadSessionPage(
  directory: string,
  page: number,
  pageSize: number,
): Promise<SessionPage> {
  const startIndex = page * pageSize;
  const endExclusive = startIndex + pageSize;

  const { data: sessions, error } = await opencodeClient.session.list({
    directory,
    limit: endExclusive + SESSION_FETCH_EXTRA_COUNT,
  });

  if (error || !sessions) {
    throw error || new Error("No data received from server");
  }

  const hasNext = sessions.length > endExclusive;
  const pagedSessions = sessions.slice(startIndex, endExclusive);

  logger.debug(
    `[Sessions] Loaded page=${page + 1}, startIndex=${startIndex}, endExclusive=${endExclusive}, pageSize=${pageSize}, items=${pagedSessions.length}, hasNext=${hasNext}`,
  );

  return {
    sessions: pagedSessions as SessionListItem[],
    hasNext,
    page,
  };
}

function buildSessionsKeyboard(pageData: SessionPage, pageSize: number): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const localeForDate = getDateLocale();
  const pageStartIndex = pageData.page * pageSize;

  pageData.sessions.forEach((session, index) => {
    const date = new Date(session.time.created).toLocaleDateString(localeForDate);
    const label = `${pageStartIndex + index + 1}. ${session.title} (${date})`;
    keyboard.text(label, `${SESSION_CALLBACK_PREFIX}${session.id}`).row();
  });

  if (pageData.page > 0) {
    keyboard.text(t("sessions.button.prev_page"), buildSessionPageCallback(pageData.page - 1));
  }

  if (pageData.hasNext) {
    keyboard.text(t("sessions.button.next_page"), buildSessionPageCallback(pageData.page + 1));
  }

  if (pageData.page > 0 || pageData.hasNext) {
    keyboard.row();
  }

  return keyboard;
}

export async function sessionsCommand(ctx: CommandContext<Context>) {
  try {
    const scope = getScopeFromContext(ctx);
    const scopeKey = scope?.key ?? GLOBAL_SCOPE_KEY;

    if (isTopicScope(scope)) {
      await ctx.reply(
        t(BOT_I18N_KEY.SESSIONS_TOPIC_LOCKED),
        getThreadSendOptions(scope?.threadId ?? null),
      );
      return;
    }

    const isGeneralScope = Boolean(ctx.chat && isGeneralForumScope(ctx));

    if (ctx.chat && isGeneralScope) {
      await ctx.reply(
        formatGeneralOverview(ctx.chat.id),
        getThreadSendOptions(scope?.threadId ?? null),
      );
    }

    const pageSize = config.bot.sessionsListLimit;
    const currentProject = getCurrentProject(scopeKey);

    if (!currentProject) {
      await ctx.reply(t("sessions.project_not_selected"));
      return;
    }

    logger.debug(`[Sessions] Fetching sessions for directory: ${currentProject.worktree}`);

    const firstPage = await loadSessionPage(currentProject.worktree, 0, pageSize);

    logger.debug(`[Sessions] Found ${firstPage.sessions.length} sessions on page 1`);
    firstPage.sessions.forEach((session) => {
      logger.debug(`[Sessions] Session: ${session.title} | ${session.directory}`);
    });

    if (firstPage.sessions.length === 0) {
      await ctx.reply(t("sessions.empty"));
      return;
    }

    const keyboard = buildSessionsKeyboard(firstPage, pageSize);

    await replyWithInlineMenu(ctx, {
      menuKind: "session",
      text: formatSessionsSelectText(firstPage.page),
      keyboard,
    });
  } catch (error) {
    logger.error("[Sessions] Error fetching sessions:", error);
    await ctx.reply(t("sessions.fetch_error"));
  }
}

export async function handleSessionSelect(ctx: Context): Promise<boolean> {
  const scopeKey = getScopeKeyFromContext(ctx);
  const scope = getScopeFromContext(ctx);
  const usePinned = ctx.chat?.type !== CHAT_TYPE.PRIVATE;
  const callbackQuery = ctx.callbackQuery;
  if (!callbackQuery?.data || !callbackQuery.data.startsWith(SESSION_CALLBACK_PREFIX)) {
    return false;
  }

  const page = parseSessionPageCallback(callbackQuery.data);
  const sessionId = parseSessionIdCallback(callbackQuery.data);

  const isActiveMenu = await ensureActiveInlineMenu(ctx, "session");
  if (!isActiveMenu) {
    return true;
  }

  try {
    const currentProject = getCurrentProject(scopeKey);

    if (!currentProject) {
      clearInteractionWithScope("session_select_project_missing", scopeKey);
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

        const keyboard = buildSessionsKeyboard(pageData, pageSize);
        appendInlineMenuCancelButton(keyboard, "session");
        await ctx.editMessageText(formatSessionsSelectText(pageData.page), {
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

    const { data: session, error } = await opencodeClient.session.get({
      sessionID: sessionId,
      directory: currentProject.worktree,
    });

    if (error || !session) {
      throw error || new Error("Failed to get session details");
    }

    const inGeneralForum = Boolean(ctx.chat && isGeneralForumScope(ctx));
    if (inGeneralForum && ctx.chat) {
      const existingBinding = getTopicBindingBySessionId(session.id);
      if (existingBinding && existingBinding.chatId === ctx.chat.id) {
        const existingLink = buildTopicThreadLink(ctx.chat, existingBinding.threadId);
        if (existingLink) {
          clearInteractionWithScope(INTERACTION_CLEAR_REASON.SESSION_SWITCHED, scopeKey);
          await ctx.answerCallbackQuery();
          await ctx.reply(
            t(BOT_I18N_KEY.SESSIONS_BOUND_TOPIC_LINK, {
              title: session.title,
              topic: existingBinding.topicName ?? String(existingBinding.threadId),
              url: existingLink,
            }),
            getThreadSendOptions(scope?.threadId ?? null),
          );
          await ctx.deleteMessage().catch(() => {});
          return true;
        }
      }

      const createdTopic = await ctx.api.createForumTopic(
        ctx.chat.id,
        formatTopicTitle(session.title, session.title),
        {
          icon_color: TOPIC_COLORS.BLUE,
        },
      );

      const topicThreadId = createdTopic.message_thread_id;
      const topicScopeKey = createScopeKeyFromParams({
        chatId: ctx.chat.id,
        threadId: topicThreadId,
        context: SCOPE_CONTEXT.GROUP_TOPIC,
      });

      const sessionInfo: SessionInfo = {
        id: session.id,
        title: session.title,
        directory: currentProject.worktree,
      };

      setCurrentProject(currentProject, topicScopeKey);
      setCurrentSession(sessionInfo, topicScopeKey);
      setCurrentAgent(getStoredAgent(scopeKey), topicScopeKey);
      setCurrentModel(getStoredModel(scopeKey), topicScopeKey);

      registerTopicSessionBinding({
        scopeKey: topicScopeKey,
        chatId: ctx.chat.id,
        threadId: topicThreadId,
        sessionId: session.id,
        projectId: currentProject.id,
        projectWorktree: currentProject.worktree,
        topicName: formatTopicTitle(session.title, session.title),
        status: TOPIC_SESSION_STATUS.ACTIVE,
      });

      summaryAggregator.setSession(session.id);
      clearInteractionWithScope(INTERACTION_CLEAR_REASON.SESSION_SWITCHED, scopeKey);
      clearInteractionWithScope(INTERACTION_CLEAR_REASON.SESSION_SWITCHED, topicScopeKey);

      if (!pinnedMessageManager.isInitialized(topicScopeKey)) {
        pinnedMessageManager.initialize(ctx.api, ctx.chat.id, topicScopeKey, topicThreadId);
      }

      keyboardManager.initialize(ctx.api, ctx.chat.id, topicScopeKey);

      try {
        await pinnedMessageManager.onSessionChange(session.id, session.title, topicScopeKey);
        await pinnedMessageManager.loadContextFromHistory(
          session.id,
          currentProject.worktree,
          topicScopeKey,
        );
      } catch (err) {
        logger.error("[Sessions] Error preparing topic pinned message", err);
      }

      const topicContextInfo =
        pinnedMessageManager.getContextInfo(topicScopeKey) ??
        keyboardManager.getContextInfo(topicScopeKey) ??
        (pinnedMessageManager.getContextLimit(topicScopeKey) > 0
          ? { tokensUsed: 0, tokensLimit: pinnedMessageManager.getContextLimit(topicScopeKey) }
          : null);
      const topicModel = getStoredModel(topicScopeKey);
      const topicAgent = getStoredAgent(topicScopeKey);
      const variantName = formatVariantForButton(topicModel.variant || "default");
      const topicKeyboard = createMainKeyboard(
        topicAgent,
        topicModel,
        topicContextInfo ?? undefined,
        variantName,
      );

      await ctx.api.sendMessage(
        ctx.chat.id,
        t(BOT_I18N_KEY.NEW_TOPIC_CREATED, { title: session.title }),
        {
          ...getThreadSendOptions(topicThreadId),
          reply_markup: topicKeyboard,
        },
      );

      const topicLink = buildTopicThreadLink(ctx.chat, topicThreadId);
      if (!topicLink) {
        throw new Error("Unable to build topic link");
      }

      await ctx.answerCallbackQuery();
      await ctx.reply(
        t(BOT_I18N_KEY.SESSIONS_CREATED_TOPIC_LINK, {
          title: session.title,
          topic: formatTopicTitle(session.title, session.title),
          url: topicLink,
        }),
        getThreadSendOptions(scope?.threadId ?? null),
      );
      await ctx.deleteMessage().catch(() => {});
      return true;
    }

    logger.info(
      `[Bot] Session selected: id=${session.id}, title="${session.title}", project=${currentProject.worktree}`,
    );

    const sessionInfo: SessionInfo = {
      id: session.id,
      title: session.title,
      directory: currentProject.worktree,
    };
    setCurrentSession(sessionInfo, scopeKey);
    summaryAggregator.setSession(session.id);
    clearInteractionWithScope(INTERACTION_CLEAR_REASON.SESSION_SWITCHED, scopeKey);

    await ctx.answerCallbackQuery();

    let loadingMessageId: number | null = null;
    if (ctx.chat) {
      try {
        const loadingMessage = await ctx.api.sendMessage(
          ctx.chat.id,
          t("sessions.loading_context"),
          getThreadSendOptions(scope?.threadId ?? null),
        );
        loadingMessageId = loadingMessage.message_id;
      } catch (err) {
        logger.error("[Sessions] Failed to send loading message:", err);
      }
    }

    // Initialize pinned message manager if not already
    if (usePinned && !pinnedMessageManager.isInitialized(scopeKey) && ctx.chat) {
      pinnedMessageManager.initialize(ctx.api, ctx.chat.id, scopeKey, scope?.threadId ?? null);
    }

    // Initialize keyboard manager if not already
    if (ctx.chat) {
      keyboardManager.initialize(ctx.api, ctx.chat.id, scopeKey);
    }

    if (usePinned && pinnedMessageManager.getContextLimit(scopeKey) === 0) {
      await pinnedMessageManager.refreshContextLimit(scopeKey);
    }

    if (usePinned) {
      try {
        // Create new pinned message for this session
        await pinnedMessageManager.onSessionChange(session.id, session.title, scopeKey);
        // Load context from session history (for existing sessions)
        // Wait for it to complete so keyboard has correct context
        await pinnedMessageManager.loadContextFromHistory(
          session.id,
          currentProject.worktree,
          scopeKey,
        );
      } catch (err) {
        logger.error("[Bot] Error initializing pinned message:", err);
      }
    }

    if (ctx.chat) {
      const chatId = ctx.chat.id;

      // Update keyboard with loaded context (callback executes async via setImmediate, so update manually)
      const contextInfo =
        (usePinned ? pinnedMessageManager.getContextInfo(scopeKey) : null) ??
        keyboardManager.getContextInfo(scopeKey);
      if (contextInfo) {
        keyboardManager.updateContext(contextInfo.tokensUsed, contextInfo.tokensLimit, scopeKey);
      } else if (usePinned && pinnedMessageManager.getContextLimit(scopeKey) > 0) {
        keyboardManager.updateContext(0, pinnedMessageManager.getContextLimit(scopeKey), scopeKey);
      }

      // Delete loading message
      if (loadingMessageId) {
        try {
          await ctx.api.deleteMessage(chatId, loadingMessageId);
        } catch (err) {
          logger.debug("[Sessions] Failed to delete loading message:", err);
        }
      }

      // Send session selection confirmation with updated keyboard
      const keyboard = keyboardManager.getKeyboard(scopeKey);
      try {
        await ctx.api.sendMessage(chatId, t("sessions.selected", { title: session.title }), {
          reply_markup: keyboard,
          ...getThreadSendOptions(scope?.threadId ?? null),
        });
      } catch (err) {
        logger.error("[Sessions] Failed to send selection message:", err);
      }

      // Send preview asynchronously
      safeBackgroundTask({
        taskName: "sessions.sendPreview",
        task: () =>
          sendSessionPreview(
            ctx.api,
            chatId,
            scope?.threadId ?? null,
            null,
            session.title,
            session.id,
            currentProject.worktree,
          ),
      });
    }

    await ctx.deleteMessage();
  } catch (error) {
    clearInteractionWithScope(INTERACTION_CLEAR_REASON.SESSION_SELECT_ERROR, scopeKey);
    logger.error("[Sessions] Error selecting session:", error);
    const errorText = getErrorText(error);
    await ctx.answerCallbackQuery();

    if (errorText.includes(TELEGRAM_ERROR_MARKER.NOT_ENOUGH_RIGHTS_CREATE_TOPIC)) {
      await ctx.reply(t(BOT_I18N_KEY.NEW_TOPIC_CREATE_NO_RIGHTS));
      return true;
    }

    if (scope?.threadId != null) {
      await ctx.reply(t("sessions.select_error"), getThreadSendOptions(scope.threadId));
    } else {
      await ctx.reply(t("sessions.select_error"));
    }
  }

  return true;
}

type SessionPreviewItem = {
  role: "user" | "assistant";
  text: string;
  created: number;
};

const PREVIEW_MESSAGES_LIMIT = 6;
const PREVIEW_ITEM_MAX_LENGTH = 420;
const TELEGRAM_MESSAGE_LIMIT = 4096;

function extractTextParts(parts: Array<{ type: string; text?: string }>): string | null {
  const textParts = parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string);

  if (textParts.length === 0) {
    return null;
  }

  const text = textParts.join("").trim();
  return text.length > 0 ? text : null;
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
  threadId: number | null,
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
    await api.sendMessage(chatId, finalText, getThreadSendOptions(threadId));
  } catch (err) {
    logger.error("[Sessions] Failed to send session preview message:", err);
  }
}
