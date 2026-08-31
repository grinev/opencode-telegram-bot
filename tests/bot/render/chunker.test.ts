import { describe, expect, it } from "#vitest";

import { chunkPlainText, chunkTelegramRenderedBlocks } from "../../../src/bot/render/chunker.js";
import { PLAIN_MAX_PART_CHARS } from "../../../src/bot/render/limits.js";
import type { TelegramRenderedBlock } from "../../../src/bot/render/types.js";
import { defined } from "../../helpers/defined.js";

function paragraph(text: string): TelegramRenderedBlock {
  return { block: { type: "paragraph", text }, plainText: text };
}

function listBlock(itemCount: number): TelegramRenderedBlock {
  return {
    block: {
      type: "list",
      items: Array.from({ length: itemCount }, (_, index) => ({
        blocks: [{ type: "paragraph" as const, text: `i${index}` }],
      })),
    },
    plainText: Array.from({ length: itemCount }, (_, index) => `- i${index}`).join("\n"),
  };
}

describe("bot/render/chunker", () => {
  describe("chunkPlainText", () => {
    it("keeps text below the budget as a single plain part", () => {
      const parts = chunkPlainText("short text");

      expect(parts).toEqual([{ blocks: [], fallbackText: "short text", source: "plain" }]);
    });

    it("returns no parts for empty text", () => {
      expect(chunkPlainText("")).toEqual([]);
    });

    it("cuts on line boundaries and stays within the budget", () => {
      const line = `${"a".repeat(99)}\n`;
      const text = line.repeat(60);

      const parts = chunkPlainText(text, { maxChars: 1000 });

      expect(parts.length).toBeGreaterThan(1);
      for (const part of parts) {
        expect(part.fallbackText.length).toBeLessThanOrEqual(1000);
        expect(part.source).toBe("plain");
        expect(part.blocks).toEqual([]);
      }
      expect(parts.map((part) => part.fallbackText).join("")).toBe(text);
      expect(defined(parts[0]).fallbackText.endsWith("\n")).toBe(true);
    });

    it("uses the plain budget by default", () => {
      const parts = chunkPlainText("x".repeat(PLAIN_MAX_PART_CHARS * 2 + 5));

      expect(parts.length).toBe(3);
      expect(defined(parts[0]).fallbackText.length).toBe(PLAIN_MAX_PART_CHARS);
    });

    it("never splits inside a surrogate pair", () => {
      const parts = chunkPlainText("😀".repeat(10), { maxChars: 5 });

      for (const part of parts) {
        expect(part.fallbackText.length % 2).toBe(0);
      }
      expect(parts.map((part) => part.fallbackText).join("")).toBe("😀".repeat(10));
    });
  });

  describe("chunkTelegramRenderedBlocks", () => {
    it("packs blocks into one part and joins fallback text with blank lines", () => {
      const parts = chunkTelegramRenderedBlocks([paragraph("one"), paragraph("two")]);

      expect(parts).toHaveLength(1);
      expect(defined(parts[0]).source).toBe("blocks");
      expect(defined(parts[0]).blocks).toHaveLength(2);
      expect(defined(parts[0]).fallbackText).toBe("one\n\ntwo");
    });

    it("returns no parts for no blocks", () => {
      expect(chunkTelegramRenderedBlocks([])).toEqual([]);
    });

    it("starts a new part when the character budget would overflow", () => {
      const parts = chunkTelegramRenderedBlocks(
        [paragraph("a".repeat(60)), paragraph("b".repeat(60))],
        { maxChars: 100 },
      );

      expect(parts).toHaveLength(2);
      expect(defined(parts[0]).fallbackText).toBe("a".repeat(60));
      expect(defined(parts[1]).fallbackText).toBe("b".repeat(60));
    });

    it("starts a new part when the block budget would overflow", () => {
      // Each list is 1 block + 2 units per item = 7 units for three items.
      const parts = chunkTelegramRenderedBlocks([listBlock(3), listBlock(3)], {
        maxChars: 100_000,
        maxBlocks: 10,
      });

      expect(parts).toHaveLength(2);
    });

    it("counts nested units rather than top-level blocks", () => {
      const parts = chunkTelegramRenderedBlocks([listBlock(3), paragraph("tail")], {
        maxChars: 100_000,
        maxBlocks: 7,
      });

      expect(parts).toHaveLength(2);
      expect(defined(parts[1]).fallbackText).toBe("tail");
    });

    it("keeps an oversized block in a part of its own instead of dropping it", () => {
      const parts = chunkTelegramRenderedBlocks([paragraph("a".repeat(500)), paragraph("b")], {
        maxChars: 100,
      });

      expect(parts).toHaveLength(2);
      expect(defined(parts[0]).fallbackText).toBe("a".repeat(500));
      expect(defined(parts[1]).fallbackText).toBe("b");
    });

    it("skips empty plain projections when joining fallback text", () => {
      const parts = chunkTelegramRenderedBlocks([
        paragraph("one"),
        { block: { type: "divider" }, plainText: "" },
        paragraph("two"),
      ]);

      expect(defined(parts[0]).blocks).toHaveLength(3);
      expect(defined(parts[0]).fallbackText).toBe("one\n\ntwo");
    });
  });
});
