import { describe, expect, it } from "#vitest";

import { prepareThinkingPayload } from "../../../src/bot/messages/thinking-rendering.js";
import { PLAIN_MAX_PART_CHARS } from "../../../src/bot/render/limits.js";
import { t } from "../../../src/i18n/index.js";
import { defined } from "../../helpers/defined.js";

describe("bot/messages/thinking-rendering", () => {
  it("quotes the reasoning under a header line", () => {
    const header = `${t("bot.thinking")} — Analysis`;

    const payload = prepareThinkingPayload([
      { id: "r1", title: "Analysis", text: "Line one\nLine two" },
    ]);

    expect(payload?.parts).toHaveLength(1);
    const firstPart = defined(payload?.parts[0]);
    expect(firstPart.source).toBe("plain");
    expect(firstPart.blocks).toEqual([]);
    expect(firstPart.fallbackText).toBe(`${header}\nLine one\nLine two`);
    expect(firstPart.entities).toEqual([
      { type: "blockquote", offset: header.length + 1, length: "Line one\nLine two".length },
    ]);
  });

  it("falls back to the bare header when a section has no title", () => {
    const payload = prepareThinkingPayload([{ id: "r1", text: "A" }]);

    expect(defined(payload?.parts[0]).fallbackText).toBe(`${t("bot.thinking")}\nA`);
  });

  it("keeps the quote open while the model is still thinking", () => {
    const payload = prepareThinkingPayload([{ id: "r1", text: "Line one" }]);

    expect(defined(payload?.parts[0]?.entities?.[0]).type).toBe("blockquote");
  });

  it("collapses the quote for final delivery", () => {
    const payload = prepareThinkingPayload([{ id: "r1", text: "Line one" }], { final: true });

    expect(defined(payload?.parts[0]?.entities?.[0]).type).toBe("expandable_blockquote");
  });

  it("emits one part per reasoning section, in order", () => {
    const payload = prepareThinkingPayload([
      { id: "r1", title: "First", text: "A" },
      { id: "r2", title: "Second", text: "B" },
    ]);

    expect(payload?.parts.map((part) => part.fallbackText)).toEqual([
      `${t("bot.thinking")} — First\nA`,
      `${t("bot.thinking")} — Second\nB`,
    ]);
  });

  it("leaves markdown inside the reasoning untouched", () => {
    const text = "- one\n- two";
    const payload = prepareThinkingPayload([{ id: "r1", text }]);

    expect(defined(payload?.parts[0]).fallbackText).toBe(`${t("bot.thinking")}\n${text}`);
  });

  it("normalizes line endings and trims the trailing whitespace", () => {
    const payload = prepareThinkingPayload([{ id: "r1", text: "one\r\ntwo\n\n" }]);

    expect(defined(payload?.parts[0]).fallbackText).toBe(`${t("bot.thinking")}\none\ntwo`);
  });

  it("splits reasoning that does not fit one text message, repeating the header", () => {
    const header = t("bot.thinking");
    const text = Array.from({ length: 400 }, (_, index) => `line ${index} ${"y".repeat(40)}`).join(
      "\n",
    );

    const payload = prepareThinkingPayload([{ id: "r1", text }], { final: true });
    const parts = payload?.parts ?? [];

    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.fallbackText.startsWith(`${header}\n`)).toBe(true);
      expect(part.fallbackText.length).toBeLessThanOrEqual(PLAIN_MAX_PART_CHARS);
      expect(part.entities?.[0]).toEqual({
        type: "expandable_blockquote",
        offset: header.length + 1,
        length: part.fallbackText.length - header.length - 1,
      });
    }

    const joined = parts.map((part) => part.fallbackText.slice(header.length + 1)).join("");
    expect(joined).toBe(text);
  });

  it("keeps an empty section as a header without a quote", () => {
    const payload = prepareThinkingPayload([{ id: "r1", title: "Empty", text: "" }]);

    expect(defined(payload?.parts[0]).fallbackText).toBe(`${t("bot.thinking")} — Empty`);
    expect(defined(payload?.parts[0]).entities).toBeUndefined();
  });

  it("returns no payload without sections", () => {
    expect(prepareThinkingPayload([])).toBeNull();
  });
});
