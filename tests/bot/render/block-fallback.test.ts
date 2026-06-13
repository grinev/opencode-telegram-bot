import { describe, expect, it, vi } from "vitest";
import * as blockRenderer from "../../../src/bot/render/block-renderer.js";
import { renderTelegramBlockWithFallback } from "../../../src/bot/render/block-fallback.js";
import type { TelegramBlock } from "../../../src/bot/render/types.js";

describe("bot/render/block-fallback", () => {
  it("keeps full mode when the preferred renderer succeeds", () => {
    const block: TelegramBlock = {
      type: "paragraph",
      inlines: [{ type: "text", text: "hello" }],
    };

    expect(renderTelegramBlockWithFallback(block)).toEqual({
      blockType: "paragraph",
      mode: "full",
      text: "hello",
      fallbackText: "hello",
      source: "plain",
    });
  });

  it("falls back from full to simplified when style-code nesting is invalid", () => {
    const block: TelegramBlock = {
      type: "paragraph",
      inlines: [{ type: "bold", children: [{ type: "code", text: "npm test" }] }],
    };

    expect(renderTelegramBlockWithFallback(block)).toEqual({
      blockType: "paragraph",
      mode: "simplified",
      text: "npm test",
      entities: [{ type: "code", offset: 0, length: 8 }],
      fallbackText: "npm test",
      source: "entities",
    });
  });

  it("falls back to line-by-line when a single line has an invalid link", () => {
    const block: TelegramBlock = {
      type: "paragraph",
      inlines: [
        { type: "text", text: "good line\n" },
        { type: "link", text: [{ type: "text", text: "bad line" }], url: "javascript:alert(1)" },
      ],
    };

    expect(renderTelegramBlockWithFallback(block)).toEqual({
      blockType: "paragraph",
      mode: "line-by-line",
      text: "good line\nbad line",
      fallbackText: "good line\nbad line",
      source: "plain",
    });
  });

  it("uses plain mode when richer renderers keep failing unexpectedly", () => {
    const block: TelegramBlock = {
      type: "plain",
      text: "fallback text",
    };

    const spy = vi.spyOn(blockRenderer, "renderTelegramBlock");
    spy.mockImplementation((inputBlock, mode = "full") => {
      if (mode !== "plain") {
        throw new Error(`failed ${mode}`);
      }

      return {
        blockType: inputBlock.type,
        mode,
        text: "fallback text",
        fallbackText: "fallback text",
        source: "plain",
      };
    });

    try {
      expect(renderTelegramBlockWithFallback(block)).toEqual({
        blockType: "plain",
        mode: "plain",
        text: "fallback text",
        fallbackText: "fallback text",
        source: "plain",
      });
    } finally {
      spy.mockRestore();
    }
  });

  it("keeps neighboring blocks unaffected by one local fallback", () => {
    const blocks: TelegramBlock[] = [
      {
        type: "paragraph",
        inlines: [
          { type: "text", text: "good line\n" },
          { type: "link", text: [{ type: "text", text: "bad line" }], url: "javascript:alert(1)" },
        ],
      },
      {
        type: "paragraph",
        inlines: [{ type: "bold", children: [{ type: "text", text: "safe" }] }],
      },
    ];

    expect(blocks.map(renderTelegramBlockWithFallback)).toEqual([
      {
        blockType: "paragraph",
        mode: "line-by-line",
        text: "good line\nbad line",
        fallbackText: "good line\nbad line",
        source: "plain",
      },
      {
        blockType: "paragraph",
        mode: "full",
        text: "safe",
        entities: [{ type: "bold", offset: 0, length: 4 }],
        fallbackText: "safe",
        source: "entities",
      },
    ]);
  });
});
