import { describe, expect, it } from "vitest";

import {
  makeThinkingPayloadExpandable,
  prepareThinkingStreamingPayload,
} from "../../../src/bot/messages/thinking-rendering.js";
import { t } from "../../../src/i18n/index.js";

describe("bot/messages/thinking-rendering", () => {
  it("renders thinking title on the first line and content as a quote", () => {
    const header = `${t("bot.thinking")} — Analysis`;
    const text = "Line one\nLine two";

    const payload = prepareThinkingStreamingPayload(
      [{ id: "r1", title: "Analysis", text }],
      3800,
    );

    expect(payload?.parts).toEqual([
      {
        text: `${header}\n${text}`,
        entities: [{ type: "expandable_blockquote", offset: header.length + 1, length: text.length }],
        fallbackText: `${header}\n> Line one\n> Line two`,
        source: "entities",
        thinkingText: `${header}\n${text}`,
      },
    ]);
  });

  it("renders all reasoning sections in order", () => {
    const payload = prepareThinkingStreamingPayload(
      [
        { id: "r1", title: "First", text: "A" },
        { id: "r2", title: "Second", text: "B" },
      ],
      3800,
    );

    expect(payload?.parts.map((part) => part.text)).toEqual([
      `${t("bot.thinking")} — First\nA`,
      `${t("bot.thinking")} — Second\nB`,
    ]);
  });

  it("can render thinking content as a regular quote while streaming", () => {
    const header = `${t("bot.thinking")} — Analysis`;
    const payload = prepareThinkingStreamingPayload(
      [{ id: "r1", title: "Analysis", text: "Line one" }],
      3800,
      { expandable: false },
    );

    expect(payload?.parts[0].entities).toEqual([
      { type: "blockquote", offset: header.length + 1, length: "Line one".length },
    ]);
  });

  it("converts streamed quote payloads to expandable quotes for final delivery", () => {
    const header = t("bot.thinking");
    const payload = prepareThinkingStreamingPayload([{ id: "r1", text: "Line one" }], 3800, {
      expandable: false,
    });

    expect(payload).not.toBeNull();

    const finalPayload = makeThinkingPayloadExpandable(payload!);

    expect(finalPayload.parts[0].entities).toEqual([
      { type: "expandable_blockquote", offset: header.length + 1, length: "Line one".length },
    ]);
  });

  it("splits long thinking content into multiple quoted parts", () => {
    const header = t("bot.thinking");
    const payload = prepareThinkingStreamingPayload(
      [{ id: "r1", text: "abcdefghij" }],
      header.length + 1 + 4,
    );

    expect(payload?.parts.map((part) => part.text)).toEqual([
      `${header}\nabcd`,
      `${header}\nefgh`,
      `${header}\nij`,
    ]);
    expect(payload?.parts[0].entities).toEqual([
      { type: "expandable_blockquote", offset: header.length + 1, length: 4 },
    ]);
  });
});
