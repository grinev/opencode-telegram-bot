import { logger } from "../../utils/logger.js";
import { toBlockPlainText } from "./block-plain-text.js";
import { DEFAULT_MAX_PART_BLOCKS, DEFAULT_MAX_PART_CHARS } from "./limits.js";
import {
  countRichBlocks,
  countRichChars,
  isTextRenderedList,
  textListMarker,
  toRichBlock,
} from "./rich-blocks.js";
import { splitTextIntoChunks } from "./text-splitter.js";
import type { TableColumnAlign, TelegramBlock, TelegramListItem } from "./types.js";

export interface BlockSplitLimits {
  maxChars: number;
  maxBlocks: number;
}

export function normalizeBlockSplitLimits(limits?: Partial<BlockSplitLimits>): BlockSplitLimits {
  return {
    maxChars: Math.max(1, Math.floor(limits?.maxChars ?? DEFAULT_MAX_PART_CHARS)),
    maxBlocks: Math.max(1, Math.floor(limits?.maxBlocks ?? DEFAULT_MAX_PART_BLOCKS)),
  };
}

function fitsLimits(block: TelegramBlock, limits: BlockSplitLimits): boolean {
  const richBlock = toRichBlock(block);
  return (
    countRichChars(richBlock) <= limits.maxChars && countRichBlocks(richBlock) <= limits.maxBlocks
  );
}

/**
 * Splits items into groups so that every group stays within `maxChars` and
 * contains at most `maxItems` entries. A single oversize item still lands in a
 * group of its own; the caller degrades it afterwards.
 */
function groupItems<T>(
  items: T[],
  maxChars: number,
  maxItems: number,
  measureChars: (item: T) => number,
): T[][] {
  const itemLimit = Math.max(1, maxItems);
  const groups: T[][] = [];
  let current: T[] = [];
  let currentChars = 0;

  for (const item of items) {
    const itemChars = measureChars(item);
    if (
      current.length > 0 &&
      (current.length >= itemLimit || currentChars + itemChars > maxChars)
    ) {
      groups.push(current);
      current = [];
      currentChars = 0;
    }

    current.push(item);
    currentChars += itemChars;
  }

  if (current.length > 0) {
    groups.push(current);
  }

  return groups;
}

function measureItem(item: TelegramListItem): number {
  return item.blocks.reduce((total, block) => total + toBlockPlainText(block).length + 1, 0);
}

/** Block units a native list item costs: the item itself plus its content. */
function measureItemUnits(item: TelegramListItem): number {
  return item.blocks.reduce((total, block) => total + countRichBlocks(toRichBlock(block)), 1);
}

/** A code block is one or two rich blocks regardless of line count, so only characters matter. */
function splitCodeBlock(
  text: string,
  language: string | undefined,
  limits: BlockSplitLimits,
): TelegramBlock[] {
  const lines = text.split("\n");
  const groups = groupItems(lines, limits.maxChars, Number.MAX_SAFE_INTEGER, (line) => line.length + 1);

  return groups.flatMap((group) => {
    const groupText = group.join("\n");
    return splitTextIntoChunks(groupText, limits.maxChars).map((chunk) => ({
      type: "code" as const,
      language,
      text: chunk,
    }));
  });
}

/** Rich table units: the table block itself plus one per row, header included. */
function splitTableBlock(
  rows: string[][],
  align: TableColumnAlign[] | undefined,
  limits: BlockSplitLimits,
): TelegramBlock[] {
  const [header, ...bodyRows] = rows;
  if (!header) {
    return [];
  }
  const measureRow = (row: string[]): number => row.reduce((total, cell) => total + cell.length, 0);
  const groups = groupItems(
    bodyRows,
    Math.max(1, limits.maxChars - measureRow(header)),
    limits.maxBlocks - 2,
    measureRow,
  );

  const alignment = align ? { align } : {};
  if (groups.length === 0) {
    return [{ type: "table", rows: [header], ...alignment }];
  }

  return groups.map((group) => ({
    type: "table" as const,
    rows: [header, ...group],
    ...alignment,
  }));
}

