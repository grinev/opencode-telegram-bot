import { config } from "../../config.js";
import { logger } from "../../utils/logger.js";
import { chunkTelegramRenderedBlocks } from "../../telegram/render/chunker.js";
import { renderTelegramBlocks, renderTelegramParts } from "../../telegram/render/pipeline.js";
import type { TelegramRenderedBlock, TelegramRenderedPart } from "../../telegram/render/types.js";
import type { StreamingMessagePayload } from "../streaming/response-streamer.js";

export function createPlainRenderedBlock(text: string): TelegramRenderedBlock {
  return {
    blockType: "plain",
    mode: "plain",
    text,
    fallbackText: text,
    source: "plain",
  };
}

function addMultipartMarkers(parts: TelegramRenderedPart[]): TelegramRenderedPart[] {
  if (parts.length <= 1) {
    return parts;
  }

  return parts.map((part, index) => {
    const marker = `[${index + 1}/${parts.length}]\n`;
    return {
      ...part,
      text: `${marker}${part.text}`,
      fallbackText: `${marker}${part.fallbackText}`,
    };
  });
}

export function createPlainRenderedParts(
  text: string,
  maxPartLength: number,
): TelegramRenderedPart[] {
  const markerReserve = 16;
  const chunkLimit = Math.max(1, maxPartLength - markerReserve);
  const parts = chunkTelegramRenderedBlocks([createPlainRenderedBlock(text)], {
    maxPartLength: chunkLimit,
  });
  return addMultipartMarkers(parts);
}

function useAssistantEntitiesFormat(): boolean {
  return config.bot.messageFormatMode === "markdown";
}

function renderAssistantBlocksSafe(text: string): TelegramRenderedBlock[] {
  if (!text) {
    return [];
  }

  try {
    return renderTelegramBlocks(text);
  } catch (error) {
    logger.warn(
      "[AssistantRender] Block rendering failed, falling back to plain streaming block",
      error,
    );
    return [createPlainRenderedBlock(text)];
  }
}

export function renderAssistantFinalPartsSafe(
  text: string,
  maxPartLength = 4096,
): TelegramRenderedPart[] {
  if (!text) {
    return [];
  }

  const formatMode = useAssistantEntitiesFormat() ? "entities" : "raw";

  if (!useAssistantEntitiesFormat()) {
    const parts = createPlainRenderedParts(text, maxPartLength);
    logger.debug("[AssistantRender] Built final assistant parts in raw mode", {
      formatMode,
      textLength: text.length,
      partCount: parts.length,
    });
    return parts;
  }

  try {
    const parts = renderTelegramParts(text, { maxPartLength });
    logger.debug("[AssistantRender] Built final assistant parts in entities mode", {
      formatMode,
      textLength: text.length,
      partCount: parts.length,
      richParts: parts.filter((part) => part.source === "entities").length,
      plainParts: parts.filter((part) => part.source === "plain").length,
    });
    return parts;
  } catch (error) {
    logger.warn("[AssistantRender] Part rendering failed, falling back to plain text parts", error);
    const parts = createPlainRenderedParts(text, maxPartLength);
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

export function prepareAssistantStreamingPayload(
  messageText: string,
  maxPartLength: number,
): StreamingMessagePayload | null {
  if (!messageText) {
    return null;
  }

  const formatMode = useAssistantEntitiesFormat() ? "entities" : "raw";

  if (!useAssistantEntitiesFormat()) {
    const parts = createPlainRenderedParts(messageText, maxPartLength);
    logger.debug("[AssistantRender] Built streaming assistant payload in raw mode", {
      formatMode,
      textLength: messageText.length,
      partCount: parts.length,
    });
    return parts.length > 0 ? { parts } : null;
  }

  const stableBoundary = getStableStreamingBoundary(messageText);
  const blocks: TelegramRenderedBlock[] = [];

  if (stableBoundary > 0) {
    blocks.push(...renderAssistantBlocksSafe(messageText.slice(0, stableBoundary)));
  }

  const unstableTail = stableBoundary > 0 ? messageText.slice(stableBoundary) : messageText;
  if (unstableTail) {
    blocks.push(createPlainRenderedBlock(unstableTail));
  }

  const parts = chunkTelegramRenderedBlocks(blocks, { maxPartLength });
  logger.debug("[AssistantRender] Built streaming assistant payload in entities mode", {
    formatMode,
    textLength: messageText.length,
    stableBoundary,
    tailLength: unstableTail.length,
    blockCount: blocks.length,
    partCount: parts.length,
    richParts: parts.filter((part) => part.source === "entities").length,
    plainParts: parts.filter((part) => part.source === "plain").length,
  });

  return parts.length > 0 ? { parts } : null;
}

export function prepareAssistantFinalStreamingPayload(
  messageText: string,
  maxPartLength: number,
): StreamingMessagePayload | null {
  const parts = renderAssistantFinalPartsSafe(messageText, maxPartLength);
  return parts.length > 0 ? { parts } : null;
}
