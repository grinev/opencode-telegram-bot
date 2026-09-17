import { config } from "../../config.js";
import { logger } from "../../utils/logger.js";
import { chunkPlainText, chunkTelegramRenderedBlocks } from "../render/chunker.js";
import { sanitizeCjkText } from "../render/cjk-guard.js";
import { renderTelegramBlocks, renderTelegramParts, toRenderedBlocks } from "../render/pipeline.js";
import type { TelegramRenderedBlock, TelegramRenderedPart } from "../render/types.js";
import type { StreamingMessagePayload } from "../streaming/response-streamer.js";

export function createPlainRenderedParts(text: string): TelegramRenderedPart[] {
  return chunkPlainText(sanitizeCjkText(text).text);
}

function useAssistantEntitiesFormat(): boolean {
  return config.bot.messageFormatMode === "markdown";
}

function renderAssistantBlocksSafe(text: string): TelegramRenderedBlock[] {
  if (!text) {
    return [];
  }

  const safeText = sanitizeCjkText(text).text;

  try {
    return renderTelegramBlocks(safeText);
  } catch (error) {
    logger.warn(
      "[AssistantRender] Block rendering failed, falling back to plain streaming block",
      error,
    );
    return toRenderedBlocks([{ type: "plain", text: safeText }]);
  }
}

export function renderAssistantFinalPartsSafe(text: string): TelegramRenderedPart[] {
  if (!text) {
    return [];
  }

  const formatMode = useAssistantEntitiesFormat() ? "blocks" : "raw";

  if (!useAssistantEntitiesFormat()) {
    const parts = createPlainRenderedParts(text);
    logger.debug("[AssistantRender] Built final assistant parts in raw mode", {
      formatMode,
      textLength: text.length,
      partCount: parts.length,
    });
    return parts;
  }

  try {
    const parts = renderTelegramParts(text);
    logger.debug("[AssistantRender] Built final assistant parts in blocks mode", {
      formatMode,
      textLength: text.length,
      partCount: parts.length,
    });
    return parts;
  } catch (error) {
    logger.warn("[AssistantRender] Part rendering failed, falling back to plain text parts", error);
    const parts = createPlainRenderedParts(text);
    logger.debug("[AssistantRender] Built final assistant parts in raw fallback mode", {
      formatMode,
      textLength: text.length,
      partCount: parts.length,
    });
    return parts;
  }
}

function getStableStreamingBoundary(messageText: string): number {
  if (!messageText) {
    return 0;
  }

  if (messageText.endsWith("\n\n")) {
    return messageText.length;
  }

  const lastBlockSeparatorIndex = messageText.lastIndexOf("\n\n");
  return lastBlockSeparatorIndex >= 0 ? lastBlockSeparatorIndex + 2 : 0;
}

/**
 * Blocks for text that is still arriving: everything up to the last blank line
 * is structurally complete and gets parsed, the trailing tail stays literal
 * until its block is finished.
 */
export function buildStreamingBlocks(messageText: string): TelegramRenderedBlock[] {
  const stableBoundary = getStableStreamingBoundary(messageText);
  const blocks: TelegramRenderedBlock[] = [];

  if (stableBoundary > 0) {
    blocks.push(...renderAssistantBlocksSafe(messageText.slice(0, stableBoundary)));
  }

  const unstableTail = stableBoundary > 0 ? messageText.slice(stableBoundary) : messageText;
  if (unstableTail) {
    const safeTail = sanitizeCjkText(unstableTail).text;
    blocks.push(...toRenderedBlocks([{ type: "plain", text: safeTail }]));
  }

  return blocks;
}

export function prepareAssistantStreamingPayload(
  messageText: string,
): StreamingMessagePayload | null {
  if (!messageText) {
    return null;
  }

  const formatMode = useAssistantEntitiesFormat() ? "blocks" : "raw";

  if (!useAssistantEntitiesFormat()) {
    const parts = createPlainRenderedParts(messageText);
    logger.debug("[AssistantRender] Built streaming assistant payload in raw mode", {
      formatMode,
      textLength: messageText.length,
      partCount: parts.length,
    });
    return parts.length > 0 ? { parts } : null;
  }

  const blocks = buildStreamingBlocks(messageText);
  const parts = chunkTelegramRenderedBlocks(blocks);
  logger.debug("[AssistantRender] Built streaming assistant payload in blocks mode", {
    formatMode,
    textLength: messageText.length,
    blockCount: blocks.length,
    partCount: parts.length,
  });

  return parts.length > 0 ? { parts } : null;
}

export function prepareAssistantFinalStreamingPayload(
  messageText: string,
): StreamingMessagePayload | null {
  const parts = renderAssistantFinalPartsSafe(messageText);
  return parts.length > 0 ? { parts } : null;
}
