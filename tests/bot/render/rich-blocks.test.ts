import { describe, expect, it } from "#vitest";

import {
  countRichBlocks,
  countRichChars,
  toRichBlock,
  toRichText,
} from "../../../src/bot/render/rich-blocks.js";
import { parseTelegramBlocks } from "../../../src/bot/render/block-parser.js";
import type { TelegramBlock } from "../../../src/bot/render/types.js";
import { defined } from "../../helpers/defined.js";

function parseSingleBlock(markdown: string): TelegramBlock {
  const blocks = parseTelegramBlocks(markdown);
  expect(blocks).toHaveLength(1);
  return defined(blocks[0]);
}

describe("bot/render/rich-blocks", () => {
  describe("toRichText", () => {
    it("maps every inline node to its native counterpart", () => {
      expect(
        toRichText([
          { type: "text", text: "plain " },
          { type: "bold", children: [{ type: "text", text: "b" }] },
          { type: "italic", children: [{ type: "text", text: "i" }] },
          { type: "strike", children: [{ type: "text", text: "s" }] },
          { type: "underline", children: [{ type: "text", text: "u" }] },
          { type: "spoiler", children: [{ type: "text", text: "sp" }] },
          { type: "subscript", children: [{ type: "text", text: "sb" }] },
          { type: "superscript", children: [{ type: "text", text: "sr" }] },
          { type: "marked", children: [{ type: "text", text: "m" }] },
          { type: "code", text: "c" },
          { type: "link", text: [{ type: "text", text: "l" }], url: "https://example.com" },
        ]),
      ).toEqual([
        "plain ",
        { type: "bold", text: "b" },
        { type: "italic", text: "i" },
        { type: "strikethrough", text: "s" },
        { type: "underline", text: "u" },
        { type: "spoiler", text: "sp" },
        { type: "subscript", text: "sb" },
        { type: "superscript", text: "sr" },
        { type: "marked", text: "m" },
        { type: "code", text: "c" },
        { type: "url", text: "l", url: "https://example.com" },
      ]);
    });

    it("keeps nesting instead of flattening it", () => {
      expect(
        toRichText([
          {
            type: "bold",
            children: [
              { type: "text", text: "outer " },
              { type: "italic", children: [{ type: "text", text: "inner" }] },
            ],
          },
        ]),
      ).toEqual({
        type: "bold",
        text: ["outer ", { type: "italic", text: "inner" }],
      });
    });

    it("collapses an empty inline list to an empty string", () => {
      expect(toRichText([])).toBe("");
    });
  });

  describe("toRichBlock", () => {
    it("maps a paragraph", () => {
      expect(toRichBlock(parseSingleBlock("Hello **world**"))).toEqual({
        type: "paragraph",
        text: ["Hello ", { type: "bold", text: "world" }],
      });
    });

    it("maps heading levels one to one", () => {
      expect(toRichBlock(parseSingleBlock("# One"))).toEqual({
        type: "heading",
        text: "One",
        size: 1,
      });
      expect(toRichBlock(parseSingleBlock("### Three"))).toEqual({
        type: "heading",
        text: "Three",
        size: 3,
      });
    });

    it("maps a blockquote to nested paragraphs", () => {
      expect(toRichBlock(parseSingleBlock("> quoted line"))).toEqual({
        type: "blockquote",
        blocks: [{ type: "paragraph", text: "quoted line" }],
      });
    });

    it("maps a bullet list without numbering hints", () => {
      expect(toRichBlock(parseSingleBlock("- first\n- second"))).toEqual({
        type: "list",
        items: [
          { blocks: [{ type: "paragraph", text: "first" }] },
          { blocks: [{ type: "paragraph", text: "second" }] },
        ],
      });
    });

    it("writes an ordered list out as a paragraph with literal numbers", () => {
      expect(toRichBlock(parseSingleBlock("1. first\n2. second"))).toEqual({
        type: "paragraph",
        text: ["1. ", "first", "\n2. ", "second"],
      });
    });

    it("keeps inline formatting inside an ordered list item", () => {
      expect(toRichBlock(parseSingleBlock("1. plain **bold** `code`"))).toEqual({
        type: "paragraph",
        text: [
          "1. ",
          "plain ",
          { type: "bold", text: "bold" },
          " ",
          { type: "code", text: "code" },
        ],
      });
    });

    it("continues the numbering from the start offset of a list piece", () => {
      expect(
        toRichBlock({
          type: "list",
          ordered: true,
          start: 7,
          items: [
            { blocks: [{ type: "paragraph", inlines: [{ type: "text", text: "seventh" }] }] },
            { blocks: [{ type: "paragraph", inlines: [{ type: "text", text: "eighth" }] }] },
          ],
        }),
      ).toEqual({ type: "paragraph", text: ["7. ", "seventh", "\n8. ", "eighth"] });
    });

    it("renumbers an ordered list that markdown started elsewhere", () => {
      expect(toRichBlock(parseSingleBlock("5. fifth\n6. sixth"))).toMatchObject({
        type: "paragraph",
        text: ["1. ", "fifth", "\n2. ", "sixth"],
      });
    });

    it("writes a task list out with emoji markers and no bullets", () => {
      const block = toRichBlock(parseSingleBlock("- [x] done\n- [ ] open"));

      expect(block).toEqual({
        type: "paragraph",
        text: ["✅ ", "done", "\n🔲 ", "open"],
      });
    });

    it("keeps a plain item of a mixed task list on a bullet marker", () => {
      const block = toRichBlock(parseSingleBlock("- [x] done\n- note"));

      expect(block).toEqual({
        type: "paragraph",
        text: ["✅ ", "done", "\n• ", "note"],
      });
    });

    it("keeps a nested list inside its parent item", () => {
      const block = toRichBlock(parseSingleBlock("- parent\n  - child"));

      expect(block).toEqual({
        type: "list",
        items: [
          {
            blocks: [
              { type: "paragraph", text: "parent" },
              {
                type: "list",
                items: [{ blocks: [{ type: "paragraph", text: "child" }] }],
              },
            ],
          },
        ],
      });
    });

    // Mapper-only fallback: a real reply never gets here, because the pipeline
    // lifts such content out first (see pipeline.test.ts).
    it("writes a nested list under a numbered item as indented text", () => {
      expect(toRichBlock(parseSingleBlock("1. parent\n   - child"))).toEqual({
        type: "paragraph",
        text: ["1. ", "parent", "\n   - child"],
      });
    });

    it("keeps a short code block inline with its language", () => {
      expect(toRichBlock(parseSingleBlock("```python\nprint(1)\n```"))).toEqual({
        type: "pre",
        text: "print(1)",
        language: "python",
      });
    });

    it("keeps a long code block expanded instead of collapsing it", () => {
      const code = Array.from({ length: 40 }, (_, index) => `line ${index}`).join("\n");

      expect(toRichBlock(parseSingleBlock(`\`\`\`ts\n${code}\n\`\`\``))).toEqual({
        type: "pre",
        text: code,
        language: "ts",
      });
    });

    it("omits the language when the fence has none", () => {
      const code = Array.from({ length: 9 }, (_, index) => `line ${index}`).join("\n");

      expect(toRichBlock(parseSingleBlock(`\`\`\`\n${code}\n\`\`\``))).toEqual({
        type: "pre",
        text: code,
      });
    });

    it("maps a table with a header row, borders and cell alignment", () => {
      const block = toRichBlock(parseSingleBlock("| a | b |\n|---|---|\n| 1 | 2 |"));

      expect(block).toEqual({
        type: "table",
        is_bordered: true,
        cells: [
          [
            { text: "a", is_header: true, align: "left", valign: "top" },
            { text: "b", is_header: true, align: "left", valign: "top" },
          ],
          [
            { text: "1", align: "left", valign: "top" },
            { text: "2", align: "left", valign: "top" },
          ],
        ],
      });
    });

    it("applies the column alignment declared in markdown to every cell", () => {
      const block = toRichBlock(
        parseSingleBlock("| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |"),
      );

      expect(block.type).toBe("table");
      if (block.type === "table") {
        expect(block.cells.map((row) => row.map((cell) => cell.align))).toEqual([
          ["left", "center", "right"],
          ["left", "center", "right"],
        ]);
      }
    });

    it("maps a quote with nested structure instead of flattening it", () => {
      const block = toRichBlock(parseSingleBlock("> intro\n> - one\n> - two"));

      expect(block).toEqual({
        type: "blockquote",
        blocks: [
          { type: "paragraph", text: "intro" },
          {
            type: "list",
            items: [
              { blocks: [{ type: "paragraph", text: "one" }] },
              { blocks: [{ type: "paragraph", text: "two" }] },
            ],
          },
        ],
      });
    });

    it("falls back to preformatted text for tables wider than twenty columns", () => {
      const header = Array.from({ length: 21 }, (_, index) => `c${index}`);
      const row = Array.from({ length: 21 }, (_, index) => `${index}`);
      const markdown = [
        `| ${header.join(" | ")} |`,
        `| ${header.map(() => "---").join(" | ")} |`,
        `| ${row.join(" | ")} |`,
      ].join("\n");

      const block = toRichBlock(parseSingleBlock(markdown));

      expect(block.type).toBe("pre");
      expect(block).toMatchObject({ text: expect.stringContaining("c0") });
    });

    it("keeps a twenty column table native", () => {
      const header = Array.from({ length: 20 }, (_, index) => `c${index}`);
      const markdown = [
        `| ${header.join(" | ")} |`,
        `| ${header.map(() => "---").join(" | ")} |`,
      ].join("\n");

      expect(toRichBlock(parseSingleBlock(markdown)).type).toBe("table");
    });

    it("maps a thematic break to a divider", () => {
      expect(toRichBlock({ type: "rule" })).toEqual({ type: "divider" });
    });

    it("maps a plain block to a literal paragraph", () => {
      expect(toRichBlock({ type: "plain", text: "## not parsed" })).toEqual({
        type: "paragraph",
        text: "## not parsed",
      });
    });
  });

  describe("countRichBlocks", () => {
    it("counts a leaf block as one", () => {
      expect(countRichBlocks({ type: "paragraph", text: "x" })).toBe(1);
      expect(countRichBlocks({ type: "divider" })).toBe(1);
    });

    it("counts list items and their content", () => {
      expect(
        countRichBlocks({
          type: "list",
          items: [
            { blocks: [{ type: "paragraph", text: "a" }] },
            { blocks: [{ type: "paragraph", text: "b" }] },
          ],
        }),
      ).toBe(5);
    });

    it("counts one unit per table row plus the table itself", () => {
      expect(
        countRichBlocks({
          type: "table",
          cells: [
            [{ text: "a", align: "left", valign: "top" }],
            [{ text: "b", align: "left", valign: "top" }],
            [{ text: "c", align: "left", valign: "top" }],
          ],
        }),
      ).toBe(4);
    });

    it("counts nested details and quote content", () => {
      expect(
        countRichBlocks({
          type: "details",
          summary: "s",
          blocks: [{ type: "pre", text: "code" }],
        }),
      ).toBe(2);
      expect(
        countRichBlocks({
          type: "blockquote",
          blocks: [
            { type: "paragraph", text: "a" },
            { type: "paragraph", text: "b" },
          ],
        }),
      ).toBe(3);
    });
  });

  describe("countRichChars", () => {
    it("sums nested rich text", () => {
      expect(
        countRichChars({
          type: "paragraph",
          text: ["ab", { type: "bold", text: "cd" }],
        }),
      ).toBe(4);
    });

    it("counts preformatted text, table cells and details summaries", () => {
      expect(countRichChars({ type: "pre", text: "abcde" })).toBe(5);
      expect(
        countRichChars({
          type: "table",
          cells: [
            [
              { text: "ab", align: "left", valign: "top" },
              { text: "c", align: "left", valign: "top" },
            ],
          ],
        }),
      ).toBe(3);
      expect(
        countRichChars({
          type: "details",
          summary: "sum",
          blocks: [{ type: "pre", text: "12" }],
        }),
      ).toBe(5);
    });
  });
});
