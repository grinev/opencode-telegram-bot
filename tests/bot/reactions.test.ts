import { describe, expect, it, vi } from "vitest";
import { pickReactionEmoji } from "../../src/bot/reactions.js";

describe("bot/reactions", () => {
  it("returns a valid emoji from the pool", () => {
    const emoji = pickReactionEmoji();
    const validEmojis = ["👍", "❤", "🔥", "🎉", "😁", "🤩", "👏", "⚡", "🙏", "👌", "💯", "🏆", "❤‍🔥", "🕊", "🤓", "👀", "😇", "🤝", "✍", "🤗", "🫡", "🤪", "🆒", "🦄", "😎", "👾"];
    expect(validEmojis).toContain(emoji);
  });

  it("returns different emojis over multiple calls", () => {
    const results = new Set(Array.from({ length: 100 }, () => pickReactionEmoji()));
    expect(results.size).toBeGreaterThan(1);
  });
});
