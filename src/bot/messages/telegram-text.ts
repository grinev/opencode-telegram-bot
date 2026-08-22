import type { Api, RawApi } from "grammy";
import type { MessageEntity } from "grammy/types";
import { logger } from "../../utils/logger.js";
import {
  editMessageWithMarkdownFallback,
  isTelegramBadRequestError,
  sendMessageWithMarkdownFallback,
} from "./send-with-markdown-fallback.js";
import { chunkPlainText } from "../render/chunker.js";
import { TELEGRAM_TEXT_MESSAGE_LIMIT } from "../render/limits.js";
import { getTelegramRenderedPartSignature } from "../render/part-signature.js";
import type { TelegramRenderedPart } from "../render/types.js";

type SendMessageApi = Pick<Api<RawApi>, "sendMessage" | "sendRichMessage">;
type EditMessageApi = Pick<Api<RawApi>, "editMessageText">;
type SendDraftApi = Pick<Api<RawApi>, "sendMessageDraft" | "sendRichMessageDraft">;

type TelegramSendMessageOptions = Parameters<SendMessageApi["sendMessage"]>[2];
type TelegramEditMessageOptions = Parameters<EditMessageApi["editMessageText"]>[3];
type TelegramSendRichOptions = Parameters<SendMessageApi["sendRichMessage"]>[2];

export type TelegramTextFormat = "raw" | "markdown_v2";

interface SendBotTextParams {
  api: Pick<Api<RawApi>, "sendMessage">;
  chatId: Parameters<SendMessageApi["sendMessage"]>[0];
  text: string;
  rawFallbackText?: string;
  options?: TelegramSendMessageOptions;
  format?: TelegramTextFormat;
}

interface EditBotTextParams {
  api: EditMessageApi;
  chatId: Parameters<EditMessageApi["editMessageText"]>[0];
  messageId: Parameters<EditMessageApi["editMessageText"]>[1];
  text: string;
  rawFallbackText?: string;
  options?: TelegramEditMessageOptions;
  format?: TelegramTextFormat;
}

interface SendRenderedBotPartParams {
  api: SendMessageApi;
  chatId: Parameters<SendMessageApi["sendMessage"]>[0];
  part: TelegramRenderedPart;
  options?: TelegramSendMessageOptions;
  /** Streaming callers degrade whole payloads themselves and must opt out. */
  allowPlainFallback?: boolean;
}

interface EditRenderedBotPartParams {
  api: EditMessageApi;
  chatId: Parameters<EditMessageApi["editMessageText"]>[0];
  messageId: Parameters<EditMessageApi["editMessageText"]>[1];
  part: TelegramRenderedPart;
  options?: TelegramEditMessageOptions;
  allowPlainFallback?: boolean;
}

interface RenderedPartDeliveryResult {
  deliveredSignature: string;
  degradedToPlain?: boolean;
}

interface RenderedPartSendResult extends RenderedPartDeliveryResult {
  messageId: number;
}

export { getTelegramRenderedPartSignature };

function resolveParseMode(format: TelegramTextFormat | undefined): "MarkdownV2" | undefined {
  if (format === "markdown_v2") {
    return "MarkdownV2";
  }

  return undefined;
}

function stripRichFormattingOptions<T extends TelegramSendMessageOptions | undefined>(
  options: T,
): T {
  if (!options) {
    return options;
  }

  const rawOptions = {
    ...options,
  } as NonNullable<T> & { parse_mode?: unknown };

  delete rawOptions.parse_mode;

  return rawOptions as T;
}

function isPlainPart(part: TelegramRenderedPart): boolean {
  return part.source === "plain" || part.blocks.length === 0;
}

function plainSignature(text: string, entities?: MessageEntity[]): string {
  return getTelegramRenderedPartSignature({
    blocks: [],
    fallbackText: text,
    source: "plain",
    entities,
  });
}

/** Plain parts may carry entities; today only reasoning does. */
function withPlainEntities<T extends { entities?: MessageEntity[] } | undefined>(
  options: T,
  part: TelegramRenderedPart,
): T {
  if (!part.entities?.length) {
    return options;
  }

  return { ...(options ?? {}), entities: part.entities } as T;
}

export async function sendBotText({
  api,
  chatId,
  text,
  rawFallbackText,
  options,
  format = "raw",
}: SendBotTextParams): Promise<void> {
  await sendMessageWithMarkdownFallback({
    api,
    chatId,
    text,
    rawFallbackText,
    options,
    parseMode: resolveParseMode(format),
  });
}

