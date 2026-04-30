import { logger } from "../../utils/logger.js";
import type { Api, RawApi } from "grammy";
import { getTelegramTargetSendOptions, type TelegramTarget } from "../../telegram/target.js";

type SendMessageApi = Pick<Api<RawApi>, "sendMessage">;
type EditMessageApi = Pick<Api<RawApi>, "editMessageText">;
type TelegramSendMessageOptions = Parameters<SendMessageApi["sendMessage"]>[2];
type TelegramEditMessageOptions = Parameters<EditMessageApi["editMessageText"]>[3];

interface SendMessageWithMarkdownFallbackParams {
  api: SendMessageApi;
  target: TelegramTarget;
  text: string;
  rawFallbackText?: string;
  options?: TelegramSendMessageOptions;
  parseMode?: "Markdown" | "MarkdownV2";
}

interface EditMessageWithMarkdownFallbackParams {
  api: EditMessageApi;
  chatId: Parameters<EditMessageApi["editMessageText"]>[0];
  messageId: Parameters<EditMessageApi["editMessageText"]>[1];
  text: string;
  rawFallbackText?: string;
  options?: TelegramEditMessageOptions;
  parseMode?: "Markdown" | "MarkdownV2";
}

const MARKDOWN_PARSE_ERROR_MARKERS = [
  "can't parse entities",
  "can't parse entity",
  "can't find end of the entity",
  "entity beginning",
  "bad request: can't parse",
];

const MARKDOWN_V2_RESERVED_CHARS = new Set([
  "_",
  "*",
  "[",
  "]",
  "(",
  ")",
  "~",
  "`",
  ">",
  "#",
  "+",
  "-",
  "=",
  "|",
  "{",
  "}",
  ".",
  "!",
  "\\",
]);
const MARKDOWN_V2_ESCAPED_CHAR = /\\([_\*\[\]\(\)~`>#+\-=|{}.!\\])/g;

function escapeTelegramMarkdownV2(text: string): string {
  let result = "";
  let trailingBackslashes = 0;

  for (const char of text) {
    if (char === "\\") {
      result += char;
      trailingBackslashes += 1;
      continue;
    }

    const isEscaped = trailingBackslashes % 2 === 1;
    trailingBackslashes = 0;

    if (MARKDOWN_V2_RESERVED_CHARS.has(char) && !isEscaped) {
      result += `\\${char}`;
      continue;
    }

    result += char;
  }

  return result;
}

function unescapeTelegramMarkdownV2(text: string): string {
  return text.replace(MARKDOWN_V2_ESCAPED_CHAR, "$1");
}

function stripMarkdownFormattingOptions<
  T extends TelegramSendMessageOptions | TelegramEditMessageOptions | undefined,
>(options: T): T {
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

function getErrorText(error: unknown): string {
  const parts: string[] = [];

  if (error instanceof Error) {
    parts.push(error.message);
  }

  if (typeof error === "object" && error !== null) {
    const description = Reflect.get(error, "description");
    if (typeof description === "string") {
      parts.push(description);
    }

    const message = Reflect.get(error, "message");
    if (typeof message === "string") {
      parts.push(message);
    }
  }

  if (typeof error === "string") {
    parts.push(error);
  }

  if (parts.length === 0) {
    return "";
  }

  return parts.join("\n").toLowerCase();
}

export function isTelegramMarkdownParseError(error: unknown): boolean {
  const errorText = getErrorText(error);
  if (!errorText) {
    return false;
  }

  return MARKDOWN_PARSE_ERROR_MARKERS.some((marker) => errorText.includes(marker));
}

export async function sendMessageWithMarkdownFallback({
  api,
  target,
  text,
  rawFallbackText,
  options,
  parseMode,
}: SendMessageWithMarkdownFallbackParams): Promise<
  Awaited<ReturnType<SendMessageApi["sendMessage"]>>
> {
  const threadOptions = getTelegramTargetSendOptions(target);
  const sendOptions =
    Object.keys(threadOptions).length > 0 ? { ...(options || {}), ...threadOptions } : options;

  if (!parseMode) {
    return api.sendMessage(target.chatId, text, sendOptions);
  }

  const markdownOptions: TelegramSendMessageOptions = {
    ...sendOptions,
    parse_mode: parseMode,
  };

  const fallbackText =
    rawFallbackText ?? (parseMode === "MarkdownV2" ? unescapeTelegramMarkdownV2(text) : text);

  try {
    return await api.sendMessage(target.chatId, text, markdownOptions);
  } catch (error) {
    if (!isTelegramMarkdownParseError(error)) {
      throw error;
    }

    if (parseMode === "MarkdownV2") {
      const escapedText = escapeTelegramMarkdownV2(text);
      if (escapedText !== text) {
        logger.warn("[Bot] Markdown parse failed, retrying message with escaped MarkdownV2", error);

        try {
          return await api.sendMessage(target.chatId, escapedText, markdownOptions);
        } catch (escapedError) {
          if (!isTelegramMarkdownParseError(escapedError)) {
            throw escapedError;
          }

          logger.warn(
            "[Bot] Escaped Markdown parse failed, retrying message in raw mode",
            escapedError,
          );
          return api.sendMessage(
            target.chatId,
            fallbackText,
            stripMarkdownFormattingOptions(sendOptions),
          );
        }
      }
    }

    logger.warn("[Bot] Markdown parse failed, retrying message in raw mode", error);
    return api.sendMessage(target.chatId, fallbackText, stripMarkdownFormattingOptions(sendOptions));
  }
}

export async function editMessageWithMarkdownFallback({
  api,
  chatId,
  messageId,
  text,
  rawFallbackText,
  options,
  parseMode,
}: EditMessageWithMarkdownFallbackParams): Promise<
  Awaited<ReturnType<EditMessageApi["editMessageText"]>>
> {
  if (!parseMode) {
    return api.editMessageText(chatId, messageId, text, options);
  }

  const markdownOptions: TelegramEditMessageOptions = {
    ...(options || {}),
    parse_mode: parseMode,
  };

  const fallbackText =
    rawFallbackText ?? (parseMode === "MarkdownV2" ? unescapeTelegramMarkdownV2(text) : text);

  try {
    return await api.editMessageText(chatId, messageId, text, markdownOptions);
  } catch (error) {
    if (!isTelegramMarkdownParseError(error)) {
      throw error;
    }

    if (parseMode === "MarkdownV2") {
      const escapedText = escapeTelegramMarkdownV2(text);
      if (escapedText !== text) {
        logger.warn(
          "[Bot] Markdown parse failed, retrying edited message with escaped MarkdownV2",
          error,
        );

        try {
          return await api.editMessageText(chatId, messageId, escapedText, markdownOptions);
        } catch (escapedError) {
          if (!isTelegramMarkdownParseError(escapedError)) {
            throw escapedError;
          }

          logger.warn(
            "[Bot] Escaped Markdown parse failed, retrying edited message in raw mode",
            escapedError,
          );
          return api.editMessageText(
            chatId,
            messageId,
            fallbackText,
            stripMarkdownFormattingOptions(options),
          );
        }
      }
    }

    logger.warn("[Bot] Markdown parse failed, retrying edited message in raw mode", error);
    return api.editMessageText(
      chatId,
      messageId,
      fallbackText,
      stripMarkdownFormattingOptions(options),
    );
  }
}
