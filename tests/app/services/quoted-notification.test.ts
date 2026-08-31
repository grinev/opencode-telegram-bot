import { describe, expect, it } from "#vitest";
import { buildQuotedNotification } from "../../../src/app/services/quoted-notification.js";

describe("app/services/quoted-notification", () => {
  it("builds a title plus quoted multiline body", () => {
    expect(buildQuotedNotification("🎤 Recognized:", "Line 1\nLine 2")).toEqual({
      text: "🎤 Recognized:\n\n> Line 1\n> Line 2",
      rawFallbackText: "🎤 Recognized:\n\n> Line 1\n> Line 2",
    });
  });

  it("quotes empty lines as a bare >", () => {
    expect(buildQuotedNotification("Title", "before\n\nafter")).toEqual({
      text: "Title\n\n> before\n>\n> after",
      rawFallbackText: "Title\n\n> before\n>\n> after",
    });
  });

  it("escapes MarkdownV2 in the title and body, but not in the raw fallback", () => {
    const notification = buildQuotedNotification("See _this_", "use *bold* and (parens)");

    expect(notification).toEqual({
      text: "See \\_this\\_\n\n> use \\*bold\\* and \\(parens\\)",
      rawFallbackText: "See _this_\n\n> use *bold* and (parens)",
    });
  });

  it("can omit the blank line between title and quote", () => {
    expect(
      buildQuotedNotification("🎤 Recognized:", "Line 1\nLine 2", {
        blankLineAfterTitle: false,
      }),
    ).toEqual({
      text: "🎤 Recognized:\n> Line 1\n> Line 2",
      rawFallbackText: "🎤 Recognized:\n> Line 1\n> Line 2",
    });
  });
});
