import { afterEach, describe, expect, it, vi } from "#vitest";
import { ResponseStreamer } from "../../../src/bot/streaming/response-streamer.js";
import { getTelegramRenderedPartSignature } from "../../../src/bot/render/part-signature.js";
import type { TelegramRenderedPart } from "../../../src/bot/render/types.js";
import { defined } from "../../helpers/defined.js";

function plainPart(text: string): TelegramRenderedPart {
  return {
    blocks: [],
    fallbackText: text,
    source: "plain",
  };
}

function richPart(text: string): TelegramRenderedPart {
  return {
    blocks: [{ type: "paragraph", text: { type: "bold", text } }],
    fallbackText: text,
    source: "blocks",
  };
}

function signature(part: TelegramRenderedPart) {
  return getTelegramRenderedPartSignature(part);
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
    const editPart = vi.fn(async (_messageId, part) => ({ deliveredSignature: signature(part) }));
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
    const editPart = vi.fn(async (_messageId, part) => ({ deliveredSignature: signature(part) }));
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
    const editPart = vi.fn(async (_messageId, part) => ({ deliveredSignature: signature(part) }));
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
    const editPart = vi.fn(async (_messageId, part) => ({ deliveredSignature: signature(part) }));
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
    const editPart = vi.fn(async (_messageId, part) => ({ deliveredSignature: signature(part) }));
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
    const editPart = vi.fn(async (_messageId, part) => ({ deliveredSignature: signature(part) }));
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
    let resolveSend!: (messageId: number) => void;
    const sendPart = vi.fn(
      () =>
        new Promise<{ messageId: number; deliveredSignature: string }>((resolve) => {
          resolveSend = (messageId) =>
            resolve({ messageId, deliveredSignature: signature(plainPart("short reply")) });
        }),
    );
    const editPart = vi.fn(async (_messageId, part) => ({ deliveredSignature: signature(part) }));
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

    resolveSend(1);

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
    const editPart = vi.fn(async (_messageId, part) => ({ deliveredSignature: signature(part) }));
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
    const editPart = vi.fn(async (_messageId, part) => ({ deliveredSignature: signature(part) }));
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
    const editPart = vi.fn(async (_messageId, part) => ({ deliveredSignature: signature(part) }));
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

  describe("plain part entities", () => {
    function quotedPart(text: string, collapsed: boolean): TelegramRenderedPart {
      return {
        blocks: [],
        fallbackText: text,
        source: "plain",
        entities: [
          {
            type: collapsed ? "expandable_blockquote" : "blockquote",
            offset: 0,
            length: text.length,
          },
        ],
      };
    }

    it("carries entities through to the transport and re-edits when only the entity changes", async () => {
      vi.useFakeTimers();

      const sendPart = vi.fn(async (part) => ({
        messageId: 700,
        deliveredSignature: signature(part),
      }));
      const editPart = vi.fn(async (_messageId, part) => ({ deliveredSignature: signature(part) }));
      const deleteText = vi.fn().mockResolvedValue(undefined);
      const streamer = new ResponseStreamer({ throttleMs: 0, sendPart, editPart, deleteText });

      streamer.enqueue("s1", "m1", { parts: [quotedPart("reasoning", false)] });
      await vi.waitFor(() => {
        expect(sendPart).toHaveBeenCalledTimes(1);
      });

      expect(defined(sendPart.mock.calls[0]?.[0])).toEqual(quotedPart("reasoning", false));

      // The text is identical; only the quote collapses. Without the entity in
      // the signature this would be skipped as unchanged.
      await streamer.complete("s1", "m1", { parts: [quotedPart("reasoning", true)] });

      expect(editPart).toHaveBeenCalledTimes(1);
      expect(editPart).toHaveBeenCalledWith(700, quotedPart("reasoning", true), undefined);
    });
  });

  describe("sticky plain fallback", () => {
    it("keeps editing as plain text after the transport reported a degradation", async () => {
      vi.useFakeTimers();

      const sendPart = vi.fn(async (part) => ({
        messageId: 300,
        deliveredSignature: signature(plainPart(part.fallbackText)),
        degradedToPlain: true,
      }));
      const editPart = vi.fn(async (_messageId, part) => ({ deliveredSignature: signature(part) }));
      const deleteText = vi.fn().mockResolvedValue(undefined);
      const streamer = new ResponseStreamer({
        throttleMs: 0,
        sendPart,
        editPart,
        deleteText,
      });

      streamer.enqueue("s1", "m1", { parts: [richPart("hello")] });
      await vi.waitFor(() => {
        expect(sendPart).toHaveBeenCalledTimes(1);
      });

      const result = await streamer.complete("s1", "m1", { parts: [richPart("hello there")] });

      expect(result.streamed).toBe(true);
      expect(editPart).toHaveBeenCalledTimes(1);
      expect(editPart).toHaveBeenCalledWith(300, plainPart("hello there"), undefined);
      expect(deleteText).not.toHaveBeenCalled();
    });

    it("retries as plain text instead of breaking the stream on the first native failure", async () => {
      vi.useFakeTimers();

      const sendPart = vi.fn(async (part) => ({
        messageId: 400,
        deliveredSignature: signature(part),
      }));
      const editPart = vi
        .fn()
        .mockRejectedValueOnce(new Error("Bad Request: RICH_BLOCK_INVALID"))
        .mockImplementation(async (_messageId, part) => ({ deliveredSignature: signature(part) }));
      const deleteText = vi.fn().mockResolvedValue(undefined);
      const streamer = new ResponseStreamer({
        throttleMs: 0,
        sendPart,
        editPart,
        deleteText,
      });

      streamer.enqueue("s1", "m1", { parts: [richPart("hello")] });
      await vi.waitFor(() => {
        expect(sendPart).toHaveBeenCalledTimes(1);
      });

      const result = await streamer.complete("s1", "m1", { parts: [richPart("hello there")] });

      expect(result.streamed).toBe(true);
      expect(editPart).toHaveBeenCalledTimes(2);
      expect(editPart).toHaveBeenNthCalledWith(2, 400, plainPart("hello there"), undefined);
      expect(deleteText).not.toHaveBeenCalled();
    });

    it("re-chunks a long reply so plain parts fit a text message", async () => {
      vi.useFakeTimers();

      let nextMessageId = 500;
      const sendPart = vi.fn(async (part) => ({
        messageId: nextMessageId++,
        deliveredSignature: signature(part),
      }));
      const editPart = vi
        .fn()
        .mockRejectedValueOnce(new Error("Bad Request: RICH_BLOCK_INVALID"))
        .mockImplementation(async (_messageId, part) => ({ deliveredSignature: signature(part) }));
      const deleteText = vi.fn().mockResolvedValue(undefined);
      const streamer = new ResponseStreamer({
        throttleMs: 0,
        sendPart,
        editPart,
        deleteText,
      });

      const longText = "x".repeat(9000);
      streamer.enqueue("s1", "m1", { parts: [richPart("short")] });
      await vi.waitFor(() => {
        expect(sendPart).toHaveBeenCalledTimes(1);
      });

      const result = await streamer.complete("s1", "m1", { parts: [richPart(longText)] });

      expect(result.streamed).toBe(true);
      // One message was already on screen; the plain rebuild needs three.
      expect(result.telegramMessageIds).toHaveLength(3);
      expect(sendPart).toHaveBeenCalledTimes(3);

      const plainEdits = editPart.mock.calls.filter(([, part]) => part.source === "plain");
      expect(plainEdits.length).toBeGreaterThan(0);
      for (const [, part] of plainEdits) {
        expect(part.fallbackText.length).toBeLessThanOrEqual(4096);
      }
      for (const [part] of sendPart.mock.calls) {
        expect(part.fallbackText.length).toBeLessThanOrEqual(4096);
      }
    });

    it("breaks the stream when the plain retry fails as well", async () => {
      vi.useFakeTimers();

      const sendPart = vi.fn(async (part) => ({
        messageId: 600,
        deliveredSignature: signature(part),
      }));
      const editPart = vi.fn().mockRejectedValue(new Error("Bad Request: message can't be edited"));
      const deleteText = vi.fn().mockResolvedValue(undefined);
      const streamer = new ResponseStreamer({
        throttleMs: 0,
        sendPart,
        editPart,
        deleteText,
      });

      streamer.enqueue("s1", "m1", { parts: [richPart("hello")] });
      await vi.waitFor(() => {
        expect(sendPart).toHaveBeenCalledTimes(1);
      });

      streamer.enqueue("s1", "m1", { parts: [richPart("hello there")] });
      await vi.waitFor(() => {
        expect(editPart).toHaveBeenCalledTimes(2);
      });

      const result = await streamer.complete("s1", "m1", { parts: [richPart("hello there")] });

      expect(result.streamed).toBe(false);
      expect(deleteText).toHaveBeenCalledWith(600);
    });

    it("still skips unchanged payloads after switching to plain text", async () => {
      vi.useFakeTimers();

      const sendPart = vi.fn(async (part) => ({
        messageId: 700,
        deliveredSignature: signature(part),
      }));
      const editPart = vi
        .fn()
        .mockRejectedValueOnce(new Error("Bad Request: RICH_BLOCK_INVALID"))
        .mockImplementation(async (_messageId, part) => ({ deliveredSignature: signature(part) }));
      const deleteText = vi.fn().mockResolvedValue(undefined);
      const streamer = new ResponseStreamer({
        throttleMs: 0,
        sendPart,
        editPart,
        deleteText,
      });

      streamer.enqueue("s1", "m1", { parts: [richPart("hello")] });
      await vi.waitFor(() => {
        expect(sendPart).toHaveBeenCalledTimes(1);
      });

      streamer.enqueue("s1", "m1", { parts: [richPart("hello there")] });
      await vi.waitFor(() => {
        expect(editPart).toHaveBeenCalledTimes(2);
      });

      streamer.enqueue("s1", "m1", { parts: [richPart("hello there")] });
      await vi.advanceTimersByTimeAsync(10);

      expect(editPart).toHaveBeenCalledTimes(2);
    });
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

  it("reads throttleMs again for the next flush cycle", async () => {
    vi.useFakeTimers();

    let throttleMs = 200;
    let nextMessageId = 1;
    const sendPart = vi.fn(async (part) => ({
      messageId: nextMessageId++,
      deliveredSignature: signature(part),
    }));
    const editPart = vi.fn(async (_messageId, part) => ({ deliveredSignature: signature(part) }));
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({
      throttleMs: () => throttleMs,
      sendPart,
      editPart,
      deleteText,
    });

    streamer.enqueue("s1", "m1", { parts: [plainPart("first")] });
    await vi.advanceTimersByTimeAsync(200);
    expect(sendPart).toHaveBeenCalledTimes(1);

    throttleMs = 2000;
    streamer.enqueue("s1", "m1", { parts: [plainPart("second")] });
    await vi.advanceTimersByTimeAsync(1999);
    expect(editPart).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(editPart).toHaveBeenCalledTimes(1);
    expect(editPart).toHaveBeenCalledWith(1, plainPart("second"), undefined);
  });
});
