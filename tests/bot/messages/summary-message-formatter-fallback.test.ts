import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  convertToTelegramMarkdownV2: vi.fn(),
}));

vi.mock("../../../src/bot/render/markdown-to-telegram-v2.js", () => ({
  convertToTelegramMarkdownV2: mocked.convertToTelegramMarkdownV2,
}));

describe("bot/messages/summary-message-formatter markdown fallback", () => {
  beforeEach(() => {
    mocked.convertToTelegramMarkdownV2.mockReset();
  });

  it("keeps summary delivery alive when markdown conversion fails", async () => {
    mocked.convertToTelegramMarkdownV2.mockImplementation(() => {
      throw new Error("conversion failed");
    });

    const { formatSummaryWithMode } = await import(
      "../../../src/bot/messages/summary-message-formatter.js"
    );

    expect(formatSummaryWithMode("**raw** text!", "markdown")).toEqual(["**raw** text!"]);
    expect(mocked.convertToTelegramMarkdownV2).toHaveBeenCalledOnce();
  });
});
