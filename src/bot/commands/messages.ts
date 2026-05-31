import type { Bot } from "grammy";
import { CommandContext, Context, InlineKeyboard } from "grammy";
import { config } from "../../config.js";
import type { InteractionState } from "../../interaction/types.js";
import { interactionManager } from "../../interaction/manager.js";
import { opencodeClient } from "../../opencode/client.js";
import { getCurrentSession, setCurrentSession, SessionInfo } from "../../session/manager.js";
import { getCurrentProject } from "../../settings/manager.js";
import { clearAllInteractionState } from "../../interaction/cleanup.js";
import { attachToSession } from "../../attach/service.js";
import { ingestSessionInfoForCache } from "../../session/cache-manager.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { safeBackgroundTask } from "../../utils/safe-background-task.js";
import { renderAssistantFinalPartsSafe } from "../utils/assistant-rendering.js";
import { sendRenderedBotPart } from "../utils/telegram-text.js";

const MESSAGES_CALLBACK_PREFIX = "messages:";
const MESSAGES_CALLBACK_SELECT_PREFIX = `${MESSAGES_CALLBACK_PREFIX}select:`;
const MESSAGES_CALLBACK_PAGE_PREFIX = `${MESSAGES_CALLBACK_PREFIX}page:`;
const MESSAGES_CALLBACK_REVERT = `${MESSAGES_CALLBACK_PREFIX}revert`;
const MESSAGES_CALLBACK_FORK = `${MESSAGES_CALLBACK_PREFIX}fork`;
const MESSAGES_CALLBACK_BACK = `${MESSAGES_CALLBACK_PREFIX}back`;
const MESSAGES_CALLBACK_CANCEL = `${MESSAGES_CALLBACK_PREFIX}cancel`;
const MAX_INLINE_BUTTON_LABEL_LENGTH = 64;
const TELEGRAM_MESSAGE_LIMIT = 4096;
const LATEST_ASSISTANT_RESPONSE_MESSAGES_LIMIT = 20;

export interface MessagesCallbackDeps {
  bot: Bot<Context>;
  ensureEventSubscription: (directory: string) => Promise<void>;
}

interface UserMessageItem {
  id: string;
  text: string;
  created: number;
}

interface MessagesListMetadata {
  flow: "messages";
  stage: "list";
  messageId: number;
  projectDirectory: string;
  sessionId: string;
  messages: UserMessageItem[];
  page: number;
}

interface MessagesDetailMetadata {
  flow: "messages";
  stage: "detail";
  messageId: number;
  projectDirectory: string;
  sessionId: string;
  messages: UserMessageItem[];
  page: number;
  selectedIndex: number;
}

type MessagesMetadata = MessagesListMetadata | MessagesDetailMetadata;

type SessionMessageLike = {
  info: {
    id?: string;
    role?: string;
    time?: {
      created?: number;
    };
  };
  parts: Array<{ type: string; text?: string }>;
};

export interface MessagesPaginationRange {
  page: number;
  totalPages: number;
  startIndex: number;
  endIndex: number;
}

function getCallbackMessageId(ctx: Context): number | null {
  const message = ctx.callbackQuery?.message;
  if (!message || !("message_id" in message)) {
    return null;
  }

  const messageId = (message as { message_id?: number }).message_id;
  return typeof messageId === "number" ? messageId : null;
}

