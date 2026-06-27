import { afterEach, describe, expect, it, vi } from "vitest";
import { ResponseStreamer } from "../../../src/bot/streaming/response-streamer.js";

function plainPart(text: string) {
  return {
    text,
    fallbackText: text,
    source: "plain" as const,
  };
}

function richPart(
  text: string,
  entities: { type: "bold" | "italic"; offset: number; length: number }[],
) {
  return {
    text,
    entities,
    fallbackText: text,
    source: "entities" as const,
  };
}

function signature(part: { text: string; entities?: unknown[] }) {
  return `${part.text}\n${JSON.stringify(part.entities ?? null)}`;
}

describe("bot/streaming/response-streamer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("throttles updates and sends only the latest payload", async () => {
    vi.useFakeTimers();

    let nextMessageId = 1;
    const sendPart = vi.fn(async (part) => ({
      messageId: nextMessageId++,
      deliveredSignature: signature(part),
    }));
    const editPart = vi.fn(async (messageId, part) => ({ deliveredSignature: signature(part) }));
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({
      throttleMs: 500,
      sendPart,
      editPart,
      deleteText,
    });

    streamer.enqueue("s1", "m1", { parts: [plainPart("first")] });
    streamer.enqueue("s1", "m1", { parts: [plainPart("second")] });

    await vi.advanceTimersByTimeAsync(500);

    expect(sendPart).toHaveBeenCalledTimes(1);
    expect(sendPart).toHaveBeenCalledWith(plainPart("second"), undefined);
    expect(editPart).not.toHaveBeenCalled();
    expect(deleteText).not.toHaveBeenCalled();
  });

  it("streams into a second Telegram message when parts grow", async () => {
    vi.useFakeTimers();

    let nextMessageId = 101;
    const sendPart = vi.fn(async (part) => ({
      messageId: nextMessageId++,
      deliveredSignature: signature(part),
    }));
    const editPart = vi.fn(async (messageId, part) => ({ deliveredSignature: signature(part) }));
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({
      throttleMs: 0,
      sendPart,
      editPart,
      deleteText,
    });

    streamer.enqueue("s1", "m1", { parts: [plainPart("part-1")] });
    await vi.waitFor(() => {
      expect(sendPart).toHaveBeenCalledTimes(1);
    });

    streamer.enqueue("s1", "m1", {
      parts: [plainPart("part-1"), plainPart("part-2")],
    });

    await vi.waitFor(() => {
      expect(sendPart).toHaveBeenCalledTimes(2);
    });

    expect(sendPart).toHaveBeenNthCalledWith(1, plainPart("part-1"), undefined);
    expect(sendPart).toHaveBeenNthCalledWith(2, plainPart("part-2"), undefined);
    expect(editPart).not.toHaveBeenCalled();
    expect(deleteText).not.toHaveBeenCalled();
  });

  it("flushes final payload on complete after streaming started", async () => {
    vi.useFakeTimers();

    let nextMessageId = 1;
    const sendPart = vi.fn(async (part) => ({
      messageId: nextMessageId++,
      deliveredSignature: signature(part),
    }));
    const editPart = vi.fn(async (messageId, part) => ({ deliveredSignature: signature(part) }));
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({
      throttleMs: 500,
      sendPart,
      editPart,
      deleteText,
    });

    streamer.enqueue("s1", "m1", { parts: [plainPart("partial")] });
    await vi.advanceTimersByTimeAsync(500);

    const result = await streamer.complete("s1", "m1", { parts: [plainPart("final")] });

    expect(result.streamed).toBe(true);
    expect(result.telegramMessageIds).toEqual([1]);
    expect(sendPart).toHaveBeenCalledTimes(1);
    expect(editPart).toHaveBeenCalledTimes(1);
    expect(editPart).toHaveBeenCalledWith(1, plainPart("final"), undefined);
    expect(deleteText).not.toHaveBeenCalled();
  });

  it("removes extra Telegram messages when payload shrinks", async () => {
    vi.useFakeTimers();

    let nextMessageId = 10;
    const sendPart = vi.fn(async (part) => ({
      messageId: nextMessageId++,
      deliveredSignature: signature(part),
    }));
    const editPart = vi.fn(async (messageId, part) => ({ deliveredSignature: signature(part) }));
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({
      throttleMs: 0,
      sendPart,
      editPart,
      deleteText,
    });

    streamer.enqueue("s1", "m1", { parts: [plainPart("one"), plainPart("two")] });
    await vi.waitFor(() => {
      expect(sendPart).toHaveBeenCalledTimes(2);
    });

    streamer.enqueue("s1", "m1", { parts: [plainPart("one")] });
    await vi.waitFor(() => {
      expect(deleteText).toHaveBeenCalledTimes(1);
    });

    expect(deleteText).toHaveBeenCalledWith(11);
  });

  it("retries after Telegram rate limits", async () => {
    vi.useFakeTimers();

    const sendPart = vi
      .fn()
      .mockRejectedValueOnce(new Error("429: retry after 1"))
      .mockImplementationOnce(async (part) => ({
        messageId: 1,
        deliveredSignature: signature(part),
      }));
    const editPart = vi.fn(async (messageId, part) => ({ deliveredSignature: signature(part) }));
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({
      throttleMs: 0,
      sendPart,
      editPart,
      deleteText,
    });

    streamer.enqueue("s1", "m1", { parts: [plainPart("hello")] });

    await vi.advanceTimersByTimeAsync(1000);

    await vi.waitFor(() => {
      expect(sendPart).toHaveBeenCalledTimes(2);
    });
  });

  it("marks a stream as broken after fatal edit error and cleans up partial messages on complete", async () => {
    vi.useFakeTimers();

    const sendPart = vi.fn(async (part) => ({
      messageId: 42,
      deliveredSignature: signature(part),
    }));
    const editPart = vi
      .fn()
      .mockRejectedValue(new Error("400: Bad Request: message can't be edited"));
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({
      throttleMs: 0,
      sendPart,
      editPart,
      deleteText,
    });

    streamer.enqueue("s1", "m1", { parts: [plainPart("partial")] });
    await vi.waitFor(() => {
      expect(sendPart).toHaveBeenCalledTimes(1);
    });

    streamer.enqueue("s1", "m1", { parts: [plainPart("partial updated")] });
    await vi.waitFor(() => {
      expect(editPart).toHaveBeenCalledTimes(1);
    });

    streamer.enqueue("s1", "m1", { parts: [plainPart("partial updated again")] });
    await vi.advanceTimersByTimeAsync(50);

    expect(editPart).toHaveBeenCalledTimes(1);

    const result = await streamer.complete("s1", "m1", { parts: [plainPart("final")] });

    expect(result.streamed).toBe(false);
    expect(result.telegramMessageIds).toEqual([]);
    expect(deleteText).toHaveBeenCalledTimes(1);
    expect(deleteText).toHaveBeenCalledWith(42);
    expect(sendPart).toHaveBeenCalledTimes(1);
  });

  it("falls back cleanly when fatal send error happens before any partial is visible", async () => {
    vi.useFakeTimers();

    const sendPart = vi
      .fn()
      .mockRejectedValue(new Error("403: Forbidden: bot was blocked by the user"));
    const editPart = vi.fn(async (messageId, part) => ({ deliveredSignature: signature(part) }));
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({
      throttleMs: 0,
      sendPart,
      editPart,
      deleteText,
    });

    streamer.enqueue("s1", "m1", { parts: [plainPart("partial")] });
    await vi.waitFor(() => {
      expect(sendPart).toHaveBeenCalledTimes(1);
    });

    streamer.enqueue("s1", "m1", { parts: [plainPart("partial again")] });
    await vi.advanceTimersByTimeAsync(50);

    expect(sendPart).toHaveBeenCalledTimes(1);

    const result = await streamer.complete("s1", "m1", { parts: [plainPart("final")] });

    expect(result.streamed).toBe(false);
    expect(result.telegramMessageIds).toEqual([]);
    expect(editPart).not.toHaveBeenCalled();
    expect(deleteText).not.toHaveBeenCalled();
  });

  it("waits for an in-flight first streamed send before finalizing short responses", async () => {
    let resolveSend: ((messageId: number) => void) | null = null;
    const sendPart = vi.fn(
      () =>
        new Promise<{ messageId: number; deliveredSignature: string }>((resolve) => {
          resolveSend = (messageId) =>
            resolve({ messageId, deliveredSignature: signature(plainPart("short reply")) });
        }),
    );
    const editPart = vi.fn(async (messageId, part) => ({ deliveredSignature: signature(part) }));
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({
      throttleMs: 0,
      sendPart,
      editPart,
      deleteText,
    });

    streamer.enqueue("s1", "m1", { parts: [plainPart("short reply")] });

    await vi.waitFor(() => {
      expect(sendPart).toHaveBeenCalledTimes(1);
    });

    const completionPromise = streamer.complete("s1", "m1", {
      parts: [plainPart("short reply")],
    });

    expect(editPart).not.toHaveBeenCalled();
    expect(deleteText).not.toHaveBeenCalled();

    resolveSend?.(1);

    const result = await completionPromise;
    expect(result.streamed).toBe(true);
    expect(result.telegramMessageIds).toEqual([1]);
    expect(sendPart).toHaveBeenCalledTimes(1);
    expect(editPart).not.toHaveBeenCalled();
    expect(deleteText).not.toHaveBeenCalled();
  });

  it("keeps visible partial messages when clearing a session and stops tracking the old stream", async () => {
    vi.useFakeTimers();

    let nextMessageId = 100;
    const sendPart = vi.fn(async (part) => ({
      messageId: nextMessageId++,
      deliveredSignature: signature(part),
    }));
    const editPart = vi.fn(async (messageId, part) => ({ deliveredSignature: signature(part) }));
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({
      throttleMs: 0,
      sendPart,
      editPart,
      deleteText,
    });

    streamer.enqueue("s1", "m1", { parts: [plainPart("partial")] });
    await vi.waitFor(() => {
      expect(sendPart).toHaveBeenCalledTimes(1);
    });

    streamer.clearSession("s1", "session_error");

    const completedAfterClear = await streamer.complete("s1", "m1", {
      parts: [plainPart("final")],
    });

    streamer.enqueue("s1", "m1", { parts: [plainPart("new partial")] });
    await vi.waitFor(() => {
      expect(sendPart).toHaveBeenCalledTimes(2);
    });

    expect(completedAfterClear.streamed).toBe(false);
    expect(completedAfterClear.telegramMessageIds).toEqual([]);
    expect(editPart).not.toHaveBeenCalled();
    expect(deleteText).not.toHaveBeenCalled();
    expect(sendPart).toHaveBeenNthCalledWith(2, plainPart("new partial"), undefined);
  });

  it("keeps visible partial messages when clearing all streams", async () => {
    vi.useFakeTimers();

    let nextMessageId = 200;
    const sendPart = vi.fn(async (part) => ({
      messageId: nextMessageId++,
      deliveredSignature: signature(part),
    }));
    const editPart = vi.fn(async (messageId, part) => ({ deliveredSignature: signature(part) }));
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({
      throttleMs: 0,
      sendPart,
      editPart,
      deleteText,
    });

    streamer.enqueue("s1", "m1", { parts: [plainPart("partial")] });
    await vi.waitFor(() => {
      expect(sendPart).toHaveBeenCalledTimes(1);
    });

    streamer.clearAll("summary_aggregator_clear");

    const completedAfterClear = await streamer.complete("s1", "m1", {
      parts: [plainPart("final")],
    });

    expect(completedAfterClear.streamed).toBe(false);
    expect(completedAfterClear.telegramMessageIds).toEqual([]);
    expect(editPart).not.toHaveBeenCalled();
    expect(deleteText).not.toHaveBeenCalled();
    expect(sendPart).toHaveBeenCalledTimes(1);
  });

  it("skips final sync when stream never emitted partial update", async () => {
    vi.useFakeTimers();

    let nextMessageId = 1;
    const sendPart = vi.fn(async (part) => ({
      messageId: nextMessageId++,
      deliveredSignature: signature(part),
    }));
    const editPart = vi.fn(async (messageId, part) => ({ deliveredSignature: signature(part) }));
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({
      throttleMs: 500,
      sendPart,
      editPart,
      deleteText,
    });

    streamer.enqueue("s1", "m1", { parts: [plainPart("partial")] });
    const synced = await streamer.complete("s1", "m1", { parts: [plainPart("final")] });

    await vi.advanceTimersByTimeAsync(1000);

    expect(synced.streamed).toBe(false);
    expect(synced.telegramMessageIds).toEqual([]);
    expect(sendPart).not.toHaveBeenCalled();
    expect(editPart).not.toHaveBeenCalled();
    expect(deleteText).not.toHaveBeenCalled();
  });

  it("keeps stream healthy when a part is locally downgraded to plain", async () => {
    vi.useFakeTimers();

    let nextMessageId = 300;
    const sendPart = vi.fn(async (part) => ({
      messageId: nextMessageId++,
      deliveredSignature: signature({ text: part.fallbackText }),
    }));
    const editPart = vi.fn(async (messageId, part) => ({ deliveredSignature: signature(part) }));
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({
      throttleMs: 0,
      sendPart,
      editPart,
      deleteText,
    });

    const boldHello = richPart("hello", [{ type: "bold", offset: 0, length: 5 }]);
    streamer.enqueue("s1", "m1", { parts: [boldHello] });

    await vi.waitFor(() => {
      expect(sendPart).toHaveBeenCalledTimes(1);
    });

    const result = await streamer.complete("s1", "m1", { parts: [boldHello] });

    expect(result.streamed).toBe(true);
    expect(editPart).toHaveBeenCalledTimes(1);
    expect(editPart).toHaveBeenCalledWith(300, boldHello, undefined);
    expect(deleteText).not.toHaveBeenCalled();
  });

  describe("draft mode (completePart)", () => {
    it("persists draft parts via completePart on complete", async () => {
      vi.useFakeTimers();

      const sendPart = vi.fn(async () => ({
        messageId: 1,
        deliveredSignature: signature(plainPart("partial")),
      }));
      const editPart = vi.fn(async () => ({
        deliveredSignature: signature(plainPart("partial")),
      }));
      const deleteText = vi.fn().mockResolvedValue(undefined);
      const completePart = vi.fn(async (part) => ({
        messageId: 100,
        deliveredSignature: signature(part),
      }));
      const streamer = new ResponseStreamer({
        throttleMs: 0,
        sendPart,
        editPart,
        deleteText,
        completePart,
      });

      streamer.enqueue("s1", "m1", { parts: [plainPart("partial")] });
      await vi.waitFor(() => {
        expect(sendPart).toHaveBeenCalledTimes(1);
      });

      const result = await streamer.complete("s1", "m1", { parts: [plainPart("final")] });

      expect(result.streamed).toBe(true);
      expect(result.telegramMessageIds).toEqual([100]);
      expect(completePart).toHaveBeenCalledTimes(1);
      expect(completePart).toHaveBeenCalledWith(plainPart("final"), undefined);
    });

    it("persists multi-part drafts via completePart", async () => {
      vi.useFakeTimers();

      let draftId = 10;
      const sendPart = vi.fn(async (part) => {
        const id = draftId++;
        return { messageId: id, deliveredSignature: signature(part) };
      });
      const editPart = vi.fn(async () => ({
        deliveredSignature: "sig",
      }));
      const deleteText = vi.fn().mockResolvedValue(undefined);
      let realMessageId = 200;
      const completePart = vi.fn(async (part) => {
        const id = realMessageId++;
        return { messageId: id, deliveredSignature: signature(part) };
      });
      const streamer = new ResponseStreamer({
        throttleMs: 0,
        sendPart,
        editPart,
        deleteText,
        completePart,
      });

      streamer.enqueue("s1", "m1", { parts: [plainPart("part-1"), plainPart("part-2")] });
      await vi.waitFor(() => {
        expect(sendPart).toHaveBeenCalledTimes(2);
      });

      const result = await streamer.complete("s1", "m1", {
        parts: [plainPart("part-1-final"), plainPart("part-2-final")],
      });

      expect(result.streamed).toBe(true);
      expect(result.telegramMessageIds).toEqual([200, 201]);
      expect(completePart).toHaveBeenCalledTimes(2);
      expect(completePart).toHaveBeenNthCalledWith(1, plainPart("part-1-final"), undefined);
      expect(completePart).toHaveBeenNthCalledWith(2, plainPart("part-2-final"), undefined);
    });

    it("can notify only the first final draft part", async () => {
      vi.useFakeTimers();

      let draftId = 10;
      const sendPart = vi.fn(async (part) => {
        const id = draftId++;
        return { messageId: id, deliveredSignature: signature(part) };
      });
      const editPart = vi.fn(async () => ({ deliveredSignature: "sig" }));
      const deleteText = vi.fn().mockResolvedValue(undefined);
      let realMessageId = 200;
      const completePart = vi.fn(async (part) => {
        const id = realMessageId++;
        return { messageId: id, deliveredSignature: signature(part) };
      });
      const streamer = new ResponseStreamer({
        throttleMs: 0,
        sendPart,
        editPart,
        deleteText,
        completePart,
      });

      streamer.enqueue("s1", "m1", {
        parts: [plainPart("part-1"), plainPart("part-2")],
        sendOptions: { disable_notification: true },
      });
      await vi.waitFor(() => {
        expect(sendPart).toHaveBeenCalledTimes(2);
      });

      const result = await streamer.complete(
        "s1",
        "m1",
        {
          parts: [plainPart("part-1-final"), plainPart("part-2-final")],
          sendOptions: { disable_notification: true },
        },
        { notifyFirstCompletePart: true },
      );

      expect(result.streamed).toBe(true);
      expect(completePart).toHaveBeenNthCalledWith(1, plainPart("part-1-final"), {});
      expect(completePart).toHaveBeenNthCalledWith(2, plainPart("part-2-final"), {
        disable_notification: true,
      });
    });

    it("keeps final draft parts silent by default", async () => {
      vi.useFakeTimers();

      const sendPart = vi.fn(async (part) => ({
        messageId: 1,
        deliveredSignature: signature(part),
      }));
      const editPart = vi.fn(async () => ({ deliveredSignature: "sig" }));
      const deleteText = vi.fn().mockResolvedValue(undefined);
      const completePart = vi.fn(async (part) => ({
        messageId: 100,
        deliveredSignature: signature(part),
      }));
      const streamer = new ResponseStreamer({
        throttleMs: 0,
        sendPart,
        editPart,
        deleteText,
        completePart,
      });

      streamer.enqueue("s1", "m1", {
        parts: [plainPart("partial")],
        sendOptions: { disable_notification: true },
      });
      await vi.waitFor(() => {
        expect(sendPart).toHaveBeenCalledTimes(1);
      });

      const result = await streamer.complete("s1", "m1", {
        parts: [plainPart("final")],
        sendOptions: { disable_notification: true },
      });

      expect(result.streamed).toBe(true);
      expect(completePart).toHaveBeenCalledWith(plainPart("final"), {
        disable_notification: true,
      });
    });

    it("returns streamed=false when completePart fails", async () => {
      vi.useFakeTimers();

      const sendPart = vi.fn(async () => ({
        messageId: 1,
        deliveredSignature: signature(plainPart("partial")),
      }));
      const editPart = vi.fn(async () => ({
        deliveredSignature: signature(plainPart("partial")),
      }));
      const deleteText = vi.fn().mockResolvedValue(undefined);
      const completePart = vi.fn().mockRejectedValue(new Error("API error"));
      const streamer = new ResponseStreamer({
        throttleMs: 0,
        sendPart,
        editPart,
        deleteText,
        completePart,
      });

      streamer.enqueue("s1", "m1", { parts: [plainPart("partial")] });
      await vi.waitFor(() => {
        expect(sendPart).toHaveBeenCalledTimes(1);
      });

      const result = await streamer.complete("s1", "m1", { parts: [plainPart("final")] });

      expect(result.streamed).toBe(false);
      expect(completePart).toHaveBeenCalledTimes(1);
    });

    it("calls completePart only for parts with text", async () => {
      vi.useFakeTimers();

      const sendPart = vi.fn(async (part) => ({
        messageId: 1,
        deliveredSignature: signature(part),
      }));
      const editPart = vi.fn(async () => ({ deliveredSignature: "sig" }));
      const deleteText = vi.fn().mockResolvedValue(undefined);
      const completePart = vi.fn(async (part) => ({
        messageId: 50,
        deliveredSignature: signature(part),
      }));
      const streamer = new ResponseStreamer({
        throttleMs: 0,
        sendPart,
        editPart,
        deleteText,
        completePart,
      });

      streamer.enqueue("s1", "m1", { parts: [plainPart("text-only")] });
      await vi.waitFor(() => {
        expect(sendPart).toHaveBeenCalledTimes(1);
      });

      const result = await streamer.complete("s1", "m1", { parts: [plainPart("text-only")] });

      expect(result.streamed).toBe(true);
      expect(completePart).toHaveBeenCalledTimes(1);
    });
  });
});
