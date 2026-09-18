import type { Api, RawApi } from "grammy";
import { loadFullSessionHistory } from "../../app/services/session-history-service.js";
import { conversationMessageTracker } from "../../app/managers/conversation-message-tracker.js";
import { chunkPlainText } from "../render/chunker.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";

type SendMessageApi = Pick<Api<RawApi>, "sendMessage">;

/** Keep each Telegram send comfortably below the 4096-char hard limit. */
const HISTORY_CHUNK_MAX_CHARS = 3800;

const SEND_PACE_DELAY_MS = 50;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RenderFullSessionHistoryParams {
  api: SendMessageApi;
  chatId: number;
  sessionId: string;
  directory: string;
  sessionTitle: string;
}

/**
 * Renders the full conversation of a session into the chat, oldest first:
 * one header message, then one Telegram message per conversation item
 * (long texts split across multiple sends). Every sent message id is
 * tracked so a later session switch can clean them up.
 *
 * Plain text only: stored assistant/user text may contain raw code that
 * would break markdown parse modes.
 */
export async function renderFullSessionHistory({
  api,
  chatId,
  sessionId,
  directory,
  sessionTitle,
}: RenderFullSessionHistoryParams): Promise<void> {
  const { entries, totalConversationMessages } = await loadFullSessionHistory(sessionId, directory);

  let headerText = t("sessions.history.title", {
    title: sessionTitle,
    shown: entries.length,
    total: totalConversationMessages,
  });
  if (entries.length < totalConversationMessages) {
    headerText += t("sessions.history.truncated");
  }

  const sentIds: number[] = [];
  try {
    const headerMessage = await api.sendMessage(chatId, headerText);
    sentIds.push(headerMessage.message_id);
  } catch (err) {
    logger.error("[History] Failed to send history header:", err);
    return;
  }

  for (const entry of entries) {
    const label = entry.role === "user" ? t("sessions.preview.you") : t("sessions.preview.agent");
    const chunks = chunkPlainText(entry.text, { maxChars: HISTORY_CHUNK_MAX_CHARS });

    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index];
      if (!chunk) {
        continue;
      }
      const prefixedText = index === 0 ? `${label} ${chunk.fallbackText}` : chunk.fallbackText;
      try {
        const sent = await api.sendMessage(chatId, prefixedText);
        sentIds.push(sent.message_id);
      } catch (err) {
        logger.error("[History] Failed to send history message:", err);
      }
      await sleep(SEND_PACE_DELAY_MS);
    }
  }

  conversationMessageTracker.trackMany(chatId, sentIds);
  logger.debug(
    `[History] Rendered session=${sessionId}: entries=${entries.length}, telegramMessages=${sentIds.length}`,
  );
}