/** Rich quote units: the quote block itself plus whatever its content costs. */
function splitBlockquoteBlock(
  blocks: TelegramBlock[],
  limits: BlockSplitLimits,
): TelegramBlock[] {
  const innerLimits = { maxChars: limits.maxChars, maxBlocks: Math.max(1, limits.maxBlocks - 1) };
  const innerBlocks = blocks.flatMap((inner) => splitOversizeTelegramBlock(inner, innerLimits));

  return groupItems(innerBlocks, innerLimits.maxChars, innerLimits.maxBlocks, (inner) =>
    countRichChars(toRichBlock(inner)),
  ).map((group) => ({ type: "blockquote" as const, blocks: group }));
}

function splitToPlainBlocks(block: TelegramBlock, limits: BlockSplitLimits): TelegramBlock[] {
  return splitTextIntoChunks(toBlockPlainText(block), limits.maxChars).map((text) => ({
    type: "plain" as const,
    text,
  }));
}

function splitByType(block: TelegramBlock, limits: BlockSplitLimits): TelegramBlock[] {
  switch (block.type) {
    case "code":
      return splitCodeBlock(block.text, block.language, limits);
    case "table":
      return block.rows.length > 1
        ? splitTableBlock(block.rows, block.align, limits)
        : splitToPlainBlocks(block, limits);
    case "list":
      if (isTextRenderedList(block)) {
        // Written out as one paragraph, so only characters matter — including
        // the marker and the line break each item adds.
        const start = block.start ?? 1;
        const measured = block.items.map((item, index) => ({
          item,
          chars: measureItem(item) + textListMarker(item, index, block.ordered, start).length + 1,
        }));

        let pieceStart = start;
        return groupItems(measured, limits.maxChars, block.items.length, (entry) => entry.chars).map(
          (group) => {
            const piece = {
              type: "list" as const,
              ordered: block.ordered,
              items: group.map((entry) => entry.item),
              start: pieceStart,
            };
            pieceStart += group.length;
            return piece;
          },
        );
      }

      // Rich list units: the list block plus whatever each item costs. Items can
      // hold nested lists, so the cap comes from the most expensive one.
      return groupItems(
        block.items,
        limits.maxChars,
        Math.floor((limits.maxBlocks - 1) / Math.max(...block.items.map(measureItemUnits))),
        measureItem,
      ).map((items) => ({ type: "list" as const, ordered: false, items }));
    case "blockquote":
      return splitBlockquoteBlock(block.blocks, limits);
    default:
      return splitToPlainBlocks(block, limits);
  }
}

/**
 * Breaks a block that exceeds the per-message budgets into blocks that fit.
 * Structured blocks keep their type (code by lines, tables by rows with the
 * header repeated, lists by items, quotes by lines); anything that still does
 * not fit degrades to plain text.
 */
export function splitOversizeTelegramBlock(
  block: TelegramBlock,
  limits: BlockSplitLimits,
): TelegramBlock[] {
  if (fitsLimits(block, limits)) {
    return [block];
  }

  logger.debug("[TelegramRender] Splitting oversize block", {
    blockType: block.type,
    maxChars: limits.maxChars,
    maxBlocks: limits.maxBlocks,
  });

  return splitByType(block, limits).flatMap((piece) =>
    fitsLimits(piece, limits) ? [piece] : splitToPlainBlocks(piece, limits),
  );
}

export function splitOversizeTelegramBlocks(
  blocks: TelegramBlock[],
  limits?: Partial<BlockSplitLimits>,
): TelegramBlock[] {
  const normalizedLimits = normalizeBlockSplitLimits(limits);
  return blocks.flatMap((block) => splitOversizeTelegramBlock(block, normalizedLimits));
}
