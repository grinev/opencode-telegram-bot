import { afterEach, describe, expect, it, vi } from "vitest";
import { ResponseStreamer } from "../../../src/bot/streaming/response-streamer.js";

describe("bot/streaming/response-streamer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("throttles updates and sends only the latest payload", async () => {
    vi.useFakeTimers();

    let nextMessageId = 1;
    const sendText = vi.fn(async () => nextMessageId++);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({
      throttleMs: 500,
      sendText,
      editText,
      deleteText,
    });

    streamer.enqueue("s1", "m1", { parts: ["first"], format: "raw" });
    streamer.enqueue("s1", "m1", { parts: ["second"], format: "raw" });

    await vi.advanceTimersByTimeAsync(500);

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith("second", "raw", undefined);
    expect(editText).not.toHaveBeenCalled();
    expect(deleteText).not.toHaveBeenCalled();
  });

  it("streams into a second Telegram message when parts grow", async () => {
    vi.useFakeTimers();

    let nextMessageId = 101;
    const sendText = vi.fn(async () => nextMessageId++);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.enqueue("s1", "m1", { parts: ["part-1"], format: "markdown_v2" });
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    streamer.enqueue("s1", "m1", {
      parts: ["part-1", "part-2"],
      format: "markdown_v2",
    });

    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(2);
    });

    expect(sendText).toHaveBeenNthCalledWith(1, "part-1", "markdown_v2", undefined);
    expect(sendText).toHaveBeenNthCalledWith(2, "part-2", "markdown_v2", undefined);
    expect(editText).not.toHaveBeenCalled();
    expect(deleteText).not.toHaveBeenCalled();
  });

  it("flushes final payload on complete after streaming started", async () => {
    vi.useFakeTimers();

    let nextMessageId = 1;
    const sendText = vi.fn(async () => nextMessageId++);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({
      throttleMs: 500,
      sendText,
      editText,
      deleteText,
    });

    streamer.enqueue("s1", "m1", { parts: ["partial"], format: "raw" });
    await vi.advanceTimersByTimeAsync(500);

    const result = await streamer.complete("s1", "m1", { parts: ["final"], format: "raw" });

    expect(result.streamed).toBe(true);
    expect(result.telegramMessageIds).toEqual([1]);
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(editText).toHaveBeenCalledTimes(1);
    expect(editText).toHaveBeenCalledWith(1, "final", "raw", undefined);
    expect(deleteText).not.toHaveBeenCalled();
  });

  it("removes extra Telegram messages when payload shrinks", async () => {
    vi.useFakeTimers();

    let nextMessageId = 10;
    const sendText = vi.fn(async () => nextMessageId++);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.enqueue("s1", "m1", { parts: ["one", "two"], format: "raw" });
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(2);
    });

    streamer.enqueue("s1", "m1", { parts: ["one"], format: "raw" });
    await vi.waitFor(() => {
      expect(deleteText).toHaveBeenCalledTimes(1);
    });

    expect(deleteText).toHaveBeenCalledWith(11);
  });

  it("retries after Telegram rate limits", async () => {
    vi.useFakeTimers();

    const sendText = vi
      .fn()
      .mockRejectedValueOnce(new Error("429: retry after 1"))
      .mockResolvedValueOnce(1);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.enqueue("s1", "m1", { parts: ["hello"], format: "raw" });

    await vi.advanceTimersByTimeAsync(1000);

    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(2);
    });
  });

  it("marks a stream as broken after fatal edit error and cleans up partial messages on complete", async () => {
    vi.useFakeTimers();

    const sendText = vi.fn().mockResolvedValue(42);
    const editText = vi
      .fn()
      .mockRejectedValue(new Error("400: Bad Request: message can't be edited"));
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.enqueue("s1", "m1", { parts: ["partial"], format: "raw" });
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    streamer.enqueue("s1", "m1", { parts: ["partial updated"], format: "raw" });
    await vi.waitFor(() => {
      expect(editText).toHaveBeenCalledTimes(1);
    });

    streamer.enqueue("s1", "m1", { parts: ["partial updated again"], format: "raw" });
    await vi.advanceTimersByTimeAsync(50);

    expect(editText).toHaveBeenCalledTimes(1);

    const result = await streamer.complete("s1", "m1", { parts: ["final"], format: "raw" });

    expect(result.streamed).toBe(false);
    expect(result.telegramMessageIds).toEqual([]);
    expect(deleteText).toHaveBeenCalledTimes(1);
    expect(deleteText).toHaveBeenCalledWith(42);
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  it("falls back cleanly when fatal send error happens before any partial is visible", async () => {
    vi.useFakeTimers();

    const sendText = vi
      .fn()
      .mockRejectedValue(new Error("403: Forbidden: bot was blocked by the user"));
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.enqueue("s1", "m1", { parts: ["partial"], format: "raw" });
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    streamer.enqueue("s1", "m1", { parts: ["partial again"], format: "raw" });
    await vi.advanceTimersByTimeAsync(50);

    expect(sendText).toHaveBeenCalledTimes(1);

    const result = await streamer.complete("s1", "m1", { parts: ["final"], format: "raw" });

    expect(result.streamed).toBe(false);
    expect(result.telegramMessageIds).toEqual([]);
    expect(editText).not.toHaveBeenCalled();
    expect(deleteText).not.toHaveBeenCalled();
  });

  it("waits for an in-flight first streamed send before finalizing short responses", async () => {
    let resolveSend: ((messageId: number) => void) | null = null;
    const sendText = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          resolveSend = resolve;
        }),
    );
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.enqueue("s1", "m1", { parts: ["short reply"], format: "raw" });

    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    const completionPromise = streamer.complete("s1", "m1", {
      parts: ["short reply"],
      format: "raw",
    });

    expect(editText).not.toHaveBeenCalled();
    expect(deleteText).not.toHaveBeenCalled();

    resolveSend?.(1);

    const result = await completionPromise;
    expect(result.streamed).toBe(true);
    expect(result.telegramMessageIds).toEqual([1]);
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(editText).not.toHaveBeenCalled();
    expect(deleteText).not.toHaveBeenCalled();
  });

  it("keeps visible partial messages when clearing a session and stops tracking the old stream", async () => {
    vi.useFakeTimers();

    let nextMessageId = 100;
    const sendText = vi.fn(async () => nextMessageId++);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.enqueue("s1", "m1", { parts: ["partial"], format: "raw" });
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    streamer.clearSession("s1", "session_error");

    const completedAfterClear = await streamer.complete("s1", "m1", {
      parts: ["final"],
      format: "raw",
    });

    streamer.enqueue("s1", "m1", { parts: ["new partial"], format: "raw" });
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(2);
    });

    expect(completedAfterClear.streamed).toBe(false);
    expect(completedAfterClear.telegramMessageIds).toEqual([]);
    expect(editText).not.toHaveBeenCalled();
    expect(deleteText).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenNthCalledWith(2, "new partial", "raw", undefined);
  });

  it("keeps visible partial messages when clearing all streams", async () => {
    vi.useFakeTimers();

    let nextMessageId = 200;
    const sendText = vi.fn(async () => nextMessageId++);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.enqueue("s1", "m1", { parts: ["partial"], format: "raw" });
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    streamer.clearAll("summary_aggregator_clear");

    const completedAfterClear = await streamer.complete("s1", "m1", {
      parts: ["final"],
      format: "raw",
    });

    expect(completedAfterClear.streamed).toBe(false);
    expect(completedAfterClear.telegramMessageIds).toEqual([]);
    expect(editText).not.toHaveBeenCalled();
    expect(deleteText).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  it("skips final sync when stream never emitted partial update", async () => {
    vi.useFakeTimers();

    let nextMessageId = 1;
    const sendText = vi.fn(async () => nextMessageId++);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({
      throttleMs: 500,
      sendText,
      editText,
      deleteText,
    });

    streamer.enqueue("s1", "m1", { parts: ["partial"], format: "raw" });
    const synced = await streamer.complete("s1", "m1", { parts: ["final"], format: "raw" });

    await vi.advanceTimersByTimeAsync(1000);

    expect(synced.streamed).toBe(false);
    expect(synced.telegramMessageIds).toEqual([]);
    expect(sendText).not.toHaveBeenCalled();
    expect(editText).not.toHaveBeenCalled();
    expect(deleteText).not.toHaveBeenCalled();
  });
});