export async function sendRenderedBotPart({
  api,
  chatId,
  part,
  options,
  allowPlainFallback = true,
}: SendRenderedBotPartParams): Promise<RenderedPartSendResult> {
  const rawOptions = stripRichFormattingOptions(options);

  logger.debug("[Bot] Sending rendered Telegram part", {
    source: part.source,
    blockCount: part.blocks.length,
    fallbackTextLength: part.fallbackText.length,
  });

  if (isPlainPart(part)) {
    const sentMessage = await api.sendMessage(
      chatId,
      part.fallbackText,
      withPlainEntities(rawOptions, part),
    );
    return {
      messageId: sentMessage.message_id,
      deliveredSignature: plainSignature(part.fallbackText, part.entities),
    };
  }

  try {
    const sentMessage = await api.sendRichMessage(
      chatId,
      { blocks: part.blocks },
      rawOptions as TelegramSendRichOptions,
    );

    return {
      messageId: sentMessage.message_id,
      deliveredSignature: getTelegramRenderedPartSignature(part),
    };
  } catch (error) {
    if (!allowPlainFallback || !isTelegramBadRequestError(error)) {
      throw error;
    }

    logger.warn("[Bot] Rich message send failed, retrying assistant part as plain text", error);

    const chunks = chunkPlainText(part.fallbackText);
    let firstMessageId: number | null = null;
    for (const chunk of chunks) {
      const sentMessage = await api.sendMessage(chatId, chunk.fallbackText, rawOptions);
      firstMessageId ??= sentMessage.message_id;
    }

    if (firstMessageId === null) {
      throw error;
    }

    logger.debug("[Bot] Assistant message part sent in plain fallback mode", {
      fallbackTextLength: part.fallbackText.length,
      partCount: chunks.length,
    });

    return {
      messageId: firstMessageId,
      deliveredSignature: plainSignature(part.fallbackText),
      degradedToPlain: true,
    };
  }
}

export async function editRenderedBotPart({
  api,
  chatId,
  messageId,
  part,
  options,
  allowPlainFallback = true,
}: EditRenderedBotPartParams): Promise<RenderedPartDeliveryResult> {
  const rawOptions = stripRichFormattingOptions(options);

  logger.debug("[Bot] Editing rendered Telegram part", {
    messageId,
    source: part.source,
    blockCount: part.blocks.length,
    fallbackTextLength: part.fallbackText.length,
  });

  if (isPlainPart(part)) {
    await api.editMessageText(
      chatId,
      messageId,
      part.fallbackText,
      withPlainEntities(rawOptions, part),
    );
    return {
      deliveredSignature: plainSignature(part.fallbackText, part.entities),
    };
  }

  try {
    await api.editMessageText(chatId, messageId, { blocks: part.blocks }, rawOptions);

    return {
      deliveredSignature: getTelegramRenderedPartSignature(part),
    };
  } catch (error) {
    // An edit targets exactly one message, so there is nothing to split it
    // across; a plain retry is only possible when the text fits a message.
    if (
      !allowPlainFallback ||
      !isTelegramBadRequestError(error) ||
      part.fallbackText.length > TELEGRAM_TEXT_MESSAGE_LIMIT
    ) {
      throw error;
    }

    logger.warn("[Bot] Rich message edit failed, retrying assistant edit as plain text", error);
    await api.editMessageText(chatId, messageId, part.fallbackText, rawOptions);
    logger.debug("[Bot] Assistant edit part applied in plain fallback mode", {
      messageId,
      fallbackTextLength: part.fallbackText.length,
    });
    return {
      deliveredSignature: plainSignature(part.fallbackText),
      degradedToPlain: true,
    };
  }
}

interface SendDraftBotPartParams {
  api: SendDraftApi;
  chatId: Parameters<SendDraftApi["sendMessageDraft"]>[0];
  draftId: number;
  part: TelegramRenderedPart;
}

interface CompleteDraftPartParams {
  api: SendMessageApi;
  chatId: Parameters<SendMessageApi["sendMessage"]>[0];
  part: TelegramRenderedPart;
  options?: TelegramSendMessageOptions;
}

export async function sendDraftBotPart({
  api,
  chatId,
  draftId,
  part,
}: SendDraftBotPartParams): Promise<RenderedPartDeliveryResult> {
  logger.debug("[Bot] Sending draft part", {
    draftId,
    source: part.source,
    blockCount: part.blocks.length,
  });

  if (isPlainPart(part)) {
    await api.sendMessageDraft(chatId, draftId, part.fallbackText);
    return {
      deliveredSignature: plainSignature(part.fallbackText),
    };
  }

  await api.sendRichMessageDraft(chatId, draftId, { blocks: part.blocks });
  return {
    deliveredSignature: getTelegramRenderedPartSignature(part),
  };
}

export async function completeDraftPart({
  api,
  chatId,
  part,
  options,
}: CompleteDraftPartParams): Promise<RenderedPartSendResult> {
  const rawOptions = stripRichFormattingOptions(options);

  logger.debug("[Bot] Completing draft with real message", {
    source: part.source,
    blockCount: part.blocks.length,
  });

  if (isPlainPart(part)) {
    const sentMessage = await api.sendMessage(chatId, part.fallbackText, rawOptions);
    return {
      messageId: sentMessage.message_id,
      deliveredSignature: plainSignature(part.fallbackText),
    };
  }

  const sentMessage = await api.sendRichMessage(
    chatId,
    { blocks: part.blocks },
    rawOptions as TelegramSendRichOptions,
  );
  return {
    messageId: sentMessage.message_id,
    deliveredSignature: getTelegramRenderedPartSignature(part),
  };
}

export async function editBotText({
  api,
  chatId,
  messageId,
  text,
  rawFallbackText,
  options,
  format = "raw",
}: EditBotTextParams): Promise<void> {
  await editMessageWithMarkdownFallback({
    api,
    chatId,
    messageId,
    text,
    rawFallbackText,
    options,
    parseMode: resolveParseMode(format),
  });
}
