import { config } from "../../config.js";
import type { MessageFormatMode } from "../../config.js";
import { logger } from "../../utils/logger.js";
import { normalizeMarkdownForTelegramRendering } from "../render/markdown-normalizer.js";
import { convertToTelegramMarkdownV2 } from "../render/markdown-to-telegram-v2.js";

const TELEGRAM_MESSAGE_LIMIT = 4096;
const MARKDOWN_V2_RESERVED_CHARS = /([_\*\[\]\(\)~`>#+\-=|{}.!\\])/g;

interface SplitTextOptions {
  avoidTrailingMarkdownEscape?: boolean;
}

function endsWithOddTrailingBackslashes(text: string, start: number, end: number): boolean {
  let backslashCount = 0;

  for (let index = end - 1; index >= start; index--) {
    if (text[index] !== "\\") {
      break;
    }
    backslashCount += 1;
  }

  return backslashCount % 2 === 1;
}

function resolveSplitEndIndex(
  text: string,
  currentIndex: number,
  maxLength: number,
  options?: SplitTextOptions,
): number {
  const hardLimit = Math.min(text.length, currentIndex + maxLength);
  if (hardLimit >= text.length) {
    return text.length;
  }

  let endIndex = hardLimit;
  const breakPoint = text.lastIndexOf("\n", endIndex);
  if (breakPoint > currentIndex) {
    endIndex = breakPoint + 1;
  }

  if (!options?.avoidTrailingMarkdownEscape) {
    return endIndex;
  }

  while (endIndex > currentIndex && endsWithOddTrailingBackslashes(text, currentIndex, endIndex)) {
    endIndex -= 1;
  }

  return endIndex > currentIndex ? endIndex : hardLimit;
}

function splitText(text: string, maxLength: number, options?: SplitTextOptions): string[] {
  const parts: string[] = [];
  let currentIndex = 0;

  while (currentIndex < text.length) {
    const endIndex = resolveSplitEndIndex(text, currentIndex, maxLength, options);

    if (endIndex <= currentIndex) {
      const fallbackEnd = Math.min(text.length, currentIndex + 1);
      parts.push(text.slice(currentIndex, fallbackEnd));
      currentIndex = fallbackEnd;
      continue;
    }

    parts.push(text.slice(currentIndex, endIndex));
    currentIndex = endIndex;
  }

  return parts;
}

export function formatSummary(text: string): string[] {
  return formatSummaryWithMode(text, config.bot.messageFormatMode);
}

export function escapePlainTextForTelegramMarkdownV2(text: string): string {
  return text.replace(MARKDOWN_V2_RESERVED_CHARS, "\\$1");
}

function formatMarkdownForTelegram(text: string): string {
  try {
    const preprocessed = normalizeMarkdownForTelegramRendering(text);
    return escapeMarkdownV2PipesOutsideCode(convertToTelegramMarkdownV2(preprocessed));
  } catch (error) {
    logger.warn("[Formatter] Failed to convert markdown summary, falling back to raw text", error);
    return text;
  }
}

function escapeMarkdownV2PipesOutsideCode(text: string): string {
  let result = "";
  let index = 0;
  let inInlineCode = false;
  let inCodeFence = false;

  while (index < text.length) {
    if (text.startsWith("```", index)) {
      result += "```";
      index += 3;
      inCodeFence = !inCodeFence;
      continue;
    }

    const char = text[index];

    if (!inCodeFence && char === "`") {
      inInlineCode = !inInlineCode;
      result += char;
      index += 1;
      continue;
    }

    if (!inCodeFence && !inInlineCode && char === "|" && text[index - 1] !== "\\") {
      result += "\\|";
      index += 1;
      continue;
    }

    result += char;
    index += 1;
  }

  return result;
}

export function formatSummaryWithMode(
  text: string,
  mode: MessageFormatMode,
  maxLength: number = TELEGRAM_MESSAGE_LIMIT,
): string[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  const normalizedMaxLength = Math.max(1, Math.floor(maxLength));
  const rawTextLimit =
    mode === "raw" ? Math.max(1, normalizedMaxLength - "```\n\n```".length) : normalizedMaxLength;
  const parts = splitText(text, rawTextLimit);
  const formattedParts: string[] = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }

    if (mode === "markdown") {
      const converted = formatMarkdownForTelegram(trimmed);
      const convertedParts = splitText(converted, normalizedMaxLength, {
        avoidTrailingMarkdownEscape: true,
      });

      for (const convertedPart of convertedParts) {
        const normalizedPart = convertedPart.trim();
        if (normalizedPart) {
          formattedParts.push(normalizedPart);
        }
      }
      continue;
    }

    if (parts.length > 1) {
      formattedParts.push(`\`\`\`\n${trimmed}\n\`\`\``);
    } else {
      formattedParts.push(trimmed);
    }
  }

  return formattedParts;
}
