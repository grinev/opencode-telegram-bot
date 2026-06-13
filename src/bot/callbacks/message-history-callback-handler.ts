import type { Bot, Context } from "grammy";
import { config } from "../../config.js";
import type { InteractionState } from "../../app/types/interaction.js";
import { clearAllInteractionState, interactionManager } from "../../app/managers/interaction-manager.js";
import { opencodeClient } from "../../opencode/client.js";
import { setCurrentSession } from "../../app/services/session-service.js";
import type { SessionInfo } from "../../app/types/session.js";
import { attachToSession } from "../../app/services/attach-service.js";
import { ingestSessionInfoForCache } from "../../app/services/session-cache-service.js";
import { loadLatestAssistantResponse } from "../../app/services/message-history-service.js";
import type { UserMessageItem } from "../../app/services/message-history-service.js";
import { isForegroundBusy } from "../../app/services/run-control-service.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { safeBackgroundTask } from "../../utils/safe-background-task.js";
import { renderAssistantFinalPartsSafe } from "../messages/assistant-rendering.js";
import { replyBusyBlocked } from "../messages/busy-blocked-renderer.js";
import { sendRenderedBotPart } from "../messages/telegram-text.js";
import {
  buildMessageDetailKeyboard,
  buildMessagesListKeyboard,
  calculateMessagesPaginationRange,
  formatMessageDetailText,
  formatMessagesSelectText,
  MESSAGES_CALLBACK_BACK,
  MESSAGES_CALLBACK_CANCEL,
  MESSAGES_CALLBACK_FORK,
  MESSAGES_CALLBACK_PREFIX,
  MESSAGES_CALLBACK_REVERT,
  parseMessagePageCallback,
  parseMessageSelectCallback,
  TELEGRAM_MESSAGE_LIMIT,
  truncateMessageHistoryText,
} from "../menus/message-history-menu.js";

export interface MessagesCallbackDeps {
  bot: Bot<Context>;
  ensureEventSubscription: (directory: string) => Promise<void>;
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

function getCallbackMessageId(ctx: Context): number | null {
  const message = ctx.callbackQuery?.message;
  if (!message || !("message_id" in message)) {
    return null;
  }

  const messageId = (message as { message_id?: number }).message_id;
  return typeof messageId === "number" ? messageId : null;
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

export async function handleMessagesCallback(
  ctx: Context,
  deps: MessagesCallbackDeps,
): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith(MESSAGES_CALLBACK_PREFIX)) {
    return false;
  }

  if (isForegroundBusy()) {
    await replyBusyBlocked(ctx);
    return true;
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
        await ctx.editMessageText(truncateMessageHistoryText(successText, TELEGRAM_MESSAGE_LIMIT), {
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
        await ctx.editMessageText(truncateMessageHistoryText(successText, TELEGRAM_MESSAGE_LIMIT), {
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

    const messageIndex = parseMessageSelectCallback(data);
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
