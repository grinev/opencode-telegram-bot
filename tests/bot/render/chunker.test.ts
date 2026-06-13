import { describe, expect, it } from "vitest";
import { chunkTelegramRenderedBlocks } from "../../../src/bot/render/chunker.js";
import type { TelegramRenderedBlock } from "../../../src/bot/render/types.js";

describe("bot/render/chunker", () => {
  it("joins small blocks with separators and rebases entities", () => {
    const blocks: TelegramRenderedBlock[] = [
      {
        blockType: "paragraph",
        mode: "full",
        text: "Hello",
        entities: [{ type: "bold", offset: 0, length: 5 }],
        fallbackText: "Hello",
        source: "entities",
      },
      {
        blockType: "paragraph",
        mode: "full",
        text: "world",
        entities: [{ type: "italic", offset: 0, length: 5 }],
        fallbackText: "world",
        source: "entities",
      },
    ];

    expect(chunkTelegramRenderedBlocks(blocks, { maxPartLength: 20 })).toEqual([
      {
        text: "Hello\n\nworld",
        entities: [
          { type: "bold", offset: 0, length: 5 },
          { type: "italic", offset: 7, length: 5 },
        ],
        fallbackText: "Hello\n\nworld",
        source: "entities",
      },
    ]);
  });

  it("flushes the current part when the next block no longer fits", () => {
    const blocks: TelegramRenderedBlock[] = [
      {
        blockType: "paragraph",
        mode: "plain",
        text: "12345678",
        fallbackText: "12345678",
        source: "plain",
      },
      {
        blockType: "paragraph",
        mode: "plain",
        text: "abcdefgh",
        fallbackText: "abcdefgh",
        source: "plain",
      },
    ];

    expect(chunkTelegramRenderedBlocks(blocks, { maxPartLength: 12 })).toEqual([
      {
        text: "12345678",
        fallbackText: "12345678",
        source: "plain",
      },
      {
        text: "abcdefgh",
        fallbackText: "abcdefgh",
        source: "plain",
      },
    ]);
  });

  it("splits long rich paragraphs on newline boundaries and rebases entities", () => {
    const blocks: TelegramRenderedBlock[] = [
      {
        blockType: "paragraph",
        mode: "full",
        text: "one\ntwo\nthree",
        entities: [{ type: "bold", offset: 8, length: 5 }],
        fallbackText: "one\ntwo\nthree",
        source: "entities",
      },
    ];

    expect(chunkTelegramRenderedBlocks(blocks, { maxPartLength: 8 })).toEqual([
      {
        text: "one\ntwo\n",
        fallbackText: "one\ntwo\n",
        source: "plain",
      },
      {
        text: "three",
        entities: [{ type: "bold", offset: 0, length: 5 }],
        fallbackText: "three",
        source: "entities",
      },
    ]);
  });

  it("does not split inside surrogate pairs", () => {
    const blocks: TelegramRenderedBlock[] = [
      {
        blockType: "plain",
        mode: "plain",
        text: "A😀B",
        fallbackText: "A😀B",
        source: "plain",
      },
    ];

    expect(chunkTelegramRenderedBlocks(blocks, { maxPartLength: 2 })).toEqual([
      {
        text: "A",
        fallbackText: "A",
        source: "plain",
      },
      {
        text: "😀",
        fallbackText: "😀",
        source: "plain",
      },
      {
        text: "B",
        fallbackText: "B",
        source: "plain",
      },
    ]);
  });

  it("splits oversized pre blocks and keeps pre entities", () => {
    const blocks: TelegramRenderedBlock[] = [
      {
        blockType: "code",
        mode: "full",
        text: "first line\nsecond line\nthird line",
        entities: [{ type: "pre", offset: 0, length: 33, language: "ts" }],
        fallbackText: "first line\nsecond line\nthird line",
        source: "entities",
      },
    ];

    expect(chunkTelegramRenderedBlocks(blocks, { maxPartLength: 15 })).toEqual([
      {
        text: "first line\n",
        entities: [{ type: "pre", offset: 0, length: 11, language: "ts" }],
        fallbackText: "first line\n",
        source: "entities",
      },
      {
        text: "second line\n",
        entities: [{ type: "pre", offset: 0, length: 12, language: "ts" }],
        fallbackText: "second line\n",
        source: "entities",
      },
      {
        text: "third line",
        entities: [{ type: "pre", offset: 0, length: 10, language: "ts" }],
        fallbackText: "third line",
        source: "entities",
      },
    ]);
  });

  it("splits oversized tables on line boundaries as pre blocks", () => {
    const text = "Name    | Score\n--------|------\napi.js  | +1.5 \nalert() | -1.5 ";
    const blocks: TelegramRenderedBlock[] = [
      {
        blockType: "table",
        mode: "full",
        text,
        entities: [{ type: "pre", offset: 0, length: text.length }],
        fallbackText: text,
        source: "entities",
      },
    ];

    expect(chunkTelegramRenderedBlocks(blocks, { maxPartLength: 25 })).toEqual([
      {
        text: "Name    | Score\n",
        entities: [{ type: "pre", offset: 0, length: 16 }],
        fallbackText: "Name    | Score\n",
        source: "entities",
      },
      {
        text: "--------|------\n",
        entities: [{ type: "pre", offset: 0, length: 16 }],
        fallbackText: "--------|------\n",
        source: "entities",
      },
      {
        text: "api.js  | +1.5 \n",
        entities: [{ type: "pre", offset: 0, length: 16 }],
        fallbackText: "api.js  | +1.5 \n",
        source: "entities",
      },
      {
        text: "alert() | -1.5 ",
        entities: [{ type: "pre", offset: 0, length: 15 }],
        fallbackText: "alert() | -1.5 ",
        source: "entities",
      },
    ]);
  });

  it("falls back whole rich blocks to plain when one link span exceeds the limit", () => {
    const blocks: TelegramRenderedBlock[] = [
      {
        blockType: "paragraph",
        mode: "full",
        text: "verylonglink",
        entities: [{ type: "text_link", offset: 0, length: 12, url: "https://example.com" }],
        fallbackText: "verylonglink",
        source: "entities",
      },
    ];

    expect(chunkTelegramRenderedBlocks(blocks, { maxPartLength: 5 })).toEqual([
      {
        text: "veryl",
        fallbackText: "veryl",
        source: "plain",
      },
      {
        text: "ongli",
        fallbackText: "ongli",
        source: "plain",
      },
      {
        text: "nk",
        fallbackText: "nk",
        source: "plain",
      },
    ]);
  });

  it("falls back whole rich blocks to plain when one inline code span exceeds the limit", () => {
    const blocks: TelegramRenderedBlock[] = [
      {
        blockType: "paragraph",
        mode: "full",
        text: "inlinecode",
        entities: [{ type: "code", offset: 0, length: 10 }],
        fallbackText: "inlinecode",
        source: "entities",
      },
    ];

    expect(chunkTelegramRenderedBlocks(blocks, { maxPartLength: 4 })).toEqual([
      {
        text: "inli",
        fallbackText: "inli",
        source: "plain",
      },
      {
        text: "neco",
        fallbackText: "neco",
        source: "plain",
      },
      {
        text: "de",
        fallbackText: "de",
        source: "plain",
      },
    ]);
  });
});
