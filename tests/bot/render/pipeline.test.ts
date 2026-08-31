import { describe, expect, it } from "#vitest";
import {
  renderTelegramBlocks,
  renderTelegramParts,
  toRenderedBlocks,
} from "../../../src/bot/render/pipeline.js";
import { countRichBlocks, countRichChars } from "../../../src/bot/render/rich-blocks.js";
import { defined } from "../../helpers/defined.js";

describe("bot/render/pipeline", () => {
  it("renders markdown into native blocks paired with plain projections", () => {
    expect(renderTelegramBlocks("# Title\n\nParagraph with **bold**\n\n- item")).toEqual([
      {
        block: { type: "heading", text: "Title", size: 1 },
        plainText: "Title",
      },
      {
        block: { type: "paragraph", text: ["Paragraph with ", { type: "bold", text: "bold" }] },
        plainText: "Paragraph with bold",
      },
      {
        block: { type: "list", items: [{ blocks: [{ type: "paragraph", text: "item" }] }] },
        plainText: "- item",
      },
    ]);
  });

  it("lifts a sub-list out of a numbered item and keeps the numbering running", () => {
    const markdown = ["1. one", "2. two", "   - child", "3. three"].join("\n");

    expect(renderTelegramBlocks(markdown).map((rendered) => rendered.block)).toEqual([
      { type: "paragraph", text: ["1. ", "one", "\n2. ", "two"] },
      { type: "list", items: [{ blocks: [{ type: "paragraph", text: "child" }] }] },
      { type: "paragraph", text: ["3. ", "three"] },
    ]);
  });

  it("keeps a sub-list that is written out as text indented inside its item", () => {
    const markdown = ["1. one", "   1. sub a", "   2. sub b", "2. two"].join("\n");

    expect(renderTelegramBlocks(markdown).map((rendered) => rendered.block)).toEqual([
      {
        type: "paragraph",
        text: ["1. ", "one", "\n   1. sub a\n   2. sub b", "\n2. ", "two"],
      },
    ]);
  });

  it("lifts a sub-list that carries native content rather than flattening it", () => {
    const markdown = ["1. one", "   1. sub a", "      - deep bullet", "   2. sub b", "2. two"].join(
      "\n",
    );

    expect(renderTelegramBlocks(markdown).map((rendered) => rendered.block)).toEqual([
      { type: "paragraph", text: ["1. ", "one"] },
      { type: "paragraph", text: ["1. ", "sub a"] },
      { type: "list", items: [{ blocks: [{ type: "paragraph", text: "deep bullet" }] }] },
      { type: "paragraph", text: ["2. ", "sub b"] },
      { type: "paragraph", text: ["2. ", "two"] },
    ]);
  });

  it("still lifts native content out of an item that also holds a text sub-list", () => {
    const markdown = [
      "1. one",
      "   1. sub a",
      "",
      "   ```ts",
      "   const a = 1;",
      "   ```",
      "",
      "2. two",
    ].join("\n");

    expect(renderTelegramBlocks(markdown).map((rendered) => rendered.block)).toEqual([
      { type: "paragraph", text: ["1. ", "one", "\n   1. sub a"] },
      { type: "pre", text: "const a = 1;", language: "ts" },
      { type: "paragraph", text: ["2. ", "two"] },
    ]);
  });

  it("keeps a sub-list inside its item when the list stays native", () => {
    const markdown = ["- one", "- two", "  - child"].join("\n");

    expect(renderTelegramBlocks(markdown).map((rendered) => rendered.block)).toEqual([
      {
        type: "list",
        items: [
          { blocks: [{ type: "paragraph", text: "one" }] },
          {
            blocks: [
              { type: "paragraph", text: "two" },
              { type: "list", items: [{ blocks: [{ type: "paragraph", text: "child" }] }] },
            ],
          },
        ],
      },
    ]);
  });

  it("renders a whole reply as a single part", () => {
    const markdown = [
      "# Title",
      "",
      "Paragraph with **bold**",
      "",
      "| a | b |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "> quoted",
      "",
      "- item",
    ].join("\n");

    const parts = renderTelegramParts(markdown);

    expect(parts).toHaveLength(1);
    expect(defined(parts[0]).source).toBe("blocks");
    expect(defined(parts[0]).blocks.map((block) => block.type)).toEqual([
      "heading",
      "paragraph",
      "table",
      "blockquote",
      "list",
    ]);
    expect(defined(parts[0]).fallbackText).toContain("Paragraph with bold");
  });

  it("keeps a reply longer than a plain text message in one part", () => {
    const markdown = Array.from({ length: 60 }, (_, index) => `Paragraph ${index} ${"x".repeat(100)}`).join(
      "\n\n",
    );

    const parts = renderTelegramParts(markdown);

    expect(markdown.length).toBeGreaterThan(4096);
    expect(parts).toHaveLength(1);
  });

  it("splits an oversized reply so that every part fits both budgets", () => {
    const markdown = Array.from({ length: 40 }, (_, index) => `Paragraph ${index}`).join("\n\n");

    const parts = renderTelegramParts(markdown, { maxChars: 60, maxBlocks: 5 });

    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      const chars = part.blocks.reduce((total, block) => total + countRichChars(block), 0);
      const units = part.blocks.reduce((total, block) => total + countRichBlocks(block), 0);
      expect(chars).toBeLessThanOrEqual(60);
      expect(units).toBeLessThanOrEqual(5);
    }
  });

  it("splits an oversized code fence into several preformatted blocks", () => {
    const parts = renderTelegramParts(
      "```ts\nconst first = 1;\nconst second = 2;\nconst third = 3;\n```",
      { maxChars: 20 },
    );

    expect(parts.length).toBeGreaterThan(1);
    expect(
      parts.flatMap((part) => part.blocks).every((block) => block.type === "pre"),
    ).toBe(true);
  });

  it("splits an oversized table by rows and repeats the header", () => {
    const rows = Array.from({ length: 12 }, (_, index) => `| api${index}.js | +${index} |`);
    const parts = renderTelegramParts(
      ["| Name | Score |", "| --- | --- |", ...rows].join("\n"),
      { maxChars: 100_000, maxBlocks: 6 },
    );

    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      for (const block of part.blocks) {
        expect(block.type).toBe("table");
        if (block.type === "table") {
          expect(defined(block.cells[0]?.[0]).text).toBe("Name");
        }
      }
    }
  });

  it("accepts pre-parsed blocks for the streaming path", () => {
    expect(toRenderedBlocks([{ type: "plain", text: "## literal" }])).toEqual([
      { block: { type: "paragraph", text: "## literal" }, plainText: "## literal" },
    ]);
  });
});
