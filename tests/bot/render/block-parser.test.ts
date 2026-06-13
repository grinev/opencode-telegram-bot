import { describe, expect, it } from "vitest";
import { parseTelegramBlocks } from "../../../src/bot/render/block-parser.js";

describe("bot/render/block-parser", () => {
  it("parses paragraphs with inline formatting", () => {
    expect(
      parseTelegramBlocks("Hello **bold** *italic* ~~strike~~ `code` [site](https://example.com)"),
    ).toEqual([
      {
        type: "paragraph",
        inlines: [
          { type: "text", text: "Hello " },
          { type: "bold", children: [{ type: "text", text: "bold" }] },
          { type: "text", text: " " },
          { type: "italic", children: [{ type: "text", text: "italic" }] },
          { type: "text", text: " " },
          { type: "strike", children: [{ type: "text", text: "strike" }] },
          { type: "text", text: " " },
          { type: "code", text: "code" },
          { type: "text", text: " " },
          {
            type: "link",
            text: [{ type: "text", text: "site" }],
            url: "https://example.com",
          },
        ],
      },
    ]);
  });

  it("parses headings, rules, and code blocks", () => {
    const input = ["## Title", "", "---", "", "```ts", "const a = 1;", "```"].join("\n");

    expect(parseTelegramBlocks(input)).toEqual([
      {
        type: "heading",
        level: 2,
        inlines: [{ type: "text", text: "Title" }],
      },
      { type: "rule" },
      {
        type: "code",
        language: "ts",
        text: "const a = 1;",
      },
    ]);
  });

  it("parses ordered, unordered, and task lists", () => {
    const input = ["- first item", "- second **item**", "", "1. [ ] review", "2. [x] done"].join(
      "\n",
    );

    expect(parseTelegramBlocks(input)).toEqual([
      {
        type: "list",
        ordered: false,
        items: [
          [{ type: "text", text: "first item" }],
          [
            { type: "text", text: "second " },
            { type: "bold", children: [{ type: "text", text: "item" }] },
          ],
        ],
      },
      {
        type: "list",
        ordered: true,
        items: [[{ type: "text", text: "🔲 review" }], [{ type: "text", text: "✅ done" }]],
      },
    ]);
  });

  it("parses simple blockquotes with normalized lazy continuation", () => {
    const input = ["> quoted line", "Quote continues", "", "> second paragraph"].join("\n");

    expect(parseTelegramBlocks(input)).toEqual([
      {
        type: "blockquote",
        lines: [
          [{ type: "text", text: "quoted line\nQuote continues" }],
          [{ type: "text", text: "second paragraph" }],
        ],
      },
    ]);
  });

  it("parses tables into plain cell rows", () => {
    const input = [
      "| Name | Score |",
      "| --- | ---: |",
      "| api.js | +1.5 |",
      "| **bold** | `code` |",
    ].join("\n");

    expect(parseTelegramBlocks(input)).toEqual([
      {
        type: "table",
        rows: [
          ["Name", "Score"],
          ["api.js", "+1.5"],
          ["bold", "code"],
        ],
      },
    ]);
  });

  it("returns empty blocks for whitespace-only input", () => {
    expect(parseTelegramBlocks(" \n\n ")).toEqual([]);
  });

  it("keeps malformed emphasis as paragraph text instead of throwing", () => {
    const blocks = parseTelegramBlocks("*text: *value**");

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      type: "paragraph",
      inlines: [
        {
          type: "italic",
          children: [
            { type: "text", text: "text: " },
            { type: "italic", children: [{ type: "text", text: "value" }] },
          ],
        },
      ],
    });
  });

  it("degrades complex quote-list mixes to plain blocks", () => {
    const input = ["> intro", "> - item 1", "> - item 2"].join("\n");

    expect(parseTelegramBlocks(input)).toEqual([
      {
        type: "plain",
        text: "> intro\n> - item 1\n> - item 2",
      },
    ]);
  });

  it("degrades nested lists to plain blocks", () => {
    const input = ["- parent", "  - child"].join("\n");

    expect(parseTelegramBlocks(input)).toEqual([
      {
        type: "plain",
        text: "- parent\n- child",
      },
    ]);
  });

  it("degrades unsupported html blocks to plain text", () => {
    expect(parseTelegramBlocks("<div>hello</div>")).toEqual([
      {
        type: "plain",
        text: "<div>hello</div>",
      },
    ]);
  });
});
