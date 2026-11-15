import type { StreamingMessagePayload, ResponseStreamer } from "./response-streamer.js";
import { logger } from "../../utils/logger.js";
import type { TelegramRenderedPart } from "../render/types.js";
import { hasDeferredImages } from "../messages/assistant-image-delivery.js";
import { omitMarkdownImages } from "../render/block-parser.js";

interface FinalizeAssistantResponseOptions {
  sessionId: string;
  messageId: string;
  messageText: string;
  responseStreamer: Pick<ResponseStreamer, "complete">;
  flushPendingServiceMessages: () => Promise<void>;
  prepareStreamingPayload: (messageText: string) => StreamingMessagePayload | null;
  renderFinalParts: (messageText: string) => TelegramRenderedPart[];
  getReplyKeyboard: () => unknown;
  notifyFirstFinalPart?: boolean;
  afterTextAccepted?: () => Promise<void>;
  strictFinalPayload?: boolean;
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
  notifyFirstFinalPart = false,
  afterTextAccepted,
  strictFinalPayload = false,
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

  let preparedStreamPayload = prepareStreamingPayload(messageText);
  const imageParts =
    strictFinalPayload || preparedStreamPayload?.parts.some(hasDeferredImages)
      ? renderFinalParts(messageText)
      : undefined;
  if (imageParts) preparedStreamPayload = prepareStreamingPayload(omitMarkdownImages(messageText));
  if (preparedStreamPayload) {
    preparedStreamPayload.sendOptions = streamSendOptions;
    preparedStreamPayload.editOptions = undefined;
  }

  const result = imageParts
    ? await responseStreamer.complete(sessionId, messageId, preparedStreamPayload ?? undefined, {
        notifyFirstCompletePart: notifyFirstFinalPart,
        finalPayload: { parts: imageParts, sendOptions: streamSendOptions },
      })
    : notifyFirstFinalPart
      ? await responseStreamer.complete(sessionId, messageId, preparedStreamPayload ?? undefined, {
          notifyFirstCompletePart: true,
        })
      : await responseStreamer.complete(sessionId, messageId, preparedStreamPayload ?? undefined);

  if (result.streamed) {
    await afterTextAccepted?.();
    await flushPendingServiceMessages();
    logger.debug(
      `[FinalizeResponse] Finalized streamed assistant message in place: session=${sessionId}, message=${messageId}, telegramMessages=${result.telegramMessageIds.length}`,
    );
    return true;
  }

  if (!strictFinalPayload) await flushPendingServiceMessages();
  const parts = imageParts ?? renderFinalParts(messageText);

  let notifyNextPart = notifyFirstFinalPart;
  for (const part of parts) {
    await sendRenderedPart(part, notifyNextPart ? replyOptions : silentReplyOptions);
    notifyNextPart = false;
  }
  await afterTextAccepted?.();
  if (strictFinalPayload) await flushPendingServiceMessages();

  return false;
}