function extractTextParts(parts: Array<{ type: string; text?: string }>): string | null {
  const text = parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("")
    .trim();

  return text.length > 0 ? text : null;
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function normalizeButtonText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function formatMessageTime(created: number): string {
  const date = new Date(created);
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

function formatMessageButtonLabel(message: UserMessageItem): string {
  const prefix = `[${formatMessageTime(message.created)}] `;
  const text = normalizeButtonText(message.text);
  return `${prefix}${truncateText(text, MAX_INLINE_BUTTON_LABEL_LENGTH - prefix.length)}`;
}

function formatMessagesSelectText(page: number): string {
  if (page === 0) {
    return t("messages.select");
  }

  return t("messages.select_page", { page: page + 1 });
}

function formatMessageDetailText(message: UserMessageItem): string {
  const prefix = `[${formatMessageTime(message.created)}]\n\n`;
  return truncateText(`${prefix}${message.text}`, TELEGRAM_MESSAGE_LIMIT);
}

export function buildMessagePageCallback(page: number): string {
  return `${MESSAGES_CALLBACK_PAGE_PREFIX}${page}`;
}

export function parseMessagePageCallback(data: string): number | null {
  if (!data.startsWith(MESSAGES_CALLBACK_PAGE_PREFIX)) {
    return null;
  }

  const rawPage = data.slice(MESSAGES_CALLBACK_PAGE_PREFIX.length);
  const page = Number(rawPage);
  if (!Number.isInteger(page) || page < 0) {
    return null;
  }

  return page;
}

export function calculateMessagesPaginationRange(
  totalMessages: number,
  page: number,
  pageSize: number,
): MessagesPaginationRange {
  const safePageSize = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(totalMessages / safePageSize));
  const normalizedPage = Math.min(Math.max(0, page), totalPages - 1);
  const startIndex = normalizedPage * safePageSize;
  const endIndex = Math.min(startIndex + safePageSize, totalMessages);

  return {
    page: normalizedPage,
    totalPages,
    startIndex,
    endIndex,
  };
}

function buildMessagesListKeyboard(
  messages: UserMessageItem[],
  page: number,
  pageSize: number,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const {
    page: normalizedPage,
    totalPages,
    startIndex,
    endIndex,
  } = calculateMessagesPaginationRange(messages.length, page, pageSize);

  messages.slice(startIndex, endIndex).forEach((message, index) => {
    const globalIndex = startIndex + index;
    keyboard.text(formatMessageButtonLabel(message), `${MESSAGES_CALLBACK_SELECT_PREFIX}${globalIndex}`).row();
  });

  if (totalPages > 1) {
    if (normalizedPage > 0) {
      keyboard.text(t("messages.button.prev_page"), buildMessagePageCallback(normalizedPage - 1));
    }

    if (normalizedPage < totalPages - 1) {
      keyboard.text(t("messages.button.next_page"), buildMessagePageCallback(normalizedPage + 1));
    }

    keyboard.row();
  }

  keyboard.text(t("messages.button.cancel"), MESSAGES_CALLBACK_CANCEL);
  return keyboard;
}

function buildMessageDetailKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(t("messages.button.revert"), MESSAGES_CALLBACK_REVERT)
    .row()
    .text(t("messages.button.fork"), MESSAGES_CALLBACK_FORK)
    .row()
    .text(t("messages.button.back"), MESSAGES_CALLBACK_BACK)
    .text(t("messages.button.cancel"), MESSAGES_CALLBACK_CANCEL);
}

function parseMessages(value: unknown): UserMessageItem[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const messages: UserMessageItem[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      return null;
    }

    const id = (item as { id?: unknown }).id;
    const text = (item as { text?: unknown }).text;
    const created = (item as { created?: unknown }).created;

    if (typeof id !== "string" || typeof text !== "string" || typeof created !== "number") {
      return null;
    }

    messages.push({ id, text, created });
  }

  return messages;
}

function parseMessagesMetadata(state: InteractionState | null): MessagesMetadata | null {
  if (!state || state.kind !== "custom") {
    return null;
  }

  const flow = state.metadata.flow;
  const stage = state.metadata.stage;
  const messageId = state.metadata.messageId;
  const projectDirectory = state.metadata.projectDirectory;
  const sessionId = state.metadata.sessionId;
  const messages = parseMessages(state.metadata.messages);
  const page =
    typeof state.metadata.page === "number" && Number.isInteger(state.metadata.page)
      ? Math.max(0, state.metadata.page)
      : 0;

  if (
    flow !== "messages" ||
    typeof messageId !== "number" ||
    typeof projectDirectory !== "string" ||
    typeof sessionId !== "string" ||
    !messages
  ) {
    return null;
  }

  if (stage === "list") {
    return {
      flow,
      stage,
      messageId,
      projectDirectory,
      sessionId,
      messages,
      page,
    };
  }

  if (stage === "detail") {
    const selectedIndex = state.metadata.selectedIndex;
    if (typeof selectedIndex !== "number" || !Number.isInteger(selectedIndex) || selectedIndex < 0) {
      return null;
    }

    return {
      flow,
      stage,
      messageId,
      projectDirectory,
      sessionId,
      messages,
      page,
      selectedIndex,
    };
  }

  return null;
}

