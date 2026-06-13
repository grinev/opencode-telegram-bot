import type { StreamingMessagePayload, ResponseStreamer } from "./response-streamer.js";
import { logger } from "../../utils/logger.js";
import type { TelegramRenderedPart } from "../render/types.js";

interface FinalizeAssistantResponseOptions {
  sessionId: string;
  messageId: string;
  messageText: string;
  responseStreamer: Pick<ResponseStreamer, "complete">;
  flushPendingServiceMessages: () => Promise<void>;
  prepareStreamingPayload: (messageText: string) => StreamingMessagePayload | null;
  renderFinalParts: (messageText: string) => TelegramRenderedPart[];
  getReplyKeyboard: () => unknown;
  sendRenderedPart: (
    part: TelegramRenderedPart,
    options:
      | {
          reply_markup?: unknown;
          disable_notification?: boolean;
        }
      | undefined,
  ) => Promise<void>;
}

export async function finalizeAssistantResponse({
  sessionId,
  messageId,
  messageText,
  responseStreamer,
  flushPendingServiceMessages,
  prepareStreamingPayload,
  renderFinalParts,
  getReplyKeyboard,
  sendRenderedPart,
}: FinalizeAssistantResponseOptions): Promise<boolean> {
  logger.debug(
    `[FinalizeResponse] Final assistant raw text received: session=${sessionId}, message=${messageId}`,
    messageText,
  );

  const keyboard = getReplyKeyboard();
  const replyOptions = keyboard ? { reply_markup: keyboard } : undefined;
  const silentReplyOptions = {
    disable_notification: true,
    ...(replyOptions ?? {}),
  };
  const streamSendOptions = {
    ...silentReplyOptions,
  } as StreamingMessagePayload["sendOptions"];

  const preparedStreamPayload = prepareStreamingPayload(messageText);
  if (preparedStreamPayload) {
    preparedStreamPayload.sendOptions = streamSendOptions;
    preparedStreamPayload.editOptions = undefined;
  }

  const result = await responseStreamer.complete(
    sessionId,
    messageId,
    preparedStreamPayload ?? undefined,
  );

  await flushPendingServiceMessages();

  if (result.streamed) {
    logger.debug(
      `[FinalizeResponse] Finalized streamed assistant message in place: session=${sessionId}, message=${messageId}, telegramMessages=${result.telegramMessageIds.length}`,
    );
    return true;
  }

  const parts = renderFinalParts(messageText);

  for (const part of parts) {
    await sendRenderedPart(part, silentReplyOptions);
  }

  return false;
}
