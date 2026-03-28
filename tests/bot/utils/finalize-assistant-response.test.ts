import { describe, expect, it, vi } from "vitest";
import { finalizeAssistantResponse } from "../../../src/bot/utils/finalize-assistant-response.js";

describe("bot/utils/finalize-assistant-response", () => {
  it("uses the non-streaming send path when response streaming is disabled", async () => {
    const responseStreamer = {
      complete: vi.fn().mockResolvedValue({ streamed: false, telegramMessageIds: [] }),
    };
    const flushPendingServiceMessages = vi.fn().mockResolvedValue(undefined);
    const sendText = vi.fn().mockResolvedValue(undefined);
    const deleteMessages = vi.fn().mockResolvedValue(undefined);

    await finalizeAssistantResponse({
      responseStreaming: false,
      sessionId: "s1",
      messageId: "m1",
      messageText: "final reply",
      responseStreamer,
      flushPendingServiceMessages,
      prepareStreamingPayload: vi.fn(),
      formatSummary: vi.fn(() => ["part 1", "part 2"]),
      resolveFormat: vi.fn(() => "markdown_v2"),
      getReplyKeyboard: vi.fn(() => ({ keyboard: [[{ text: "A" }]] })),
      sendText,
      deleteMessages,
    });

    expect(responseStreamer.complete).not.toHaveBeenCalled();
    expect(flushPendingServiceMessages).toHaveBeenCalledTimes(1);
    expect(deleteMessages).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledTimes(2);
    expect(sendText).toHaveBeenNthCalledWith(
      1,
      "part 1",
      { reply_markup: { keyboard: [[{ text: "A" }]] } },
      "markdown_v2",
    );
    expect(sendText).toHaveBeenNthCalledWith(
      2,
      "part 2",
      { reply_markup: { keyboard: [[{ text: "A" }]] } },
      "markdown_v2",
    );
  });

  it("deletes streamed messages and re-sends with keyboard when streaming delivered the message", async () => {
    const responseStreamer = {
      complete: vi.fn().mockResolvedValue({ streamed: true, telegramMessageIds: [101] }),
    };
    const flushPendingServiceMessages = vi.fn().mockResolvedValue(undefined);
    const sendText = vi.fn().mockResolvedValue(undefined);
    const deleteMessages = vi.fn().mockResolvedValue(undefined);
    const prepareStreamingPayload = vi.fn(() => ({ parts: ["reply"], format: "raw" as const }));
    const keyboard = { keyboard: [[{ text: "ctx" }]] };

    await finalizeAssistantResponse({
      responseStreaming: true,
      sessionId: "s1",
      messageId: "m1",
      messageText: "reply",
      responseStreamer,
      flushPendingServiceMessages,
      prepareStreamingPayload,
      formatSummary: vi.fn(() => ["reply"]),
      resolveFormat: vi.fn(() => "raw"),
      getReplyKeyboard: vi.fn(() => keyboard),
      sendText,
      deleteMessages,
    });

    expect(responseStreamer.complete).toHaveBeenCalledWith("s1", "m1", {
      parts: ["reply"],
      format: "raw",
      sendOptions: undefined,
      editOptions: undefined,
    });
    expect(flushPendingServiceMessages).toHaveBeenCalledTimes(1);
    expect(deleteMessages).toHaveBeenCalledWith([101]);
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith("reply", { reply_markup: keyboard }, "raw");
  });

  it("still sends with keyboard when streamer reports not streamed", async () => {
    const responseStreamer = {
      complete: vi.fn().mockResolvedValue({ streamed: false, telegramMessageIds: [] }),
    };
    const flushPendingServiceMessages = vi.fn().mockResolvedValue(undefined);
    const sendText = vi.fn().mockResolvedValue(undefined);
    const deleteMessages = vi.fn().mockResolvedValue(undefined);
    const prepareStreamingPayload = vi.fn(() => ({ parts: ["reply"], format: "raw" as const }));

    await finalizeAssistantResponse({
      responseStreaming: true,
      sessionId: "s1",
      messageId: "m1",
      messageText: "reply",
      responseStreamer,
      flushPendingServiceMessages,
      prepareStreamingPayload,
      formatSummary: vi.fn(() => ["reply"]),
      resolveFormat: vi.fn(() => "raw"),
      getReplyKeyboard: vi.fn(() => undefined),
      sendText,
      deleteMessages,
    });

    expect(deleteMessages).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith("reply", undefined, "raw");
  });
});
