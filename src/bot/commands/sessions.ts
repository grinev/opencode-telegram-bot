import { CommandContext, Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { setCurrentSession, SessionInfo } from "../../session/manager.js";
import { getCurrentProject } from "../../settings/manager.js";
import { pinnedMessageManager } from "../../pinned/manager.js";
import { keyboardManager } from "../../keyboard/manager.js";
import { logger } from "../../utils/logger.js";
import { safeBackgroundTask } from "../../utils/safe-background-task.js";
import { config } from "../../config.js";
import { getLocale, t } from "../../i18n/index.js";

export async function sessionsCommand(ctx: CommandContext<Context>) {
  try {
    const maxSessions = config.bot.sessionsListLimit;
    const currentProject = getCurrentProject();

    if (!currentProject) {
      await ctx.reply(t("sessions.project_not_selected"));
      return;
    }

    logger.debug(`[Sessions] Fetching sessions for directory: ${currentProject.worktree}`);

    const { data: sessions, error } = await opencodeClient.session.list({
      directory: currentProject.worktree,
      limit: maxSessions,
    });

    if (error || !sessions) {
      throw error || new Error("No data received from server");
    }

    logger.debug(`[Sessions] Found ${sessions.length} sessions`);
    sessions.forEach((session) => {
      logger.debug(`[Sessions] Session: ${session.title} | ${session.directory}`);
    });

    let filteredSessions = sessions;
    if (config.bot.hideSubsessions) {
      filteredSessions = sessions.filter((session) => {
        const isSubsession = (session as { parentID?: string }).parentID != null;
        if (isSubsession) {
          logger.debug(
            `[Sessions] Filtering out subsession: ${session.title} (parentID: ${(session as { parentID?: string }).parentID})`,
          );
        }
        return !isSubsession;
      });
      logger.debug(
        `[Sessions] Filtered ${sessions.length - filteredSessions.length} subsessions, showing ${filteredSessions.length} top-level sessions`,
      );
    }

    if (filteredSessions.length === 0) {
      await ctx.reply(t("sessions.empty"));
      return;
    }

    const keyboard = new InlineKeyboard();
    const localeForDate = getLocale() === "ru" ? "ru-RU" : "en-US";

    filteredSessions.forEach((session, index) => {
      const date = new Date(session.time.created).toLocaleDateString(localeForDate);
      const label = `${index + 1}. ${session.title} (${date})`;
      keyboard.text(label, `session:${session.id}`).row();
    });

    await ctx.reply(t("sessions.select"), {
      reply_markup: keyboard,
    });
  } catch (error) {
    logger.error("[Sessions] Error fetching sessions:", error);
    await ctx.reply(t("sessions.fetch_error"));
  }
}

export async function handleSessionSelect(ctx: Context): Promise<boolean> {
  const callbackQuery = ctx.callbackQuery;
  if (!callbackQuery?.data || !callbackQuery.data.startsWith("session:")) {
    return false;
  }

  const sessionId = callbackQuery.data.replace("session:", "");

  try {
    const currentProject = getCurrentProject();

    if (!currentProject) {
      await ctx.answerCallbackQuery();
      await ctx.reply(t("sessions.select_project_first"));
      return true;
    }

    const { data: session, error } = await opencodeClient.session.get({
      sessionID: sessionId,
      directory: currentProject.worktree,
    });

    if (error || !session) {
      throw error || new Error("Failed to get session details");
    }

    logger.info(
      `[Bot] Session selected: id=${session.id}, title="${session.title}", project=${currentProject.worktree}`,
    );

    const sessionInfo: SessionInfo = {
      id: session.id,
      title: session.title,
      directory: currentProject.worktree,
    };
    setCurrentSession(sessionInfo);

    await ctx.answerCallbackQuery();

    let loadingMessageId: number | null = null;
    if (ctx.chat) {
      try {
        const loadingMessage = await ctx.api.sendMessage(
          ctx.chat.id,
          t("sessions.loading_context"),
        );
        loadingMessageId = loadingMessage.message_id;
      } catch (err) {
        logger.error("[Sessions] Failed to send loading message:", err);
      }
    }

    // Initialize pinned message manager if not already
    if (!pinnedMessageManager.isInitialized() && ctx.chat) {
      pinnedMessageManager.initialize(ctx.api, ctx.chat.id);
    }

    // Initialize keyboard manager if not already
    if (ctx.chat) {
      keyboardManager.initialize(ctx.api, ctx.chat.id);
    }

    try {
      // Create new pinned message for this session
      await pinnedMessageManager.onSessionChange(session.id, session.title);
      // Load context from session history (for existing sessions)
      // Wait for it to complete so keyboard has correct context
      await pinnedMessageManager.loadContextFromHistory(session.id, currentProject.worktree);
    } catch (err) {
      logger.error("[Bot] Error initializing pinned message:", err);
    }

    if (ctx.chat) {
      const chatId = ctx.chat.id;

      // Update keyboard with loaded context (callback executes async via setImmediate, so update manually)
      const contextInfo = pinnedMessageManager.getContextInfo();
      if (contextInfo) {
        keyboardManager.updateContext(contextInfo.tokensUsed, contextInfo.tokensLimit);
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
      const keyboard = keyboardManager.getKeyboard();
      try {
        await ctx.api.sendMessage(chatId, t("sessions.selected", { title: session.title }), {
          reply_markup: keyboard,
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
            null,
            session.title,
            session.id,
            currentProject.worktree,
          ),
      });
    }

    await ctx.deleteMessage();
  } catch (error) {
    logger.error("[Sessions] Error selecting session:", error);
    await ctx.answerCallbackQuery();
    await ctx.reply(t("sessions.select_error"));
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