function clearMessagesInteraction(reason: string): void {
  const metadata = parseMessagesMetadata(interactionManager.getSnapshot());
  if (metadata) {
    interactionManager.clear(reason);
  }
}

async function loadUserMessages(sessionId: string, directory: string): Promise<UserMessageItem[]> {
  const { data, error } = await opencodeClient.session.messages({
    sessionID: sessionId,
    directory,
  });

  if (error || !data) {
    throw error || new Error("No message data received");
  }

  // Get session info to check for revert
  const { data: sessionData } = await opencodeClient.session.get({
    sessionID: sessionId,
    directory,
  });

  const revertMessageID = sessionData?.revert?.messageID;

  const messages = (data as SessionMessageLike[])
    .map((message) => {
      if (message.info.role !== "user") {
        return null;
      }

      const text = extractTextParts(message.parts);
      if (!text) {
        return null;
      }

      return {
        id: message.info.id ?? `${message.info.time?.created ?? 0}`,
        text,
        created: message.info.time?.created ?? 0,
      } satisfies UserMessageItem;
    })
    .filter((message): message is UserMessageItem => Boolean(message))
    .sort((a, b) => b.created - a.created);

  // If there's a revert, filter messages to only include those before the revert point
  // Messages are sorted newest first, so we need to skip the revert message and everything after it
  if (revertMessageID) {
    const revertIndex = messages.findIndex((msg) => msg.id === revertMessageID);
    if (revertIndex !== -1) {
      return messages.slice(revertIndex + 1);
    }
  }

  return messages;
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
      logger.warn("[Messages] Failed to fetch latest assistant response:", error);
      return null;
    }

    const latestResponse = (messages as SessionMessageLike[]).reduce<{
      text: string;
      created: number;
    } | null>((latest, message) => {
      if (message.info.role !== "assistant") {
        return latest;
      }

      const assistantInfo = message.info as { summary?: boolean };
      if (assistantInfo.summary) {
        return latest;
      }

      const text = extractTextParts(message.parts);
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
    logger.error("[Messages] Error loading latest assistant response:", err);
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

function parseSelectIndex(data: string): number | null {
  if (!data.startsWith(MESSAGES_CALLBACK_SELECT_PREFIX)) {
    return null;
  }

  const rawIndex = data.slice(MESSAGES_CALLBACK_SELECT_PREFIX.length);
  const index = Number(rawIndex);

  if (!Number.isInteger(index) || index < 0) {
    return null;
  }

  return index;
}

export async function messagesCommand(ctx: CommandContext<Context>): Promise<void> {
  try {
    const currentProject = getCurrentProject();
    if (!currentProject) {
      await ctx.reply(t("messages.project_not_selected"));
      return;
    }

    const currentSession = getCurrentSession();
    if (!currentSession) {
      await ctx.reply(t("messages.session_not_selected"));
      return;
    }

    if (currentSession.directory !== currentProject.worktree) {
      await ctx.reply(t("messages.session_project_mismatch"));
      return;
    }

    const messages = await loadUserMessages(currentSession.id, currentSession.directory);
    if (messages.length === 0) {
      await ctx.reply(t("messages.empty"));
      return;
    }

    const pageSize = config.bot.messagesListLimit;
    const keyboard = buildMessagesListKeyboard(messages, 0, pageSize);
    const message = await ctx.reply(formatMessagesSelectText(0), {
      reply_markup: keyboard,
    });

    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "messages",
        stage: "list",
        messageId: message.message_id,
        projectDirectory: currentProject.worktree,
        sessionId: currentSession.id,
        messages,
        page: 0,
      },
    });
  } catch (error) {
    logger.error("[Messages] Error fetching messages list:", error);
    await ctx.reply(t("messages.fetch_error"));
  }
}

