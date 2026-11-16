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
          { blocks: [{ type: "paragraph", inlines: [{ type: "text", text: "first item" }] }] },
          {
            blocks: [
              {
                type: "paragraph",
                inlines: [
                  { type: "text", text: "second " },
                  { type: "bold", children: [{ type: "text", text: "item" }] },
                ],
              },
            ],
          },
        ],
      },
      {
        type: "list",
        ordered: true,
        items: [
          {
            blocks: [{ type: "paragraph", inlines: [{ type: "text", text: "review" }] }],
            checked: false,
          },
          {
            blocks: [{ type: "paragraph", inlines: [{ type: "text", text: "done" }] }],
            checked: true,
          },
        ],
      },
    ]);
  });

  it("parses simple blockquotes with normalized lazy continuation", () => {
    const input = ["> quoted line", "Quote continues", "", "> second quote"].join("\n");

    expect(parseTelegramBlocks(input)).toEqual([
      {
        type: "blockquote",
        blocks: [
          {
            type: "paragraph",
            inlines: [{ type: "text", text: "quoted line\nQuote continues" }],
          },
        ],
      },
      {
        type: "blockquote",
        blocks: [{ type: "paragraph", inlines: [{ type: "text", text: "second quote" }] }],
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
        align: ["left", "right"],
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

  it("keeps lists nested inside a quote instead of degrading the whole quote", () => {
    const input = ["> intro", "> - item 1", "> - item 2"].join("\n");

    expect(parseTelegramBlocks(input)).toEqual([
      {
        type: "blockquote",
        blocks: [
          { type: "paragraph", inlines: [{ type: "text", text: "intro" }] },
          {
            type: "list",
            ordered: false,
            items: [
              { blocks: [{ type: "paragraph", inlines: [{ type: "text", text: "item 1" }] }] },
              { blocks: [{ type: "paragraph", inlines: [{ type: "text", text: "item 2" }] }] },
            ],
          },
        ],
      },
    ]);
  });

  it("keeps a quote nested inside a quote", () => {
    const input = ["> outer", ">", "> > inner"].join("\n");

    expect(parseTelegramBlocks(input)).toEqual([
      {
        type: "blockquote",
        blocks: [
          { type: "paragraph", inlines: [{ type: "text", text: "outer" }] },
          {
            type: "blockquote",
            blocks: [{ type: "paragraph", inlines: [{ type: "text", text: "inner" }] }],
          },
        ],
      },
    ]);
  });

  it("keeps column alignment declared in the table delimiter row", () => {
    const input = ["| a | b | c |", "|:--|:-:|--:|", "| 1 | 2 | 3 |"].join("\n");

    expect(parseTelegramBlocks(input)).toEqual([
      {
        type: "table",
        rows: [
          ["a", "b", "c"],
          ["1", "2", "3"],
        ],
        align: ["left", "center", "right"],
      },
    ]);
  });

  it("keeps a nested list inside its parent item", () => {
    const input = ["- parent", "  - child"].join("\n");

    expect(parseTelegramBlocks(input)).toEqual([
      {
        type: "list",
        ordered: false,
        items: [
          {
            blocks: [
              { type: "paragraph", inlines: [{ type: "text", text: "parent" }] },
              {
                type: "list",
                ordered: false,
                items: [
                  { blocks: [{ type: "paragraph", inlines: [{ type: "text", text: "child" }] }] },
                ],
              },
            ],
          },
        ],
      },
    ]);
  });

  it("parses inline html tags Telegram can express", () => {
    expect(
      parseTelegramBlocks("H<sub>2</sub>O, м<sup>2</sup>, <mark>note</mark>, <u>under</u>"),
    ).toEqual([
      {
        type: "paragraph",
        inlines: [
          { type: "text", text: "H" },
          { type: "subscript", children: [{ type: "text", text: "2" }] },
          { type: "text", text: "O, м" },
          { type: "superscript", children: [{ type: "text", text: "2" }] },
          { type: "text", text: ", " },
          { type: "marked", children: [{ type: "text", text: "note" }] },
          { type: "text", text: ", " },
          { type: "underline", children: [{ type: "text", text: "under" }] },
        ],
      },
    ]);
  });

  it("marks text written with the double equals syntax", () => {
    expect(parseTelegramBlocks("Take ==this== seriously")).toEqual([
      {
        type: "paragraph",
        inlines: [
          { type: "text", text: "Take " },
          { type: "marked", children: [{ type: "text", text: "this" }] },
          { type: "text", text: " seriously" },
        ],
      },
    ]);
  });

  it("leaves a comparison written with spaced equals alone", () => {
    expect(parseTelegramBlocks("check a == b == c")).toEqual([
      { type: "paragraph", inlines: [{ type: "text", text: "check a == b == c" }] },
    ]);
  });

  it("writes a keyboard tag as monowidth, the closest thing Telegram draws", () => {
    expect(parseTelegramBlocks("Press <kbd>Ctrl</kbd>")).toEqual([
      {
        type: "paragraph",
        inlines: [
          { type: "text", text: "Press " },
          { type: "code", text: "Ctrl" },
        ],
      },
    ]);
  });

  it("shows an inline tag it cannot express as written", () => {
    expect(parseTelegramBlocks("A <abbr title='x'>term</abbr> here")).toEqual([
      {
        type: "paragraph",
        inlines: [{ type: "text", text: "A <abbr title='x'>term</abbr> here" }],
      },
    ]);
  });

  it("shows an inline tag that is never closed as written", () => {
    expect(parseTelegramBlocks("Broken <mark>tail")).toEqual([
      { type: "paragraph", inlines: [{ type: "text", text: "Broken <mark>tail" }] },
    ]);
  });

  it("shows a closing tag that opens nothing as written", () => {
    expect(parseTelegramBlocks("Stray </mark> tag")).toEqual([
      { type: "paragraph", inlines: [{ type: "text", text: "Stray </mark> tag" }] },
    ]);
  });

  it("turns a line break tag into a newline", () => {
    expect(parseTelegramBlocks("first<br>second")).toEqual([
      { type: "paragraph", inlines: [{ type: "text", text: "first\nsecond" }] },
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

  it("parses math fences as native formula blocks", () => {
    expect(parseTelegramBlocks(["```math", "y = x^2", "```"].join("\n"))).toEqual([
      { type: "math", expression: "y = x^2" },
    ]);
  });

  it("keeps ordinary fenced code as code", () => {
    expect(parseTelegramBlocks(["```ts", "const a = 1;", "```"].join("\n"))).toEqual([
      { type: "code", language: "ts", text: "const a = 1;" },
    ]);
  });
});
