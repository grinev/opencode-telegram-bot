import { describe, expect, it, vi } from "vitest";
import { ToolMessageBatcher } from "../../../src/app/formatters/tool-message-batcher.js";

function createFileData(name: string) {
  return {
    filename: name,
    buffer: Buffer.from("content", "utf8"),
    caption: "caption",
  };
}

function createDeferred() {
  let resolve: (() => void) | null = null;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });

  return {
    promise,
    resolve: () => resolve?.(),
  };
}

describe("summary/tool-message-batcher", () => {
  it("sends text message immediately when enqueued", async () => {
    const sendText = vi.fn().mockResolvedValue(undefined);
    const sendFile = vi.fn().mockResolvedValue(undefined);
    const batcher = new ToolMessageBatcher({ sendText, sendFile });

    batcher.enqueue("s1", "tool message");

    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });
    expect(sendText).toHaveBeenCalledWith("s1", "tool message");
    expect(sendFile).not.toHaveBeenCalled();
  });

  it("sends text immediately outside the queue when requested", async () => {
    const sendText = vi.fn().mockResolvedValue(undefined);
    const sendFile = vi.fn().mockResolvedValue(undefined);
    const batcher = new ToolMessageBatcher({ sendText, sendFile });

    batcher.sendTextNow("s1", "thinking", "thinking_started_streaming");

    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });
    expect(sendText).toHaveBeenCalledWith("s1", "thinking");
    expect(sendFile).not.toHaveBeenCalled();
  });

  it("sends file immediately when enqueued", async () => {
    const sendText = vi.fn().mockResolvedValue(undefined);
    const sendFile = vi.fn().mockResolvedValue(undefined);
    const batcher = new ToolMessageBatcher({ sendText, sendFile });

    const fileData = createFileData("edit_a.ts.txt");
    batcher.enqueueFile("s1", fileData);

    await vi.waitFor(() => {
      expect(sendFile).toHaveBeenCalledTimes(1);
    });
    expect(sendFile).toHaveBeenCalledWith("s1", fileData);
    expect(sendText).not.toHaveBeenCalled();
  });

  it("flushSession waits for in-flight sends", async () => {
    const deferred = createDeferred();
    const sendText = vi.fn(() => deferred.promise);
    const sendFile = vi.fn().mockResolvedValue(undefined);
    const batcher = new ToolMessageBatcher({ sendText, sendFile });

    batcher.sendTextNow("s1", "thinking", "thinking_started");

    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    const flushPromise = batcher.flushSession("s1", "assistant_message_completed");
    let flushed = false;
    void flushPromise.then(() => {
      flushed = true;
    });

    await Promise.resolve();
    expect(flushed).toBe(false);

    deferred.resolve();
    await flushPromise;
    expect(flushed).toBe(true);
  });

  it("drops pending sends for a cleared session", async () => {
    const firstDeferred = createDeferred();
    const sendOrder: string[] = [];
    const sendText = vi.fn(async (_sessionId: string, text: string) => {
      sendOrder.push(text);
      if (text === "first") {
        await firstDeferred.promise;
      }
    });
    const sendFile = vi.fn().mockResolvedValue(undefined);
    const batcher = new ToolMessageBatcher({ sendText, sendFile });

    batcher.enqueue("s1", "first");
    batcher.enqueue("s1", "second");

    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    batcher.clearSession("s1", "test_clear");
    firstDeferred.resolve();

    await batcher.flushSession("s1", "after_clear");
    expect(sendOrder).toEqual(["first"]);
  });

  it("preserves order for immediate mixed sends", async () => {
    const sendOrder: string[] = [];
    const sendText = vi.fn(async (_sessionId: string, text: string) => {
      sendOrder.push(`text:${text}`);
    });
    const sendFile = vi.fn(async (_sessionId: string, fileData: { filename: string }) => {
      sendOrder.push(`file:${fileData.filename}`);
    });
    const batcher = new ToolMessageBatcher({ sendText, sendFile });

    batcher.enqueue("s1", "first");
    batcher.enqueueFile("s1", createFileData("edit_d.ts.txt"));
    batcher.enqueue("s1", "second");

    await vi.waitFor(() => {
      expect(sendOrder).toEqual(["text:first", "file:edit_d.ts.txt", "text:second"]);
    });
  });
});
