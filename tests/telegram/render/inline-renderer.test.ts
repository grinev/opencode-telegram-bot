import { describe, expect, it } from "vitest";
import { parseTelegramBlocks } from "../../../src/telegram/render/block-parser.js";
import {
  renderInlineNodes,
  renderInlineNodesValidated,
} from "../../../src/telegram/render/inline-renderer.js";
import type { InlineNode } from "../../../src/telegram/render/types.js";

describe("telegram/render/inline-renderer", () => {
  it("renders supported inline nodes into text and entities", () => {
    const nodes: InlineNode[] = [
      { type: "text", text: "Hello " },
      { type: "bold", children: [{ type: "text", text: "bold" }] },
      { type: "text", text: " " },
      { type: "italic", children: [{ type: "text", text: "italic" }] },
      { type: "text", text: " " },
      { type: "strike", children: [{ type: "text", text: "strike" }] },
      { type: "text", text: " " },
      { type: "underline", children: [{ type: "text", text: "under" }] },
      { type: "text", text: " " },
      { type: "spoiler", children: [{ type: "text", text: "spoiler" }] },
      { type: "text", text: " " },
      { type: "code", text: "code" },
      { type: "text", text: " " },
      {
        type: "link",
        text: [{ type: "text", text: "site" }],
        url: "https://example.com",
      },
    ];

    expect(renderInlineNodesValidated(nodes)).toEqual({
      text: "Hello bold italic strike under spoiler code site",
      entities: [
        { type: "bold", offset: 6, length: 4 },
        { type: "italic", offset: 11, length: 6 },
        { type: "strikethrough", offset: 18, length: 6 },
        { type: "underline", offset: 25, length: 5 },
        { type: "spoiler", offset: 31, length: 7 },
        { type: "code", offset: 39, length: 4 },
        { type: "text_link", offset: 44, length: 4, url: "https://example.com" },
      ],
    });
  });

  it("counts UTF-16 offsets correctly for emoji and surrogate pairs", () => {
    const nodes: InlineNode[] = [
      { type: "text", text: "A" },
      {
        type: "bold",
        children: [
          { type: "text", text: "😀" },
          { type: "italic", children: [{ type: "text", text: "B𠌕" }] },
        ],
      },
    ];

    expect(renderInlineNodesValidated(nodes)).toEqual({
      text: "A😀B𠌕",
      entities: [
        { type: "bold", offset: 1, length: 5 },
        { type: "italic", offset: 3, length: 3 },
      ],
    });
  });

  it("renders mixed cyrillic and emoji content", () => {
    const nodes: InlineNode[] = [
      {
        type: "link",
        text: [{ type: "text", text: "Привет 😀" }],
        url: "https://example.com/hello",
      },
      { type: "text", text: " " },
      { type: "underline", children: [{ type: "text", text: "мир" }] },
    ];

    expect(renderInlineNodesValidated(nodes)).toEqual({
      text: "Привет 😀 мир",
      entities: [
        { type: "text_link", offset: 0, length: 9, url: "https://example.com/hello" },
        { type: "underline", offset: 10, length: 3 },
      ],
    });
  });

  it("supports nested formatting and link-style overlap", () => {
    const nodes: InlineNode[] = [
      {
        type: "bold",
        children: [
          { type: "text", text: "Go to " },
          {
            type: "link",
            text: [
              { type: "underline", children: [{ type: "text", text: "docs" }] },
              { type: "text", text: " now" },
            ],
            url: "https://example.com/docs",
          },
        ],
      },
    ];

    expect(renderInlineNodesValidated(nodes)).toEqual({
      text: "Go to docs now",
      entities: [
        { type: "bold", offset: 0, length: 14 },
        { type: "text_link", offset: 6, length: 8, url: "https://example.com/docs" },
        { type: "underline", offset: 6, length: 4 },
      ],
    });
  });

  it("preserves code spans with unicode text", () => {
    const nodes: InlineNode[] = [
      { type: "text", text: "run " },
      { type: "code", text: "npm тест 😀" },
    ];

    expect(renderInlineNodesValidated(nodes)).toEqual({
      text: "run npm тест 😀",
      entities: [{ type: "code", offset: 4, length: 11 }],
    });
  });

  it("renders parser-produced inline nodes without validation errors", () => {
    const blocks = parseTelegramBlocks(
      "Hello **bold** *italic* ~~strike~~ `code` [site](https://example.com)",
    );
    const paragraph = blocks[0];

    expect(paragraph).toMatchObject({ type: "paragraph" });
    expect(paragraph.type).toBe("paragraph");

    const rendered = renderInlineNodesValidated(paragraph.inlines);

    expect(rendered.text).toBe("Hello bold italic strike code site");
    expect(rendered.entities).toEqual([
      { type: "bold", offset: 6, length: 4 },
      { type: "italic", offset: 11, length: 6 },
      { type: "strikethrough", offset: 18, length: 6 },
      { type: "code", offset: 25, length: 4 },
      { type: "text_link", offset: 30, length: 4, url: "https://example.com" },
    ]);
  });

  it("preserves local markdown link targets as plain text without breaking validation", () => {
    const blocks = parseTelegramBlocks("See [security](#безопасность)");
    const paragraph = blocks[0];

    expect(paragraph).toMatchObject({ type: "paragraph" });
    expect(paragraph.type).toBe("paragraph");

    expect(renderInlineNodesValidated(paragraph.inlines)).toEqual({
      text: "See security (#безопасность)",
      entities: [],
    });
  });

  it("preserves localhost links as plain text without text_link entities", () => {
    const blocks = parseTelegramBlocks("Open [dev server](http://localhost:3000) now");
    const paragraph = blocks[0];

    expect(paragraph).toMatchObject({ type: "paragraph" });
    expect(paragraph.type).toBe("paragraph");

    expect(renderInlineNodesValidated(paragraph.inlines)).toEqual({
      text: "Open dev server (http://localhost:3000) now",
      entities: [],
    });
  });

  it("does not duplicate bare localhost autolinks", () => {
    const blocks = parseTelegramBlocks("Open http://localhost:3000 now");
    const paragraph = blocks[0];

    expect(paragraph).toMatchObject({ type: "paragraph" });
    expect(paragraph.type).toBe("paragraph");

    expect(renderInlineNodesValidated(paragraph.inlines)).toEqual({
      text: "Open http://localhost:3000 now",
      entities: [],
    });
  });

  it("keeps newline text nodes as plain text in the output", () => {
    const nodes: InlineNode[] = [
      { type: "text", text: "line 1" },
      { type: "text", text: "\n" },
      { type: "spoiler", children: [{ type: "text", text: "line 2" }] },
    ];

    expect(renderInlineNodes(nodes)).toEqual({
      text: "line 1\nline 2",
      entities: [{ type: "spoiler", offset: 7, length: 6 }],
    });
  });

  it("throws when rendered entities violate validation rules", () => {
    const nodes: InlineNode[] = [
      {
        type: "bold",
        children: [{ type: "code", text: "bad" }],
      },
    ];

    expect(() => renderInlineNodesValidated(nodes)).toThrow(/Invalid Telegram inline entities/);
  });
});
