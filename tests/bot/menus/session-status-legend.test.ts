import { describe, expect, it } from "vitest";
import {
  SESSION_STATUS_GLYPHS,
  buildSessionStatusLegend,
} from "../../../src/bot/menus/session-status-legend.js";

describe("session status legend", () => {
  it("pins the glyphs and the legend wording shared by /sessions and /recent", () => {
    expect(SESSION_STATUS_GLYPHS).toEqual({
      running: "⏳",
      idle: "○",
      question: "❓",
      permission: "🔐",
    });
    expect(buildSessionStatusLegend()).toBe(
      "⏳ running · ○ idle · ❓ awaiting an answer · 🔐 awaiting permission",
    );
  });
});
