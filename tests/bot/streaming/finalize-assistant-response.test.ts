import { describe, expect, it, vi } from "vitest";
import { finalizeAssistantResponse } from "../../../src/bot/streaming/finalize-assistant-response.js";

describe("bot/streaming/finalize-assistant-response", () => {
  it.each([true, false])(
    "keeps whole reply documents before later service output (streamed=%s)",
    async (streamed) => {
      const order: string[] = [];
      const part = (text: string) => ({ blocks: [], fallbackText: text, source: "plain" as const });
      let released = false;
      await finalizeAssistantResponse({
        sessionId: "s",
        messageId: "m",
        messageText: "reply",
        responseStreamer: {
          complete: vi.fn(async () => {
            order.push("complete");
            return { streamed, telegramMessageIds: [] };
          }),
        },
        prepareStreamingPayload: () => ({ parts: [part("a"), part("b")] }),
        renderFinalParts: () => [part("a"), part("b")],
        getReplyKeyboard: () => undefined,
        strictFinalPayload: true,
        sendRenderedPart: async (value) => {
          order.push(value.fallbackText);
        },
        afterTextAccepted: async () => {
          order.push("documents");
          released = true;
        },
        flushPendingServiceMessages: async () => {
          expect(released).toBe(true);
          order.push("services");
        },
      });
      expect(order).toEqual(
        streamed
          ? ["complete", "documents", "services"]
          : ["complete", "a", "b", "documents", "services"],
      );
    },
  );

  it("does not upload documents or resend text when a later text chunk fails", async () => {
    const afterTextAccepted = vi.fn();
    const sendRenderedPart = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("offline"));
    const part = { blocks: [], fallbackText: "reply", source: "plain" as const };
    await expect(
      finalizeAssistantResponse({
        sessionId: "s",
        messageId: "m",
        messageText: "reply",
        responseStreamer: {
          complete: vi.fn().mockResolvedValue({ streamed: false, telegramMessageIds: [] }),
        },
        prepareStreamingPayload: () => ({ parts: [part] }),
        renderFinalParts: () => [part, part],
        getReplyKeyboard: () => undefined,
        strictFinalPayload: true,
        sendRenderedPart,
        afterTextAccepted,
        flushPendingServiceMessages: vi.fn(),
      }),
    ).rejects.toThrow("offline");
    expect(sendRenderedPart).toHaveBeenCalledTimes(2);
    expect(afterTextAccepted).not.toHaveBeenCalled();
  });

  it("propagates strict streamed final-payload failure instead of falling back and uploading documents", async () => {
    const afterTextAccepted = vi.fn();
    const sendRenderedPart = vi.fn();
    const part = { blocks: [], fallbackText: "reply", source: "plain" as const };
    await expect(
      finalizeAssistantResponse({
        sessionId: "s",
        messageId: "m",
        messageText: "reply",
        responseStreamer: { complete: vi.fn().mockRejectedValue(new Error("final chunk failed")) },
        prepareStreamingPayload: () => ({ parts: [part] }),
        renderFinalParts: () => [part],
        getReplyKeyboard: () => undefined,
        strictFinalPayload: true,
        sendRenderedPart,
        afterTextAccepted,
        flushPendingServiceMessages: vi.fn(),
      }),
    ).rejects.toThrow("final chunk failed");
    expect(sendRenderedPart).not.toHaveBeenCalled();
    expect(afterTextAccepted).not.toHaveBeenCalled();
  });
  it("completes the response stream and sends final text when streamer reports not streamed", async () => {
    const responseStreamer = {
      complete: vi.fn().mockResolvedValue({ streamed: false, telegramMessageIds: [] }),
    };
    const flushPendingServiceMessages = vi.fn().mockResolvedValue(undefined);
    const sendRenderedPart = vi.fn().mockResolvedValue(undefined);
    const keyboard = { keyboard: [[{ text: "A" }]] };

    await finalizeAssistantResponse({
      sessionId: "s1",
      messageId: "m1",
      messageText: "final reply",
      responseStreamer,
      flushPendingServiceMessages,
      prepareStreamingPayload: vi.fn(() => ({
        parts: [
          {
            blocks: [],
            fallbackText: "final reply",
            source: "plain" as const,
          },
        ],
      })),
      renderFinalParts: vi.fn(() => [
        {
          blocks: [{ type: "paragraph" as const, text: { type: "bold" as const, text: "part 1" } }],
          fallbackText: "part 1",
          source: "blocks" as const,
        },
        {
          blocks: [],
          fallbackText: "part 2",
          source: "plain" as const,
        },
      ]),
      getReplyKeyboard: vi.fn(() => keyboard),
      sendRenderedPart,
    });

    expect(responseStreamer.complete).toHaveBeenCalledWith("s1", "m1", {
      parts: [
        {
          blocks: [],
          fallbackText: "final reply",
          source: "plain",
        },
      ],
      sendOptions: { disable_notification: true, reply_markup: keyboard },
      editOptions: undefined,
    });
    expect(flushPendingServiceMessages).toHaveBeenCalledTimes(1);
    expect(sendRenderedPart).toHaveBeenCalledTimes(2);
    expect(sendRenderedPart).toHaveBeenNthCalledWith(
      1,
      {
        blocks: [{ type: "paragraph", text: { type: "bold", text: "part 1" } }],
        fallbackText: "part 1",
        source: "blocks",
      },
      { disable_notification: true, reply_markup: keyboard },
    );
    expect(sendRenderedPart).toHaveBeenNthCalledWith(
      2,
      {
        blocks: [],
        fallbackText: "part 2",
        source: "plain",
      },
      { disable_notification: true, reply_markup: keyboard },
    );
  });

  it("finalizes streamed messages in place without re-sending", async () => {
    const responseStreamer = {
      complete: vi.fn().mockResolvedValue({ streamed: true, telegramMessageIds: [101] }),
    };
    const flushPendingServiceMessages = vi.fn().mockResolvedValue(undefined);
    const sendRenderedPart = vi.fn().mockResolvedValue(undefined);
    const prepareStreamingPayload = vi.fn(() => ({
      parts: [
        {
          blocks: [],
          fallbackText: "reply",
          source: "plain" as const,
        },
      ],
    }));
    const keyboard = { keyboard: [[{ text: "ctx" }]] };

    await finalizeAssistantResponse({
      sessionId: "s1",
      messageId: "m1",
      messageText: "reply",
      responseStreamer,
      flushPendingServiceMessages,
      prepareStreamingPayload,
      renderFinalParts: vi.fn(() => [
        {
          blocks: [],
          fallbackText: "reply",
          source: "plain" as const,
        },
      ]),
      getReplyKeyboard: vi.fn(() => keyboard),
      sendRenderedPart,
    });

    expect(responseStreamer.complete).toHaveBeenCalledWith("s1", "m1", {
      parts: [
        {
          blocks: [],
          fallbackText: "reply",
          source: "plain",
        },
      ],
      sendOptions: { disable_notification: true, reply_markup: keyboard },
      editOptions: undefined,
    });
    expect(flushPendingServiceMessages).toHaveBeenCalledTimes(1);
    expect(sendRenderedPart).not.toHaveBeenCalled();
  });

  it("still sends rendered parts with keyboard when streamer reports not streamed", async () => {
    const responseStreamer = {
      complete: vi.fn().mockResolvedValue({ streamed: false, telegramMessageIds: [] }),
    };
    const flushPendingServiceMessages = vi.fn().mockResolvedValue(undefined);
    const sendRenderedPart = vi.fn().mockResolvedValue(undefined);
    const prepareStreamingPayload = vi.fn(() => ({
      parts: [
        {
          blocks: [],
          fallbackText: "reply",
          source: "plain" as const,
        },
      ],
    }));

    await finalizeAssistantResponse({
      sessionId: "s1",
      messageId: "m1",
      messageText: "reply",
      responseStreamer,
      flushPendingServiceMessages,
      prepareStreamingPayload,
      renderFinalParts: vi.fn(() => [
        {
          blocks: [],
          fallbackText: "reply",
          source: "plain" as const,
        },
      ]),
      getReplyKeyboard: vi.fn(() => undefined),
      sendRenderedPart,
    });

    expect(sendRenderedPart).toHaveBeenCalledTimes(1);
    expect(sendRenderedPart).toHaveBeenCalledWith(
      {
        blocks: [],
        fallbackText: "reply",
        source: "plain",
      },
      { disable_notification: true },
    );
  });
});
