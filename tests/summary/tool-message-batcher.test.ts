import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolMessageBatcher } from "../../src/summary/tool-message-batcher.js";

describe("summary/tool-message-batcher", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends tool message immediately when interval is zero", async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const batcher = new ToolMessageBatcher({
      intervalSeconds: 0,
      sendMessage,
    });

    batcher.enqueue("s1", "tool message");

    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(1);
    });
    expect(sendMessage).toHaveBeenCalledWith("s1", "tool message");
  });

  it("batches messages and flushes by interval", async () => {
    vi.useFakeTimers();

    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const batcher = new ToolMessageBatcher({
      intervalSeconds: 5,
      sendMessage,
    });

    batcher.enqueue("s1", "first");
    batcher.enqueue("s1", "second");

    await vi.advanceTimersByTimeAsync(4999);
    expect(sendMessage).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith("s1", "first\n\nsecond");
  });

  it("flushes session queue immediately and cancels timer", async () => {
    vi.useFakeTimers();

    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const batcher = new ToolMessageBatcher({
      intervalSeconds: 10,
      sendMessage,
    });

    batcher.enqueue("s1", "one");
    batcher.enqueue("s1", "two");

    await batcher.flushSession("s1", "test_flush");

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith("s1", "one\n\ntwo");

    await vi.advanceTimersByTimeAsync(20000);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("clears all queues and timers without sending", async () => {
    vi.useFakeTimers();

    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const batcher = new ToolMessageBatcher({
      intervalSeconds: 5,
      sendMessage,
    });

    batcher.enqueue("s1", "one");
    batcher.enqueue("s2", "two");
    batcher.clearAll("test_clear");

    await vi.advanceTimersByTimeAsync(10000);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("splits oversized batch into multiple Telegram-safe messages", async () => {
    vi.useFakeTimers();

    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const batcher = new ToolMessageBatcher({
      intervalSeconds: 5,
      sendMessage,
    });

    const first = "a".repeat(3000);
    const second = "b".repeat(3000);
    batcher.enqueue("s1", first);
    batcher.enqueue("s1", second);

    await vi.advanceTimersByTimeAsync(5000);

    expect(sendMessage).toHaveBeenCalledTimes(2);
    for (const call of sendMessage.mock.calls) {
      expect((call[1] as string).length).toBeLessThanOrEqual(4096);
    }
  });

  it("flushes queued messages immediately when interval switches to zero", async () => {
    vi.useFakeTimers();

    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const batcher = new ToolMessageBatcher({
      intervalSeconds: 5,
      sendMessage,
    });

    batcher.enqueue("s1", "first");
    batcher.enqueue("s1", "second");

    batcher.setIntervalSeconds(0);

    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(1);
    });
    expect(sendMessage).toHaveBeenCalledWith("s1", "first\n\nsecond");
  });

  it("restarts pending timers when interval is changed", async () => {
    vi.useFakeTimers();

    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const batcher = new ToolMessageBatcher({
      intervalSeconds: 5,
      sendMessage,
    });

    batcher.enqueue("s1", "message");

    await vi.advanceTimersByTimeAsync(3000);
    batcher.setIntervalSeconds(10);

    await vi.advanceTimersByTimeAsync(5000);
    expect(sendMessage).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5000);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});
