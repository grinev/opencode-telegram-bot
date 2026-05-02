import type { Api, RawApi } from "grammy";
import { logger } from "../../utils/logger.js";
import {
  editMessageWithMarkdownFallback,
  sendMessageWithMarkdownFallback,
} from "./send-with-markdown-fallback.js";
import type { TelegramRenderedPart } from "../../telegram/render/types.js";

type SendMessageApi = Pick<Api<RawApi>, "sendMessage">;
type EditMessageApi = Pick<Api<RawApi>, "editMessageText">;

type TelegramSendMessageOptions = Parameters<SendMessageApi["sendMessage"]>[2];
type TelegramEditMessageOptions = Parameters<EditMessageApi["editMessageText"]>[3];

export type TelegramTextFormat = "raw" | "markdown_v2";

interface SendBotTextParams {
  api: SendMessageApi;
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
}

interface EditRenderedBotPartParams {
  api: EditMessageApi;
  chatId: Parameters<EditMessageApi["editMessageText"]>[0];
  messageId: Parameters<EditMessageApi["editMessageText"]>[1];
  part: TelegramRenderedPart;
  options?: TelegramEditMessageOptions;
}

interface RenderedPartDeliveryResult {
  deliveredSignature: string;
}

interface RenderedPartSendResult extends RenderedPartDeliveryResult {
  messageId: number;
}

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
  } as NonNullable<T> & {
    parse_mode?: unknown;
    entities?: unknown;
  };

  delete rawOptions.parse_mode;
  delete rawOptions.entities;

  return rawOptions as T;
}

export function getTelegramRenderedPartSignature(
  part: Pick<TelegramRenderedPart, "text" | "entities">,
): string {
  return `${part.text}\n${JSON.stringify(part.entities ?? null)}`;
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
}: SendRenderedBotPartParams): Promise<RenderedPartSendResult> {
  const rawOptions = stripRichFormattingOptions(options);

  logger.debug("[Bot] Sending rendered Telegram part", {
    source: part.source,
    textLength: part.text.length,
    fallbackTextLength: part.fallbackText.length,
    entityCount: part.entities?.length ?? 0,
  });

  if (!part.entities?.length) {
    const sentMessage = await api.sendMessage(chatId, part.text, rawOptions);
    return {
      messageId: sentMessage.message_id,
      deliveredSignature: getTelegramRenderedPartSignature({ text: part.text }),
    };
  }

  try {
    const sentMessage = await api.sendMessage(chatId, part.text, {
      ...(rawOptions || {}),
      entities: part.entities,
    });

    return {
      messageId: sentMessage.message_id,
      deliveredSignature: getTelegramRenderedPartSignature(part),
    };
  } catch (error) {
    logger.warn(
      "[Bot] Entity payload send failed, retrying assistant message part in raw mode",
      error,
    );
    const sentMessage = await api.sendMessage(chatId, part.fallbackText, rawOptions);
    logger.debug("[Bot] Assistant message part sent in raw fallback mode", {
      fallbackTextLength: part.fallbackText.length,
    });
    return {
      messageId: sentMessage.message_id,
      deliveredSignature: getTelegramRenderedPartSignature({ text: part.fallbackText }),
    };
  }
}

export async function editRenderedBotPart({
  api,
  chatId,
  messageId,
  part,
  options,
}: EditRenderedBotPartParams): Promise<RenderedPartDeliveryResult> {
  const rawOptions = stripRichFormattingOptions(options);

  logger.debug("[Bot] Editing rendered Telegram part", {
    messageId,
    source: part.source,
    textLength: part.text.length,
    fallbackTextLength: part.fallbackText.length,
    entityCount: part.entities?.length ?? 0,
  });

  if (!part.entities?.length) {
    await api.editMessageText(chatId, messageId, part.text, rawOptions);
    return {
      deliveredSignature: getTelegramRenderedPartSignature({ text: part.text }),
    };
  }

  try {
    await api.editMessageText(chatId, messageId, part.text, {
      ...(rawOptions || {}),
      entities: part.entities,
    });

    return {
      deliveredSignature: getTelegramRenderedPartSignature(part),
    };
  } catch (error) {
    logger.warn("[Bot] Entity payload edit failed, retrying assistant edit part in raw mode", error);
    await api.editMessageText(chatId, messageId, part.fallbackText, rawOptions);
    logger.debug("[Bot] Assistant edit part applied in raw fallback mode", {
      messageId,
      fallbackTextLength: part.fallbackText.length,
    });
    return {
      deliveredSignature: getTelegramRenderedPartSignature({ text: part.fallbackText }),
    };
  }
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
