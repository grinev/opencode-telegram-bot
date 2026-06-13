import { parseTelegramBlocks } from "./block-parser.js";
import { renderTelegramBlockWithFallback } from "./block-fallback.js";
import { chunkTelegramRenderedBlocks, type TelegramChunkerOptions } from "./chunker.js";
import type { TelegramRenderedBlock, TelegramRenderedPart } from "./types.js";

export function renderTelegramBlocks(markdown: string): TelegramRenderedBlock[] {
  return parseTelegramBlocks(markdown).map(renderTelegramBlockWithFallback);
}

export function renderTelegramParts(
  markdown: string,
  options?: TelegramChunkerOptions,
): TelegramRenderedPart[] {
  return chunkTelegramRenderedBlocks(renderTelegramBlocks(markdown), options);
}