export async function handleMessagesCallback(
  ctx: Context,
  deps: MessagesCallbackDeps,
): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith(MESSAGES_CALLBACK_PREFIX)) {
    return false;
  }

  const metadata = parseMessagesMetadata(interactionManager.getSnapshot());
  const callbackMessageId = getCallbackMessageId(ctx);

  if (!metadata || callbackMessageId === null || metadata.messageId !== callbackMessageId) {
    await ctx.answerCallbackQuery({ text: t("messages.inactive_callback"), show_alert: true });
    return true;
  }

  try {
    if (data === MESSAGES_CALLBACK_REVERT) {
      if (metadata.stage !== "detail") {
        await ctx.answerCallbackQuery({ text: t("messages.inactive_callback"), show_alert: true });
        return true;
      }

      const selectedMessage = metadata.messages[metadata.selectedIndex];
      if (!selectedMessage) {
        await ctx.answerCallbackQuery({ text: t("messages.fetch_error"), show_alert: true });
        return true;
      }

      await ctx.answerCallbackQuery();

      try {
        await opencodeClient.session.revert({
          sessionID: metadata.sessionId,
          directory: metadata.projectDirectory,
          messageID: selectedMessage.id,
        });

        const successText = t("messages.revert_success", { text: selectedMessage.text });
        await ctx.editMessageText(truncateText(successText, TELEGRAM_MESSAGE_LIMIT), {
          reply_markup: undefined,
        });
        clearMessagesInteraction("messages_revert_success");
      } catch (error) {
        logger.error("[Messages] Error reverting message:", error);
        await ctx.editMessageText(t("messages.revert_error"), { reply_markup: undefined });
        clearMessagesInteraction("messages_revert_error");
      }

      return true;
    }

    if (data === MESSAGES_CALLBACK_FORK) {
      if (metadata.stage !== "detail") {
        await ctx.answerCallbackQuery({ text: t("messages.inactive_callback"), show_alert: true });
        return true;
      }

      const selectedMessage = metadata.messages[metadata.selectedIndex];
      if (!selectedMessage) {
        await ctx.answerCallbackQuery({ text: t("messages.fetch_error"), show_alert: true });
        return true;
      }

      await ctx.answerCallbackQuery();

      try {
        const { data: forkedSession, error: forkError } = await opencodeClient.session.fork({
          sessionID: metadata.sessionId,
          messageID: selectedMessage.id,
          directory: metadata.projectDirectory,
        });

        if (forkError || !forkedSession) {
          throw forkError || new Error("No session data received from fork");
        }

        logger.info(
          `[Messages] Forked session: id=${forkedSession.id}, title="${forkedSession.title}", from message=${selectedMessage.id}`,
        );

        const sessionInfo: SessionInfo = {
          id: forkedSession.id,
          title: forkedSession.title,
          directory: metadata.projectDirectory,
        };

        setCurrentSession(sessionInfo);
        clearAllInteractionState("session_forked");
        await ingestSessionInfoForCache(forkedSession);

        await attachToSession({
          bot: deps.bot,
          chatId: ctx.chat!.id,
          session: sessionInfo,
          ensureEventSubscription: deps.ensureEventSubscription,
        });

        const successText = t("messages.fork_success", { text: selectedMessage.text });
        await ctx.editMessageText(truncateText(successText, TELEGRAM_MESSAGE_LIMIT), {
          reply_markup: undefined,
        });
        clearMessagesInteraction("messages_fork_success");

        safeBackgroundTask({
          taskName: "messages.sendLatestAssistantResponse",
          task: () =>
            sendLatestAssistantResponse(
              ctx.api,
              ctx.chat!.id,
              forkedSession.id,
              metadata.projectDirectory,
            ),
        });
      } catch (error) {
        logger.error("[Messages] Error forking session:", error);
        await ctx.editMessageText(t("messages.fork_error"), { reply_markup: undefined });
        clearMessagesInteraction("messages_fork_error");
      }

      return true;
    }

    if (data === MESSAGES_CALLBACK_BACK) {
      if (metadata.stage !== "detail") {
        await ctx.answerCallbackQuery({ text: t("messages.inactive_callback"), show_alert: true });
        return true;
      }

      const pageSize = config.bot.messagesListLimit;
      const { page: normalizedPage } = calculateMessagesPaginationRange(
        metadata.messages.length,
        metadata.page,
        pageSize,
      );
      await ctx.editMessageText(formatMessagesSelectText(normalizedPage), {
        reply_markup: buildMessagesListKeyboard(metadata.messages, normalizedPage, pageSize),
      });
      await ctx.answerCallbackQuery();

      interactionManager.transition({
        expectedInput: "callback",
        metadata: {
          flow: "messages",
          stage: "list",
          messageId: metadata.messageId,
          projectDirectory: metadata.projectDirectory,
          sessionId: metadata.sessionId,
          messages: metadata.messages,
          page: normalizedPage,
        },
      });

      return true;
    }

    if (data === MESSAGES_CALLBACK_CANCEL) {
      clearMessagesInteraction("messages_cancelled");
      await ctx.answerCallbackQuery({ text: t("messages.cancelled_callback") });
      await ctx.deleteMessage().catch(() => {});
      return true;
    }

    const page = parseMessagePageCallback(data);
    if (page !== null) {
      if (metadata.stage !== "list") {
        await ctx.answerCallbackQuery({ text: t("callback.processing_error"), show_alert: true });
        return true;
      }

      const pageSize = config.bot.messagesListLimit;
      const { page: normalizedPage, totalPages } = calculateMessagesPaginationRange(
        metadata.messages.length,
        page,
        pageSize,
      );

      if (page >= totalPages || page < 0) {
        await ctx.answerCallbackQuery({ text: t("messages.page_empty_callback") });
        return true;
      }

      await ctx.editMessageText(formatMessagesSelectText(normalizedPage), {
        reply_markup: buildMessagesListKeyboard(metadata.messages, normalizedPage, pageSize),
      });
      await ctx.answerCallbackQuery();

      interactionManager.transition({
        expectedInput: "callback",
        metadata: {
          flow: "messages",
          stage: "list",
          messageId: metadata.messageId,
          projectDirectory: metadata.projectDirectory,
          sessionId: metadata.sessionId,
          messages: metadata.messages,
          page: normalizedPage,
        },
      });

      return true;
    }

    const messageIndex = parseSelectIndex(data);
    if (messageIndex === null || metadata.stage !== "list") {
      await ctx.answerCallbackQuery({ text: t("callback.processing_error"), show_alert: true });
      return true;
    }

    const selectedMessage = metadata.messages[messageIndex];
    if (!selectedMessage) {
      await ctx.answerCallbackQuery({ text: t("messages.inactive_callback"), show_alert: true });
      return true;
    }

    await ctx.editMessageText(formatMessageDetailText(selectedMessage), {
      reply_markup: buildMessageDetailKeyboard(),
    });
    await ctx.answerCallbackQuery();

    interactionManager.transition({
      expectedInput: "callback",
      metadata: {
        flow: "messages",
        stage: "detail",
        messageId: metadata.messageId,
        projectDirectory: metadata.projectDirectory,
        sessionId: metadata.sessionId,
        messages: metadata.messages,
        page: metadata.page,
        selectedIndex: messageIndex,
      },
    });

    return true;
  } catch (error) {
    logger.error("[Messages] Error handling messages callback:", error);
    clearMessagesInteraction("messages_callback_error");
    await ctx.answerCallbackQuery({ text: t("callback.processing_error") }).catch(() => {});
    return true;
  }
}
