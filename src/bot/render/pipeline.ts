import { parseTelegramBlocks } from "./block-parser.js";
import { toBlockPlainText } from "./block-plain-text.js";
import { splitOversizeTelegramBlocks, type BlockSplitLimits } from "./block-splitter.js";
import { chunkTelegramRenderedBlocks, type TelegramChunkerOptions } from "./chunker.js";
import { sanitizeCjkText } from "./cjk-guard.js";
import { liftTextListContent, toRichBlock } from "./rich-blocks.js";
import type { TelegramBlock, TelegramRenderedBlock } from "./types.js";
import type { TelegramRenderedPart } from "./types.js";

/**
 * Lifts native content out of lists that are written as text, splits blocks
 * that exceed the per-message budgets, then pairs every block with its native
 * rich form and its plain-text projection.
 */
export function toRenderedBlocks(
  blocks: TelegramBlock[],
  limits?: Partial<BlockSplitLimits>,
): TelegramRenderedBlock[] {
  return splitOversizeTelegramBlocks(liftTextListContent(blocks), limits).map((block) => ({
    block: toRichBlock(block),
    plainText: toBlockPlainText(block),
  }));
}

export function renderTelegramBlocks(
  markdown: string,
  limits?: Partial<BlockSplitLimits>,
): TelegramRenderedBlock[] {
  // CJK guard: sanitize at the markdown entry so every projection of the
  // content (rich blocks, plain text, signatures) stays consistent.
  const { text } = sanitizeCjkText(markdown);
  return toRenderedBlocks(parseTelegramBlocks(text), limits);
}

export function renderTelegramParts(
  markdown: string,
  options?: TelegramChunkerOptions,
): TelegramRenderedPart[] {
  return chunkTelegramRenderedBlocks(renderTelegramBlocks(markdown, options), options);
}
