import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolMessageBatcher } from "../../src/summary/tool-message-batcher.js";

function createFileData(name: string) {
  return {
    filename: name,
    buffer: Buffer.from("content", "utf8"),
    caption: "caption",
  };
}

describe("summary/tool-message-batcher", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends text message immediately when interval is zero", async () => {
    const sendText = vi.fn().mockResolvedValue(undefined);
    const sendFile = vi.fn().mockResolvedValue(undefined);
    const batcher = new ToolMessageBatcher({
      intervalSeconds: 0,
      sendText,
      sendFile,
    });

    batcher.enqueue("s1", "tool message");

    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });
    expect(sendText).toHaveBeenCalledWith("s1", "tool message");
    expect(sendFile).not.toHaveBeenCalled();
  });

  it("sends file immediately when interval is zero", async () => {
    const sendText = vi.fn().mockResolvedValue(undefined);
    const sendFile = vi.fn().mockResolvedValue(undefined);
    const batcher = new ToolMessageBatcher({
      intervalSeconds: 0,
      sendText,
      sendFile,
    });

    const fileData = createFileData("edit_a.ts.txt");
    batcher.enqueueFile("s1", fileData);

    await vi.waitFor(() => {
      expect(sendFile).toHaveBeenCalledTimes(1);
    });
    expect(sendFile).toHaveBeenCalledWith("s1", fileData);
    expect(sendText).not.toHaveBeenCalled();
  });

  it("batches text messages and flushes by interval", async () => {
    vi.useFakeTimers();

    const sendText = vi.fn().mockResolvedValue(undefined);
    const sendFile = vi.fn().mockResolvedValue(undefined);
    const batcher = new ToolMessageBatcher({
      intervalSeconds: 5,
      sendText,
      sendFile,
    });

    batcher.enqueue("s1", "first");
    batcher.enqueue("s1", "second");

    await vi.advanceTimersByTimeAsync(4999);
    expect(sendText).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith("s1", "first\n\nsecond");
    expect(sendFile).not.toHaveBeenCalled();
  });

  it("flushes session queue immediately and cancels timer", async () => {
    vi.useFakeTimers();

    const sendText = vi.fn().mockResolvedValue(undefined);
    const sendFile = vi.fn().mockResolvedValue(undefined);
    const batcher = new ToolMessageBatcher({
      intervalSeconds: 10,
      sendText,
      sendFile,
    });

    batcher.enqueue("s1", "one");
    batcher.enqueue("s1", "two");

    await batcher.flushSession("s1", "test_flush");

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith("s1", "one\n\ntwo");

    await vi.advanceTimersByTimeAsync(20000);
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendFile).not.toHaveBeenCalled();
  });

  it("clears all queues and timers without sending", async () => {
    vi.useFakeTimers();

    const sendText = vi.fn().mockResolvedValue(undefined);
    const sendFile = vi.fn().mockResolvedValue(undefined);
    const batcher = new ToolMessageBatcher({
      intervalSeconds: 5,
      sendText,
      sendFile,
    });

    batcher.enqueue("s1", "one");
    batcher.enqueueFile("s2", createFileData("edit_b.ts.txt"));
    batcher.clearAll("test_clear");

    await vi.advanceTimersByTimeAsync(10000);
    expect(sendText).not.toHaveBeenCalled();
    expect(sendFile).not.toHaveBeenCalled();
  });

  it("splits oversized batch into multiple Telegram-safe text messages", async () => {
    vi.useFakeTimers();

    const sendText = vi.fn().mockResolvedValue(undefined);
    const sendFile = vi.fn().mockResolvedValue(undefined);
    const batcher = new ToolMessageBatcher({
      intervalSeconds: 5,
      sendText,
      sendFile,
    });

    const first = "a".repeat(3000);
    const second = "b".repeat(3000);
    batcher.enqueue("s1", first);
    batcher.enqueue("s1", second);

    await vi.advanceTimersByTimeAsync(5000);

    expect(sendText).toHaveBeenCalledTimes(2);
    for (const call of sendText.mock.calls) {
      expect((call[1] as string).length).toBeLessThanOrEqual(4096);
    }
    expect(sendFile).not.toHaveBeenCalled();
  });

  it("flushes queued messages immediately when interval switches to zero", async () => {
    vi.useFakeTimers();

    const sendText = vi.fn().mockResolvedValue(undefined);
    const sendFile = vi.fn().mockResolvedValue(undefined);
    const batcher = new ToolMessageBatcher({
      intervalSeconds: 5,
      sendText,
      sendFile,
    });

    batcher.enqueue("s1", "first");
    batcher.enqueue("s1", "second");

    batcher.setIntervalSeconds(0);

    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });
    expect(sendText).toHaveBeenCalledWith("s1", "first\n\nsecond");
    expect(sendFile).not.toHaveBeenCalled();
  });

  it("restarts pending timers when interval is changed", async () => {
    vi.useFakeTimers();

    const sendText = vi.fn().mockResolvedValue(undefined);
    const sendFile = vi.fn().mockResolvedValue(undefined);
    const batcher = new ToolMessageBatcher({
      intervalSeconds: 5,
      sendText,
      sendFile,
    });

    batcher.enqueue("s1", "message");

    await vi.advanceTimersByTimeAsync(3000);
    batcher.setIntervalSeconds(10);

    await vi.advanceTimersByTimeAsync(5000);
    expect(sendText).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5000);
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendFile).not.toHaveBeenCalled();
  });

  it("flushes text and files in original queue order", async () => {
    vi.useFakeTimers();

    const sendText = vi.fn().mockResolvedValue(undefined);
    const sendFile = vi.fn().mockResolvedValue(undefined);
    const batcher = new ToolMessageBatcher({
      intervalSeconds: 5,
      sendText,
      sendFile,
    });

    const fileData = createFileData("edit_c.ts.txt");

    batcher.enqueue("s1", "before");
    batcher.enqueueFile("s1", fileData);
    batcher.enqueue("s1", "after");

    await vi.advanceTimersByTimeAsync(5000);

    expect(sendText).toHaveBeenCalledTimes(2);
    expect(sendFile).toHaveBeenCalledTimes(1);

    expect(sendText.mock.invocationCallOrder[0]).toBeLessThan(sendFile.mock.invocationCallOrder[0]);
    expect(sendFile.mock.invocationCallOrder[0]).toBeLessThan(sendText.mock.invocationCallOrder[1]);

    expect(sendText.mock.calls[0]).toEqual(["s1", "before"]);
    expect(sendFile.mock.calls[0]).toEqual(["s1", fileData]);
    expect(sendText.mock.calls[1]).toEqual(["s1", "after"]);
  });

  it("preserves order for immediate mixed sends", async () => {
    const sendOrder: string[] = [];
    const sendText = vi.fn(async (_sessionId: string, text: string) => {
      sendOrder.push(`text:${text}`);
    });
    const sendFile = vi.fn(async (_sessionId: string, fileData: { filename: string }) => {
      sendOrder.push(`file:${fileData.filename}`);
    });
    const batcher = new ToolMessageBatcher({
      intervalSeconds: 0,
      sendText,
      sendFile,
    });

    batcher.enqueue("s1", "first");
    batcher.enqueueFile("s1", createFileData("edit_d.ts.txt"));
    batcher.enqueue("s1", "second");

    await vi.waitFor(() => {
      expect(sendOrder).toEqual(["text:first", "file:edit_d.ts.txt", "text:second"]);
    });
  });
});
