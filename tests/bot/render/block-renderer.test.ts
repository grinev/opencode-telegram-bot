import { describe, expect, it } from "vitest";
import { renderTelegramBlock } from "../../../src/bot/render/block-renderer.js";
import type { TelegramBlock } from "../../../src/bot/render/types.js";

describe("bot/render/block-renderer", () => {
  it("renders paragraph blocks with inline entities", () => {
    const block: TelegramBlock = {
      type: "paragraph",
      inlines: [
        { type: "text", text: "Hello " },
        { type: "bold", children: [{ type: "text", text: "bold" }] },
        { type: "text", text: " " },
        { type: "link", text: [{ type: "text", text: "site" }], url: "https://example.com" },
      ],
    };

    expect(renderTelegramBlock(block)).toEqual({
      blockType: "paragraph",
      mode: "full",
      text: "Hello bold site",
      entities: [
        { type: "bold", offset: 6, length: 4 },
        { type: "text_link", offset: 11, length: 4, url: "https://example.com" },
      ],
      fallbackText: "Hello bold site",
      source: "entities",
    });
  });

  it("renders headings as full-range bold with nested inline entities", () => {
    const block: TelegramBlock = {
      type: "heading",
      level: 2,
      inlines: [
        { type: "text", text: "Read " },
        { type: "italic", children: [{ type: "text", text: "this" }] },
      ],
    };

    expect(renderTelegramBlock(block)).toEqual({
      blockType: "heading",
      mode: "full",
      text: "Read this",
      entities: [
        { type: "bold", offset: 0, length: 9 },
        { type: "italic", offset: 5, length: 4 },
      ],
      fallbackText: "Read this",
      source: "entities",
    });
  });

  it("renders blockquotes with literal prefixes instead of blockquote entities", () => {
    const block: TelegramBlock = {
      type: "blockquote",
      lines: [
        [
          { type: "text", text: "Note " },
          { type: "bold", children: [{ type: "text", text: "this" }] },
        ],
        [{ type: "text", text: "Second line" }],
      ],
    };

    expect(renderTelegramBlock(block)).toEqual({
      blockType: "blockquote",
      mode: "full",
      text: "> Note this\n> Second line",
      entities: [{ type: "bold", offset: 7, length: 4 }],
      fallbackText: "> Note this\n> Second line",
      source: "entities",
    });
  });

  it("renders ordered lists with rebased item entities", () => {
    const block: TelegramBlock = {
      type: "list",
      ordered: true,
      items: [
        [
          { type: "text", text: "Open " },
          { type: "code", text: "api.js" },
        ],
        [
          { type: "text", text: "Call " },
          { type: "link", text: [{ type: "text", text: "docs" }], url: "https://example.com/docs" },
        ],
      ],
    };

    expect(renderTelegramBlock(block)).toEqual({
      blockType: "list",
      mode: "full",
      text: "1. Open api.js\n2. Call docs",
      entities: [
        { type: "code", offset: 8, length: 6 },
        { type: "text_link", offset: 23, length: 4, url: "https://example.com/docs" },
      ],
      fallbackText: "1. Open api.js\n2. Call docs",
      source: "entities",
    });
  });

  it("renders code blocks as pre entities", () => {
    const block: TelegramBlock = {
      type: "code",
      language: "ts",
      text: "const x = 1;",
    };

    expect(renderTelegramBlock(block)).toEqual({
      blockType: "code",
      mode: "full",
      text: "const x = 1;",
      entities: [{ type: "pre", offset: 0, length: 12, language: "ts" }],
      fallbackText: "const x = 1;",
      source: "entities",
    });
  });

  it("renders tables as aligned preformatted text", () => {
    const block: TelegramBlock = {
      type: "table",
      rows: [
        ["Name", "Score"],
        ["api.js", "+1.5"],
        ["alert()", "-1.5"],
      ],
    };

    expect(renderTelegramBlock(block)).toEqual({
      blockType: "table",
      mode: "full",
      text: "Name    | Score\n--------|------\napi.js  | +1.5 \nalert() | -1.5 ",
      entities: [{ type: "pre", offset: 0, length: 63 }],
      fallbackText: "Name    | Score\n--------|------\napi.js  | +1.5 \nalert() | -1.5 ",
      source: "entities",
    });
  });

  it("renders rules and plain blocks without entities", () => {
    expect(renderTelegramBlock({ type: "rule" })).toEqual({
      blockType: "rule",
      mode: "full",
      text: "──────────",
      fallbackText: "──────────",
      source: "plain",
    });

    expect(renderTelegramBlock({ type: "plain", text: "raw text" })).toEqual({
      blockType: "plain",
      mode: "full",
      text: "raw text",
      fallbackText: "raw text",
      source: "plain",
    });
  });

  it("renders line-by-line mode and degrades only the broken line", () => {
    const block: TelegramBlock = {
      type: "paragraph",
      inlines: [
        { type: "text", text: "good line\n" },
        { type: "link", text: [{ type: "text", text: "bad line" }], url: "javascript:alert(1)" },
      ],
    };

    expect(renderTelegramBlock(block, "line-by-line")).toEqual({
      blockType: "paragraph",
      mode: "line-by-line",
      text: "good line\nbad line",
      fallbackText: "good line\nbad line",
      source: "plain",
    });
  });
});
