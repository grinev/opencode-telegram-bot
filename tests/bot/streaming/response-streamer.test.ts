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

    const synced = await streamer.complete("s1", "m1", { parts: ["final"], format: "raw" });

    expect(synced).toBe(true);
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

    expect(synced).toBe(false);
    expect(sendText).not.toHaveBeenCalled();
    expect(editText).not.toHaveBeenCalled();
    expect(deleteText).not.toHaveBeenCalled();
  });
});
