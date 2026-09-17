import { describe, expect, it } from "#vitest";
import { guardRenderedPart, sanitizeCjkText } from "../../../src/bot/render/cjk-guard.js";
import { renderTelegramBlocks, renderTelegramParts } from "../../../src/bot/render/pipeline.js";
import type { TelegramRenderedPart } from "../../../src/bot/render/types.js";
import { en } from "../../../src/i18n/en.js";

const ANY_CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/;

describe("bot/render/cjk-guard", () => {
  it("leaves clean text untouched", () => {
    const text = "Hola, ¿qué tal? 🚀 100% ñandú — mergea la PR";

    expect(sanitizeCjkText(text)).toEqual({ text, removed: 0, blocked: false });
  });

  it("strips Han characters and keeps the rest", () => {
    const result = sanitizeCjkText("Hola 你好 mundo");

    expect(result.removed).toBe(2);
    expect(result.blocked).toBe(false);
    expect(result.text).toBe("Hola  mundo");
    expect(result.text).not.toMatch(ANY_CJK);
  });

  it("strips kana, hangul and fullwidth forms from mixed text", () => {
    const result = sanitizeCjkText("texto en español con カタカナ y 안녕 suelto");

    expect(result.removed).toBe(6);
    expect(result.blocked).toBe(false);
    expect(result.text).not.toMatch(ANY_CJK);
    expect(result.text).toBe("texto en español con  y  suelto");
  });

  it("blocks messages that are mostly CJK even when latin fragments remain", () => {
    const result = sanitizeCjkText("ok カタカナ 안녕 ＡＢＣ done");

    expect(result.removed).toBe(9);
    expect(result.blocked).toBe(true);
    expect(result.text).toBe(en["cjk_guard.correcting_notice"]);
  });

  it("replaces a fully CJK message with the localized notice", () => {
    const result = sanitizeCjkText("你好，世界！");

    expect(result.blocked).toBe(true);
    expect(result.text).toBe(en["cjk_guard.correcting_notice"]);
  });

  it("returns parts without CJK unchanged", () => {
    const part: TelegramRenderedPart = {
      blocks: [],
      fallbackText: "texto limpio",
      source: "plain",
    };

    expect(guardRenderedPart(part)).toBe(part);
  });

  it("rebuilds parts carrying CJK as sanitized plain text", () => {
    const part: TelegramRenderedPart = {
      blocks: [{ type: "paragraph", text: "你好" }],
      fallbackText: "Hola 你好 mundo",
      source: "blocks",
    };

    const guarded = guardRenderedPart(part);

    expect(guarded.source).toBe("plain");
    expect(guarded.blocks).toEqual([]);
    expect(guarded.fallbackText).toBe("Hola  mundo");
  });

  it("keeps rendered pipeline output free of CJK", () => {
    const blocks = renderTelegramBlocks("**Hola** 你好 mundo");
    const parts = renderTelegramParts("# Título\n\n texto 你好 final");

    expect(blocks.every((rendered) => !ANY_CJK.test(rendered.plainText))).toBe(true);
    expect(parts.length).toBeGreaterThan(0);
    expect(parts.every((part) => !ANY_CJK.test(part.fallbackText))).toBe(true);
  });
});
