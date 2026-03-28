import type { StreamingMessagePayload, ResponseStreamer } from "../streaming/response-streamer.js";
import type { TelegramTextFormat } from "./telegram-text.js";
import { logger } from "../../utils/logger.js";

interface FinalizeAssistantResponseOptions {
  responseStreaming: boolean;
  sessionId: string;
  messageId: string;
  messageText: string;
  responseStreamer: Pick<ResponseStreamer, "complete">;
  flushPendingServiceMessages: () => Promise<void>;
  prepareStreamingPayload: (messageText: string) => StreamingMessagePayload | null;
  formatSummary: (messageText: string) => string[];
  resolveFormat: () => TelegramTextFormat;
  getReplyKeyboard: () => unknown;
  sendText: (
    text: string,
    options: { reply_markup: unknown } | undefined,
    format: TelegramTextFormat,
  ) => Promise<void>;
  deleteMessages: (messageIds: number[]) => Promise<void>;
}

export async function finalizeAssistantResponse({
  responseStreaming,
  sessionId,
  messageId,
  messageText,
  responseStreamer,
  flushPendingServiceMessages,
  prepareStreamingPayload,
  formatSummary,
  resolveFormat,
  getReplyKeyboard,
  sendText,
  deleteMessages,
}: FinalizeAssistantResponseOptions): Promise<boolean> {
  let streamedMessageIds: number[] = [];

  if (responseStreaming) {
    const preparedStreamPayload = prepareStreamingPayload(messageText);
    if (preparedStreamPayload) {
      preparedStreamPayload.sendOptions = undefined;
      preparedStreamPayload.editOptions = undefined;
    }

    const result = await responseStreamer.complete(
      sessionId,
      messageId,
      preparedStreamPayload ?? undefined,
    );

    if (result.streamed) {
      streamedMessageIds = result.telegramMessageIds;
    }
  }

  await flushPendingServiceMessages();

  // When the response was streamed, delete the streamed messages and re-send
  // via the non-streamed path so the reply keyboard carries the latest context.
  if (streamedMessageIds.length > 0) {
    try {
      await deleteMessages(streamedMessageIds);
    } catch (err) {
      logger.warn("[FinalizeResponse] Failed to delete streamed messages, sending with keyboard anyway:", err);
    }
  }

  const parts = formatSummary(messageText);
  const format = resolveFormat();

  for (const part of parts) {
    const keyboard = getReplyKeyboard();
    const options = keyboard ? { reply_markup: keyboard } : undefined;
    await sendText(part, options, format);
  }

  return false;
}
