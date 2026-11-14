import { logger } from "../../utils/logger.js";
import {
  DEFAULT_MAX_PART_BLOCKS,
  DEFAULT_MAX_PART_MEDIA,
  DEFAULT_MAX_PART_CHARS,
  PLAIN_MAX_PART_CHARS,
} from "./limits.js";
import { countRichBlocks, countRichChars, countRichMedia } from "./rich-blocks.js";
import { splitTextIntoChunks } from "./text-splitter.js";
import type { TelegramRenderedBlock, TelegramRenderedPart } from "./types.js";

const DEFAULT_BLOCK_SEPARATOR = "\n\n";

export interface TelegramChunkerOptions {
  maxChars?: number;
  maxBlocks?: number;
  maxMedia?: number;
}

export interface PlainChunkerOptions {
  maxChars?: number;
}

/**
 * Cuts text into parts that fit a plain Telegram text message. Used by raw
 * format mode and by every degradation from native blocks to plain text.
 */
export function chunkPlainText(
  text: string,
  options?: PlainChunkerOptions,
): TelegramRenderedPart[] {
  const maxChars = Math.max(1, Math.floor(options?.maxChars ?? PLAIN_MAX_PART_CHARS));

  return splitTextIntoChunks(text, maxChars).map((chunk) => ({
    blocks: [],
    fallbackText: chunk,
    source: "plain" as const,
  }));
}

/**
 * Groups rendered blocks so that every group stays within both Telegram
 * budgets. Blocks are expected to fit individually already (see
 * `block-splitter.ts`); an oversize one lands in a group of its own.
 */
function groupRenderedBlocks(
  blocks: TelegramRenderedBlock[],
  options?: TelegramChunkerOptions,
): TelegramRenderedBlock[][] {
  const maxChars = Math.max(1, Math.floor(options?.maxChars ?? DEFAULT_MAX_PART_CHARS));
  const maxBlocks = Math.max(1, Math.floor(options?.maxBlocks ?? DEFAULT_MAX_PART_BLOCKS));
  const maxMedia = Math.max(
    1,
    Math.min(DEFAULT_MAX_PART_MEDIA, options?.maxMedia ?? DEFAULT_MAX_PART_MEDIA),
  );

  const groups: TelegramRenderedBlock[][] = [];
  let current: TelegramRenderedBlock[] = [];
  let currentChars = 0;
  let currentUnits = 0;
  let currentMedia = 0;

  for (const rendered of blocks) {
    const chars = countRichChars(rendered.block);
    const units = countRichBlocks(rendered.block);
    const media = countRichMedia(rendered.block);

    if (
      current.length > 0 &&
      (currentChars + chars > maxChars ||
        currentUnits + units > maxBlocks ||
        currentMedia + media > maxMedia)
    ) {
      groups.push(current);
      current = [];
      currentChars = 0;
      currentUnits = 0;
      currentMedia = 0;
    }

    current.push(rendered);
    currentChars += chars;
    currentUnits += units;
    currentMedia += media;
  }

  if (current.length > 0) {
    groups.push(current);
  }

  return groups;
}

/**
 * Packs rendered blocks into messages, respecting both Telegram budgets:
 * characters and block count.
 */
export function chunkTelegramRenderedBlocks(
  blocks: TelegramRenderedBlock[],
  options?: TelegramChunkerOptions,
): TelegramRenderedPart[] {
  const parts = groupRenderedBlocks(blocks, options).map((group) => ({
    blocks: group.map((rendered) => rendered.block),
    fallbackText: group
      .map((rendered) => rendered.plainText)
      .filter(Boolean)
      .join(DEFAULT_BLOCK_SEPARATOR),
    source: "blocks" as const,
  }));

  if (parts.length > 1) {
    logger.debug("[TelegramRender] Rendered blocks chunked", {
      blockCount: blocks.length,
      partCount: parts.length,
    });
  }

  return parts;
}
