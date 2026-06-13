import { describe, expect, it, vi } from "vitest";

describe("bot/streaming/finalize-assistant-response logging", () => {
  it("logs final assistant raw text exactly once per finalize call", async () => {
    vi.resetModules();

    const debug = vi.fn();
    vi.doMock("../../../src/utils/logger.js", () => ({
      logger: {
        debug,
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    }));

    const { finalizeAssistantResponse } =
      await import("../../../src/bot/streaming/finalize-assistant-response.js");

    await finalizeAssistantResponse({
      sessionId: "s1",
      messageId: "m1",
      messageText: "raw model output",
      responseStreamer: {
        complete: vi.fn().mockResolvedValue({ streamed: false, telegramMessageIds: [] }),
      },
      flushPendingServiceMessages: vi.fn().mockResolvedValue(undefined),
      prepareStreamingPayload: vi.fn(() => null),
      renderFinalParts: vi.fn(() => [
        {
          text: "raw model output",
          fallbackText: "raw model output",
          source: "plain" as const,
        },
      ]),
      getReplyKeyboard: vi.fn(() => undefined),
      sendRenderedPart: vi.fn().mockResolvedValue(undefined),
    });

    expect(debug).toHaveBeenCalledWith(
      "[FinalizeResponse] Final assistant raw text received: session=s1, message=m1",
      "raw model output",
    );
    expect(
      debug.mock.calls.filter(
        (call) =>
          call[0] ===
          "[FinalizeResponse] Final assistant raw text received: session=s1, message=m1",
      ),
    ).toHaveLength(1);
  });
});
