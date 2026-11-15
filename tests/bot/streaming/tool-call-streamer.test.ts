import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolCallStreamer } from "../../../src/bot/streaming/tool-call-streamer.js";
import { defined } from "../../helpers/defined.js";

describe("bot/streaming/tool-call-streamer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("throttles tool updates and sends the combined latest text", async () => {
    vi.useFakeTimers();

    let nextMessageId = 1;
    const sendText = vi.fn(async () => nextMessageId++);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ToolCallStreamer({
      throttleMs: 200,
      sendText,
      editText,
      deleteText,
    });

    streamer.append("s1", "first");
    streamer.append("s1", "second");

    await vi.advanceTimersByTimeAsync(200);

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith("s1", "first\n\nsecond");
    expect(editText).not.toHaveBeenCalled();
    expect(deleteText).not.toHaveBeenCalled();
  });

  it("edits the existing streamed message when new tool lines arrive", async () => {
    vi.useFakeTimers();

    const sendText = vi.fn().mockResolvedValue(10);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ToolCallStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.append("s1", "first");
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    streamer.append("s1", "second");
    await vi.waitFor(() => {
      expect(editText).toHaveBeenCalledTimes(1);
    });

    expect(editText).toHaveBeenCalledWith("s1", 10, "first\n\nsecond");
  });

  it("sends a standalone message of its own and edits it by id", async () => {
    vi.useFakeTimers();

    const sendText = vi.fn().mockResolvedValueOnce(10);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ToolCallStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    const messageId = await streamer.sendStandalone("s1", "  snapshot  ");

    expect(messageId).toBe(10);
    expect(sendText).toHaveBeenCalledWith("s1", "snapshot");
    await streamer.editStandalone("s1", 10, "snapshot updated");
    expect(editText).toHaveBeenCalledWith("s1", 10, "snapshot updated");
  });

  it("lets the tool lines already pending out before a standalone message", async () => {
    vi.useFakeTimers();

    const sendText = vi.fn().mockResolvedValueOnce(10).mockResolvedValueOnce(11);
    const streamer = new ToolCallStreamer({
      throttleMs: 200,
      sendText,
      editText: vi.fn().mockResolvedValue(undefined),
      deleteText: vi.fn().mockResolvedValue(undefined),
    });

    streamer.append("s1", "earlier tool line");
    const sending = streamer.sendStandalone("s1", "snapshot");

    await vi.advanceTimersByTimeAsync(0);
    expect(sendText).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    await sending;

    expect(sendText).toHaveBeenNthCalledWith(1, "s1", "earlier tool line");
    expect(sendText).toHaveBeenNthCalledWith(2, "s1", "snapshot");
  });

  it("waits for the reply gate before a standalone message", async () => {
    vi.useFakeTimers();

    let openGate: () => void = () => {};
    const sendText = vi.fn().mockResolvedValue(10);
    const streamer = new ToolCallStreamer({
      throttleMs: 0,
      sendText,
      editText: vi.fn().mockResolvedValue(undefined),
      deleteText: vi.fn().mockResolvedValue(undefined),
      takeGate: () => () =>
        new Promise<void>((resolve) => {
          openGate = resolve;
        }),
    });

    const sending = streamer.sendStandalone("s1", "snapshot");
    await vi.advanceTimersByTimeAsync(50);
    expect(sendText).not.toHaveBeenCalled();

    openGate();
    await sending;
    expect(sendText).toHaveBeenCalledWith("s1", "snapshot");
  });

  it("sends no standalone message cancelled while it waited", async () => {
    vi.useFakeTimers();

    let openGate: () => void = () => {};
    const sendText = vi.fn().mockResolvedValue(10);
    const streamer = new ToolCallStreamer({
      throttleMs: 0,
      sendText,
      editText: vi.fn().mockResolvedValue(undefined),
      deleteText: vi.fn().mockResolvedValue(undefined),
      takeGate: () => () =>
        new Promise<void>((resolve) => {
          openGate = resolve;
        }),
    });

    let wanted = true;
    const sending = streamer.sendStandalone("s1", "snapshot", () => wanted);
    await vi.advanceTimersByTimeAsync(50);
    wanted = false;
    openGate();

    await expect(sending).resolves.toBeNull();
    expect(sendText).not.toHaveBeenCalled();
  });

  it("sends no standalone message cancelled while the queue waited", async () => {
    vi.useFakeTimers();

    const sendText = vi.fn().mockResolvedValue(10);
    const streamer = new ToolCallStreamer({
      throttleMs: 500,
      sendText,
      editText: vi.fn().mockResolvedValue(undefined),
      deleteText: vi.fn().mockResolvedValue(undefined),
    });

    await streamer.sendStandalone("s1", "first");

    let wanted = true;
    const second = streamer.sendStandalone("s1", "second", () => wanted);
    await vi.advanceTimersByTimeAsync(10);
    wanted = false;
    await vi.advanceTimersByTimeAsync(1000);

    await expect(second).resolves.toBeNull();
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith("s1", "first");
  });

  it("keeps each subagent in an independently editable stream", async () => {
    vi.useFakeTimers();

    const sendText = vi
      .fn()
      .mockResolvedValueOnce(20)
      .mockResolvedValueOnce(21)
      .mockResolvedValueOnce(22);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ToolCallStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.append("s1", "regular tool");
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    streamer.replaceByPrefix("s1", "subagent", "first subagent card", "subagent:card-1");
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(2);
    });

    streamer.replaceByPrefix("s1", "subagent", "second subagent card", "subagent:card-2");
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(3);
    });

    streamer.replaceByPrefix(
      "s1",
      "subagent",
      "first subagent card updated",
      "subagent:card-1",
    );
    await vi.waitFor(() => {
      expect(editText).toHaveBeenCalledTimes(1);
    });

    expect(sendText).toHaveBeenNthCalledWith(1, "s1", "regular tool");
    expect(sendText).toHaveBeenNthCalledWith(2, "s1", "first subagent card");
    expect(sendText).toHaveBeenNthCalledWith(3, "s1", "second subagent card");
    expect(editText).toHaveBeenCalledWith("s1", 21, "first subagent card updated");
  });

  it("paces Telegram operations from independently ready subagent streams", async () => {
    vi.useFakeTimers();

    const operationTimes: number[] = [];
    let nextMessageId = 30;
    const sendText = vi.fn(async () => {
      operationTimes.push(Date.now());
      return nextMessageId++;
    });
    const streamer = new ToolCallStreamer({
      throttleMs: 100,
      sendText,
      editText: vi.fn().mockResolvedValue(undefined),
      deleteText: vi.fn().mockResolvedValue(undefined),
    });

    streamer.replaceByPrefix("s1", "subagent", "first card", "subagent:card-1");
    streamer.replaceByPrefix("s1", "subagent", "second card", "subagent:card-2");

    await vi.advanceTimersByTimeAsync(100);
    expect(sendText).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(99);
    expect(sendText).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(sendText).toHaveBeenCalledTimes(2);
    expect(defined(operationTimes[1]) - defined(operationTimes[0])).toBeGreaterThanOrEqual(100);
  });

  it("cancels queued subagent operations when all streams are cleared", async () => {
    vi.useFakeTimers();

    let nextMessageId = 40;
    const sendText = vi.fn(async () => nextMessageId++);
    const streamer = new ToolCallStreamer({
      throttleMs: 100,
      sendText,
      editText: vi.fn().mockResolvedValue(undefined),
      deleteText: vi.fn().mockResolvedValue(undefined),
    });

    streamer.replaceByPrefix("s1", "subagent", "first card", "subagent:card-1");
    streamer.replaceByPrefix("s1", "subagent", "stale card", "subagent:card-2");

    await vi.advanceTimersByTimeAsync(100);
    expect(sendText).toHaveBeenCalledTimes(1);

    streamer.clearAll("detach");
    await vi.advanceTimersByTimeAsync(100);
    expect(sendText).toHaveBeenCalledTimes(1);

    streamer.replaceByPrefix("s1", "subagent", "new card", "subagent:card-3");
    await vi.advanceTimersByTimeAsync(200);
    expect(sendText).toHaveBeenCalledTimes(2);
    expect(sendText).toHaveBeenLastCalledWith("s1", "new card");
  });

  it("creates continuation messages when the stream exceeds Telegram limits", async () => {
    vi.useFakeTimers();

    let nextMessageId = 100;
    const sendText = vi.fn(async () => nextMessageId++);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ToolCallStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.append("s1", "a".repeat(3000));
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    streamer.append("s1", "b".repeat(3000));
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(2);
    });

    expect(editText).toHaveBeenCalledTimes(1);
    for (const call of sendText.mock.calls) {
      const [, text] = call as unknown as [string, string];
      expect(text.length).toBeLessThanOrEqual(4000);
    }
  });

  it("replaces retry text by prefix inside the active stream", async () => {
    vi.useFakeTimers();

    const sendText = vi.fn().mockResolvedValue(1);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ToolCallStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.append("s1", "tool one");
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    streamer.replaceByPrefix("s1", "🔁", "🔁 Retry attempt 1");
    await vi.waitFor(() => {
      expect(editText).toHaveBeenCalledTimes(1);
    });

    streamer.replaceByPrefix("s1", "🔁", "🔁 Retry attempt 2");
    await vi.waitFor(() => {
      expect(editText).toHaveBeenCalledTimes(2);
    });

    expect(editText).toHaveBeenLastCalledWith("s1", 1, "tool one\n\n🔁 Retry attempt 2");
  });

  it("removes an entry by prefix and keeps the remaining ones", async () => {
    vi.useFakeTimers();

    const sendText = vi.fn().mockResolvedValue(1);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ToolCallStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.append("s1", "tool one");
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    streamer.replaceByPrefix("s1", "⏳call-1", "⏳ 💻 bash npm test — 20 sec");
    await vi.waitFor(() => {
      expect(editText).toHaveBeenCalledTimes(1);
    });

    streamer.removeByPrefix("s1", "⏳call-1");
    await vi.waitFor(() => {
      expect(editText).toHaveBeenCalledTimes(2);
    });

    expect(editText).toHaveBeenLastCalledWith("s1", 1, "tool one");
    expect(deleteText).not.toHaveBeenCalled();
  });

  it("keeps a finished tool in its original slot while another runs", async () => {
    vi.useFakeTimers();
    const sendText = vi.fn().mockResolvedValue(1);
    const editText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ToolCallStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText: vi.fn().mockResolvedValue(undefined),
    });

    streamer.replaceByPrefix("s1", "⏳one", "⏳ first");
    await vi.waitFor(() => expect(sendText).toHaveBeenCalledTimes(1));
    streamer.replaceByPrefix("s1", "⏳two", "⏳ second");
    await vi.waitFor(() => expect(editText).toHaveBeenCalled());

    streamer.replaceByPrefix("s1", "⏳two", "second finished");
    await vi.waitFor(() => expect(editText).toHaveBeenLastCalledWith("s1", 1, "⏳ first\n\nsecond finished"));
    streamer.replaceByPrefix("s1", "⏳one", "first finished");
    await vi.waitFor(() => expect(editText).toHaveBeenLastCalledWith("s1", 1, "first finished\n\nsecond finished"));
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  it("only sends a final line if the call finishes before the first flush", async () => {
    vi.useFakeTimers();
    const sendText = vi.fn().mockResolvedValue(1);
    const streamer = new ToolCallStreamer({
      throttleMs: 200,
      sendText,
      editText: vi.fn().mockResolvedValue(undefined),
      deleteText: vi.fn().mockResolvedValue(undefined),
    });
    streamer.replaceByPrefix("s1", "⏳one", "⏳ running");
    streamer.replaceByPrefix("s1", "⏳one", "finished");

    await vi.advanceTimersByTimeAsync(200);
    expect(sendText).toHaveBeenCalledExactlyOnceWith("s1", "finished");
  });

  it("deletes an attachment-only line and holds new calls below the document", async () => {
    vi.useFakeTimers();
    let id = 1;
    const sendText = vi.fn(async () => id++);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ToolCallStreamer({
      throttleMs: 0,
      sendText,
      editText: vi.fn().mockResolvedValue(undefined),
      deleteText,
    });
    streamer.replaceByPrefix("s1", "⏳file", "⏳ writing");
    await vi.waitFor(() => expect(sendText).toHaveBeenCalledTimes(1));

    streamer.removeByPrefix("s1", "⏳file", "default", true);
    streamer.beginDocumentBoundary("s1");
    streamer.replaceByPrefix("s1", "⏳next", "⏳ next call");
    const flush = streamer.flushSession("s1", "document");
    await flush;
    expect(deleteText).toHaveBeenCalledWith("s1", 1);
    expect(sendText).toHaveBeenCalledTimes(1);

    streamer.endDocumentBoundary("s1");
    await vi.waitFor(() => expect(sendText).toHaveBeenCalledTimes(2));
    expect(sendText).toHaveBeenNthCalledWith(2, "s1", "⏳ next call");
  });

  it("keeps new calls held until both overlapping documents are delivered", async () => {
    vi.useFakeTimers();
    const sendText = vi.fn().mockResolvedValue(1);
    const streamer = new ToolCallStreamer({
      throttleMs: 0,
      sendText,
      editText: vi.fn().mockResolvedValue(undefined),
      deleteText: vi.fn().mockResolvedValue(undefined),
    });

    streamer.beginDocumentBoundary("s1");
    streamer.beginDocumentBoundary("s1");
    streamer.replaceByPrefix("s1", "⏳later", "⏳ later call");
    streamer.endDocumentBoundary("s1");
    await vi.advanceTimersByTimeAsync(500);
    expect(sendText).not.toHaveBeenCalled();

    streamer.endDocumentBoundary("s1");
    await vi.waitFor(() => expect(sendText).toHaveBeenCalledExactlyOnceWith("s1", "⏳ later call"));
  });

  it("does not flush a held line through a thinking stream break before the document arrives", async () => {
    vi.useFakeTimers();
    const sendText = vi.fn().mockResolvedValue(1);
    const streamer = new ToolCallStreamer({
      throttleMs: 0,
      sendText,
      editText: vi.fn().mockResolvedValue(undefined),
      deleteText: vi.fn().mockResolvedValue(undefined),
    });

    streamer.beginDocumentBoundary("s1");
    streamer.replaceByPrefix("s1", "⏳later", "⏳ later call");
    const breaking = streamer.breakSession("s1", "thinking_started");
    await vi.advanceTimersByTimeAsync(500);
    expect(sendText).not.toHaveBeenCalled();

    streamer.endDocumentBoundary("s1");
    await breaking;
    expect(sendText).toHaveBeenCalledExactlyOnceWith("s1", "⏳ later call");
  });

  it("leaves a frozen aborted call alone when its completion arrives after the error boundary", async () => {
    vi.useFakeTimers();
    let id = 1;
    const sendText = vi.fn(async () => id++);
    const streamer = new ToolCallStreamer({
      throttleMs: 0,
      sendText,
      editText: vi.fn().mockResolvedValue(undefined),
      deleteText: vi.fn().mockResolvedValue(undefined),
    });

    streamer.replaceByPrefix("s1", "⏳aborted", "⏳ 💻 bash sleep 90");
    await vi.waitFor(() => expect(sendText).toHaveBeenCalledTimes(1));
    await streamer.breakSession("s1", "session_error");
    streamer.replaceByPrefix("s1", "⏳aborted", "💻 bash sleep 90");
    await vi.advanceTimersByTimeAsync(500);
    expect(sendText).toHaveBeenCalledTimes(1);

    streamer.replaceByPrefix("s1", "⏳next", "💻 bash next");
    await vi.waitFor(() => expect(sendText).toHaveBeenCalledTimes(2));
    expect(sendText).toHaveBeenNthCalledWith(2, "s1", "💻 bash next");
  });

  it("ignores removal of a prefix that is not in the stream", async () => {
    vi.useFakeTimers();

    const sendText = vi.fn().mockResolvedValue(1);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ToolCallStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.append("s1", "tool one");
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    streamer.removeByPrefix("s1", "⏳missing");
    streamer.removeByPrefix("unknown-session", "⏳call-1");
    await vi.advanceTimersByTimeAsync(50);

    expect(editText).not.toHaveBeenCalled();
    expect(deleteText).not.toHaveBeenCalled();
  });

  it("starts a new tool stream after a file boundary break", async () => {
    vi.useFakeTimers();

    let nextMessageId = 50;
    const sendText = vi.fn(async () => nextMessageId++);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ToolCallStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.append("s1", "before file");
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    await streamer.breakSession("s1", "tool_file_boundary");

    streamer.append("s1", "after file");
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(2);
    });

    expect(editText).not.toHaveBeenCalled();
    expect(deleteText).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenNthCalledWith(2, "s1", "after file");
  });

  it("starts a new tool stream after an assistant reply boundary break", async () => {
    vi.useFakeTimers();

    let nextMessageId = 60;
    const sendText = vi.fn(async () => nextMessageId++);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ToolCallStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.append("s1", "before reply");
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    await streamer.breakSession("s1", "assistant_message_completed");

    streamer.append("s1", "after reply");
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(2);
    });

    expect(editText).not.toHaveBeenCalled();
    expect(deleteText).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenNthCalledWith(2, "s1", "after reply");
  });

  it("flushes all stream keys for the same session", async () => {
    vi.useFakeTimers();

    const sendText = vi.fn().mockResolvedValueOnce(30).mockResolvedValueOnce(31);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ToolCallStreamer({
      throttleMs: 200,
      sendText,
      editText,
      deleteText,
    });

    streamer.append("s1", "regular tool");
    streamer.append("s1", "subagent card", "subagent:card");

    const flushPromise = streamer.flushSession("s1", "manual_flush");
    await vi.advanceTimersByTimeAsync(200);
    await flushPromise;

    expect(sendText).toHaveBeenCalledTimes(2);
    expect(sendText).toHaveBeenNthCalledWith(1, "s1", "regular tool");
    expect(sendText).toHaveBeenNthCalledWith(2, "s1", "subagent card");
  });

  it("cancels throttled tool sends when clearing all streams", async () => {
    vi.useFakeTimers();

    const sendText = vi.fn().mockResolvedValue(1);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ToolCallStreamer({
      throttleMs: 200,
      sendText,
      editText,
      deleteText,
    });

    streamer.append("s1", "pending");
    streamer.clearAll("abort_command");

    await vi.advanceTimersByTimeAsync(500);

    expect(sendText).not.toHaveBeenCalled();
    expect(editText).not.toHaveBeenCalled();
    expect(deleteText).not.toHaveBeenCalled();
  });

  it("cancels retry-after resend when the session is cleared", async () => {
    vi.useFakeTimers();

    const sendText = vi
      .fn()
      .mockRejectedValueOnce(new Error("429: retry after 1"))
      .mockResolvedValueOnce(1);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ToolCallStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.append("s1", "hello");
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    streamer.clearSession("s1", "abort_command");
    await vi.advanceTimersByTimeAsync(1000);

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(editText).not.toHaveBeenCalled();
    expect(deleteText).not.toHaveBeenCalled();
  });

  it("routes new tool calls after an in-flight break operation finishes", async () => {
    vi.useFakeTimers();

    const editResolution: { current: null | (() => void) } = { current: null };
    const sendText = vi.fn().mockResolvedValueOnce(10).mockResolvedValueOnce(11);
    const editText = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          editResolution.current = resolve;
        }),
    );
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ToolCallStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.append("s1", "before break");
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    streamer.append("s1", "forces edit");
    await vi.waitFor(() => {
      expect(editText).toHaveBeenCalledTimes(1);
    });

    const breakPromise = streamer.breakSession("s1", "thinking_started");
    streamer.append("s1", "after break");

    expect(sendText).toHaveBeenCalledTimes(1);

    if (editResolution.current) {
      editResolution.current();
    }
    await expect(breakPromise).resolves.toBeUndefined();
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(2);
    });

    expect(sendText).toHaveBeenNthCalledWith(2, "s1", "after break");
  });

  describe("network recovery", () => {
    function createStreamer() {
      vi.useFakeTimers();
      let id = 1;
      const sendText = vi.fn(async (_sessionId: string, _text: string) => id++);
      const editText = vi.fn(async () => undefined);
      const deleteText = vi.fn(async () => undefined);
      const streamer = new ToolCallStreamer({
        throttleMs: 0,
        sendText,
        editText,
        deleteText,
      });
      const networkError = {
        error: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }),
      };
      return { streamer, sendText, editText, deleteText, networkError };
    }

    it.each(["finished", "❌ failed", "💻 interrupted"])(
      "recovers the latest terminal text after idle: %s",
      async (terminal) => {
        const { streamer, sendText, editText, networkError } = createStreamer();
        streamer.replaceByPrefix("s1", "⏳one", "⏳ running");
        await vi.advanceTimersByTimeAsync(0);
        editText.mockRejectedValue(networkError);
        streamer.replaceByPrefix("s1", "⏳one", "⏳ running · 🕒 20s");
        await vi.advanceTimersByTimeAsync(0);
        streamer.replaceByPrefix("s1", "⏳one", "⏳ intermediate");
        streamer.replaceByPrefix("s1", "⏳one", terminal);
        await streamer.breakSession("s1", "session_idle");
        expect(editText).toHaveBeenCalledTimes(1);

        editText.mockResolvedValue(undefined);
        await vi.advanceTimersByTimeAsync(1000);
        expect(editText).toHaveBeenCalledTimes(2);
        expect(editText).toHaveBeenLastCalledWith("s1", 1, terminal);
        expect(sendText).toHaveBeenCalledTimes(1);
      },
    );

    it("does not hold new tools or standalone delivery behind a recovery timer", async () => {
      const { streamer, sendText, editText, networkError } = createStreamer();
      streamer.replaceByPrefix("s1", "⏳one", "⏳ running");
      await vi.advanceTimersByTimeAsync(0);
      editText.mockRejectedValue(networkError);
      streamer.replaceByPrefix("s1", "⏳one", "⏳ updated");
      await vi.advanceTimersByTimeAsync(0);
      streamer.replaceByPrefix("s1", "⏳two", "second tool");
      await vi.advanceTimersByTimeAsync(0);
      await streamer.sendStandalone("s1", "independent card");
      expect(sendText.mock.calls.map((call) => call[1])).toEqual([
        "⏳ running",
        "second tool",
        "independent card",
      ]);
      expect(editText).toHaveBeenCalledTimes(1);
      streamer.clearAll("test_cleanup");
    });

    it("accepts completion during the outage even when idle was already observed", async () => {
      const { streamer, sendText, editText, networkError } = createStreamer();
      streamer.replaceByPrefix("s1", "⏳one", "⏳ running");
      await vi.advanceTimersByTimeAsync(0);
      editText.mockRejectedValueOnce(networkError);
      streamer.replaceByPrefix("s1", "⏳one", "⏳ updated");
      await vi.advanceTimersByTimeAsync(0);
      await streamer.breakSession("s1", "session_idle");
      streamer.replaceByPrefix("s1", "⏳one", "done");
      await vi.advanceTimersByTimeAsync(1000);
      expect(editText).toHaveBeenLastCalledWith("s1", 1, "done");
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    it("keeps completion when idle arrives during an in-flight recovery attempt", async () => {
      const { streamer, sendText, editText, networkError } = createStreamer();
      streamer.replaceByPrefix("s1", "⏳one", "⏳ running");
      await vi.advanceTimersByTimeAsync(0);
      let rejectEdit: (error: unknown) => void = () => {};
      editText.mockRejectedValueOnce(networkError).mockImplementationOnce(
        () =>
          new Promise<undefined>((_resolve, reject) => {
            rejectEdit = reject;
          }),
      );
      streamer.replaceByPrefix("s1", "⏳one", "⏳ updated");
      await vi.advanceTimersByTimeAsync(1000);
      expect(editText).toHaveBeenCalledTimes(2);
      const idle = streamer.breakSession("s1", "session_idle");
      streamer.replaceByPrefix("s1", "⏳one", "done");
      rejectEdit(networkError);
      await idle;
      await vi.advanceTimersByTimeAsync(2000);
      expect(editText).toHaveBeenLastCalledWith("s1", 1, "done");
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    it.each([false, true])(
      "does not revive an interrupted recovering call with terminal text already present: %s",
      async (alreadyTerminal) => {
        const { streamer, sendText, editText, networkError } = createStreamer();
        streamer.replaceByPrefix("s1", "⏳one", "⏳ 💻 bash sleep");
        await vi.advanceTimersByTimeAsync(0);
        editText.mockRejectedValueOnce(networkError);
        streamer.replaceByPrefix("s1", "⏳one", "⏳ 💻 bash sleep · 🕒 20s");
        await vi.advanceTimersByTimeAsync(0);
        if (alreadyTerminal) {
          streamer.replaceByPrefix("s1", "⏳one", "💻 bash sleep");
        }
        await streamer.breakSession("s1", "session_interrupted");
        streamer.replaceByPrefix("s1", "⏳one", "late successful result");
        await vi.advanceTimersByTimeAsync(1000);
        expect(editText).toHaveBeenLastCalledWith(
          "s1", 1, alreadyTerminal ? "💻 bash sleep" : "💻 bash sleep · 🕒 20s",
        );
        expect(sendText).toHaveBeenCalledTimes(1);
      },
    );

    it.each(["assistant_reply_started", "thinking_started", "session_error"])(
      "keeps pending terminal recovery across %s",
      async (reason) => {
        const { streamer, sendText, editText, networkError } = createStreamer();
        streamer.replaceByPrefix("s1", "⏳one", "⏳ running");
        await vi.advanceTimersByTimeAsync(0);
        editText.mockRejectedValueOnce(networkError);
        streamer.replaceByPrefix("s1", "⏳one", "done");
        await vi.advanceTimersByTimeAsync(0);
        await streamer.breakSession("s1", reason);
        await vi.advanceTimersByTimeAsync(1000);
        expect(editText).toHaveBeenLastCalledWith("s1", 1, "done");
        expect(editText).toHaveBeenCalledTimes(2);
        expect(sendText).toHaveBeenCalledTimes(1);
      },
    );

    it("recovers a pending document-companion deletion instead of restoring its text", async () => {
      const { streamer, sendText, editText, deleteText, networkError } = createStreamer();
      streamer.replaceByPrefix("s1", "⏳file", "⏳ writing");
      await vi.advanceTimersByTimeAsync(0);
      editText.mockRejectedValueOnce(networkError);
      streamer.replaceByPrefix("s1", "⏳file", "⏳ writing · 🕒 20s");
      await vi.advanceTimersByTimeAsync(0);
      streamer.removeByPrefix("s1", "⏳file", "default", true);
      streamer.beginDocumentBoundary("s1");
      await streamer.flushSession("s1", "tool_file_boundary");
      streamer.endDocumentBoundary("s1");
      deleteText.mockRejectedValueOnce(networkError);
      await streamer.breakSession("s1", "session_idle");

      await vi.advanceTimersByTimeAsync(1000);
      expect(deleteText).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2000);
      expect(deleteText).toHaveBeenCalledTimes(2);
      expect(deleteText).toHaveBeenLastCalledWith("s1", 1);
      expect(editText).toHaveBeenCalledTimes(1);
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    it("retains a deletion whose first network failure happens at a document boundary", async () => {
      const { streamer, deleteText, networkError } = createStreamer();
      streamer.replaceByPrefix("s1", "⏳file", "⏳ writing");
      await vi.advanceTimersByTimeAsync(0);
      deleteText.mockRejectedValueOnce(networkError);
      streamer.removeByPrefix("s1", "⏳file", "default", true);
      streamer.beginDocumentBoundary("s1");
      await streamer.flushSession("s1", "tool_file_boundary");
      streamer.endDocumentBoundary("s1");
      await streamer.breakSession("s1", "session_idle");
      await vi.advanceTimersByTimeAsync(1000);
      expect(deleteText).toHaveBeenCalledTimes(2);
    });

    it.each(["clearSession", "clearAll"] as const)(
      "cancels pending recovery on %s",
      async (clear) => {
        const { streamer, editText, networkError } = createStreamer();
        streamer.replaceByPrefix("s1", "⏳one", "⏳ running");
        await vi.advanceTimersByTimeAsync(0);
        editText.mockRejectedValue(networkError);
        streamer.replaceByPrefix("s1", "⏳one", "done");
        await vi.advanceTimersByTimeAsync(0);
        if (clear === "clearSession") {
          streamer.clearSession("s1", "test_cleanup");
        } else {
          streamer.clearAll("test_cleanup");
        }
        await vi.advanceTimersByTimeAsync(60000);
        expect(editText).toHaveBeenCalledTimes(1);
      },
    );

    it("does not reconstruct an ambiguous creation at later updates or boundaries", async () => {
      const { streamer, sendText, networkError } = createStreamer();
      sendText.mockRejectedValueOnce(networkError);
      streamer.replaceByPrefix("s1", "⏳lost", "⏳ lost");
      await vi.advanceTimersByTimeAsync(0);
      streamer.replaceByPrefix("s1", "⏳other", "other");
      await vi.advanceTimersByTimeAsync(0);
      await streamer.breakSession("s1", "assistant_reply_started");
      streamer.replaceByPrefix("s1", "⏳lost", "lost finished");
      await vi.advanceTimersByTimeAsync(60000);
      expect(sendText.mock.calls.map((call) => call[1])).toEqual(["⏳ lost", "other"]);
    });

    it("does not retry an ambiguous new split part just because an earlier ID is known", async () => {
      const { streamer, sendText, networkError } = createStreamer();
      streamer.replaceByPrefix("s1", "⏳one", "⏳ running");
      await vi.advanceTimersByTimeAsync(0);
      sendText.mockRejectedValueOnce(networkError);
      streamer.replaceByPrefix("s1", "⏳one", "x".repeat(5000));
      await vi.advanceTimersByTimeAsync(0);
      await streamer.breakSession("s1", "session_idle");
      streamer.replaceByPrefix("s1", "⏳one", "final");
      await vi.advanceTimersByTimeAsync(60000);
      expect(sendText).toHaveBeenCalledTimes(2);
    });

    it("stops recovery when a later attempt returns a permanent error", async () => {
      const { streamer, editText, networkError } = createStreamer();
      streamer.replaceByPrefix("s1", "⏳one", "⏳ running");
      await vi.advanceTimersByTimeAsync(0);
      editText
        .mockRejectedValueOnce(networkError)
        .mockRejectedValue(new Error("400: message not found"));
      streamer.replaceByPrefix("s1", "⏳one", "done");
      await vi.advanceTimersByTimeAsync(60000);
      expect(editText).toHaveBeenCalledTimes(2);
      await streamer.breakSession("s1", "session_idle");
      expect(Reflect.get(streamer, "allStates")).toHaveProperty("size", 0);
      streamer.replaceByPrefix("s1", "⏳one", "late result");
      await vi.advanceTimersByTimeAsync(60000);
      expect(editText).toHaveBeenCalledTimes(2);
    });

    it("backs off repeated failures without holding the break and resets after success", async () => {
      const { streamer, editText, networkError } = createStreamer();
      streamer.replaceByPrefix("s1", "⏳one", "⏳ running");
      await vi.advanceTimersByTimeAsync(0);
      streamer.pinEntry("s1", "⏳one");
      editText.mockRejectedValue(networkError);
      streamer.replaceByPrefix("s1", "⏳one", "⏳ updated");
      await vi.advanceTimersByTimeAsync(0);
      await streamer.breakSession("s1", "session_idle");
      await vi.advanceTimersByTimeAsync(999);
      expect(editText).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(editText).toHaveBeenCalledTimes(2);
      editText.mockResolvedValue(undefined);
      await vi.advanceTimersByTimeAsync(2000);
      expect(editText).toHaveBeenCalledTimes(3);
      editText.mockRejectedValueOnce(networkError);
      streamer.replaceByPrefix("s1", "⏳one", "done");
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1000);
      expect(editText).toHaveBeenCalledTimes(5);
      streamer.clearAll("test_cleanup");
    });

    it("does not extend recovery to subagent streams or standalone edits", async () => {
      const { streamer, editText, networkError } = createStreamer();
      streamer.replaceByPrefix("s1", "🧩", "card", "subagent:card");
      await vi.advanceTimersByTimeAsync(0);
      editText.mockRejectedValue(networkError);
      streamer.replaceByPrefix("s1", "🧩", "card done", "subagent:card");
      await vi.advanceTimersByTimeAsync(60000);
      expect(editText).toHaveBeenCalledTimes(1);
      await expect(streamer.editStandalone("s1", 42, "todo")).rejects.toBe(networkError);
      await vi.advanceTimersByTimeAsync(60000);
      expect(editText).toHaveBeenCalledTimes(2);
    });

    it("recovers a known split part with a wrapped cause without opening another bubble", async () => {
      const { streamer, sendText, editText } = createStreamer();
      streamer.replaceByPrefix("s1", "⏳one", "a".repeat(5000));
      await vi.advanceTimersByTimeAsync(0);
      editText
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(
          new TypeError("fetch failed", { cause: { code: "ETIMEDOUT" } }),
        );
      streamer.replaceByPrefix("s1", "⏳one", "b".repeat(5000));
      await vi.advanceTimersByTimeAsync(0);
      await streamer.breakSession("s1", "assistant_reply_started");
      await vi.advanceTimersByTimeAsync(1000);
      expect(editText).toHaveBeenLastCalledWith("s1", 2, "b".repeat(1000));
      expect(sendText).toHaveBeenCalledTimes(2);
    });

    it("keeps recovery delay capped during a long outage", async () => {
      const { streamer, editText, networkError } = createStreamer();
      streamer.replaceByPrefix("s1", "⏳one", "⏳ running");
      await vi.advanceTimersByTimeAsync(0);
      editText.mockRejectedValue(networkError);
      streamer.replaceByPrefix("s1", "⏳one", "done");
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1000 + 2000 + 4000 + 8000 + 16000);
      expect(editText).toHaveBeenCalledTimes(6);
      await vi.advanceTimersByTimeAsync(29999);
      expect(editText).toHaveBeenCalledTimes(6);
      await vi.advanceTimersByTimeAsync(1);
      expect(editText).toHaveBeenCalledTimes(7);
      streamer.clearAll("test_cleanup");
    });
  });

  describe("pinned entries", () => {
    function createStreamer() {
      let id = 1;
      const sendText = vi.fn(async (_sessionId: string, _text: string) => id++);
      const editText = vi.fn(
        async (_sessionId: string, _messageId: number, _text: string) => undefined,
      );
      const streamer = new ToolCallStreamer({
        throttleMs: 0,
        sendText,
        editText,
        deleteText: vi.fn().mockResolvedValue(undefined),
      });
      return { streamer, sendText, editText };
    }

    it("keeps editing a pinned line in its own message after the turn ends", async () => {
      vi.useFakeTimers();
      const { streamer, sendText, editText } = createStreamer();

      streamer.replaceByPrefix("s1", "⏳bg", "⏳ 💻 bash sleep 90");
      streamer.pinEntry("s1", "⏳bg");
      await vi.waitFor(() => expect(sendText).toHaveBeenCalledTimes(1));
      await streamer.breakSession("s1", "session_idle");

      streamer.replaceByPrefix("s1", "⏳bg", "⏳ 💻 bash sleep 90 · 🕒 30s");
      await vi.waitFor(() => expect(editText).toHaveBeenCalledTimes(1));
      streamer.replaceByPrefix("s1", "⏳bg", "💻 bash sleep 90 · 🕒 1m 30s");
      await vi.waitFor(() => expect(editText).toHaveBeenCalledTimes(2));

      expect(editText).toHaveBeenLastCalledWith("s1", 1, "💻 bash sleep 90 · 🕒 1m 30s");
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    it("opens a new message for output that comes after the break", async () => {
      vi.useFakeTimers();
      const { streamer, sendText } = createStreamer();

      streamer.replaceByPrefix("s1", "⏳bg", "⏳ bg");
      streamer.pinEntry("s1", "⏳bg");
      await vi.waitFor(() => expect(sendText).toHaveBeenCalledTimes(1));
      await streamer.breakSession("s1", "assistant_message_completed");

      streamer.replaceByPrefix("s1", "⏳next", "⏳ next");
      await vi.waitFor(() => expect(sendText).toHaveBeenCalledTimes(2));
      expect(sendText).toHaveBeenLastCalledWith("s1", "⏳ next");
    });

    it("lets go of the message at the next break once the line is unpinned", async () => {
      vi.useFakeTimers();
      const { streamer, sendText, editText } = createStreamer();

      streamer.replaceByPrefix("s1", "⏳bg", "⏳ bg");
      streamer.pinEntry("s1", "⏳bg");
      await vi.waitFor(() => expect(sendText).toHaveBeenCalledTimes(1));
      await streamer.breakSession("s1", "session_idle");
      streamer.replaceByPrefix("s1", "⏳bg", "bg done");
      streamer.unpinEntry("s1", "⏳bg");
      await vi.waitFor(() => expect(editText).toHaveBeenCalledTimes(1));
      await streamer.breakSession("s1", "session_idle");

      streamer.replaceByPrefix("s1", "⏳bg", "bg changed again");
      await vi.advanceTimersByTimeAsync(500);
      expect(sendText).toHaveBeenCalledTimes(2);
      expect(sendText).toHaveBeenLastCalledWith("s1", "bg changed again");
    });

    it("ignores later updates of a pinned line once it is frozen", async () => {
      vi.useFakeTimers();
      const { streamer, sendText, editText } = createStreamer();

      streamer.replaceByPrefix("s1", "⏳bg", "⏳ bg · 🕒 30s");
      streamer.pinEntry("s1", "⏳bg");
      await vi.waitFor(() => expect(sendText).toHaveBeenCalledTimes(1));
      await streamer.breakSession("s1", "session_idle");
      streamer.freezePinnedEntries("s1");

      streamer.replaceByPrefix("s1", "⏳bg", "bg · 🕒 1m 30s");
      await vi.advanceTimersByTimeAsync(500);

      expect(editText).not.toHaveBeenCalled();
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    it("freezes either the pinned subagent cards or the other pinned lines", async () => {
      vi.useFakeTimers();
      const { streamer, editText } = createStreamer();

      streamer.replaceByPrefix("s1", "⏳bg", "⏳ bg");
      streamer.pinEntry("s1", "⏳bg");
      streamer.replaceByPrefix("s1", "🧩", "🧩 card running", "subagent:card-1");
      streamer.pinEntry("s1", "🧩", "subagent:card-1");
      await vi.advanceTimersByTimeAsync(500);
      await streamer.breakSession("s1", "session_idle");

      streamer.freezePinnedEntries("s1", false);
      streamer.replaceByPrefix("s1", "⏳bg", "bg done");
      streamer.replaceByPrefix("s1", "🧩", "🧩 card ended", "subagent:card-1");
      await vi.advanceTimersByTimeAsync(500);

      const edits = editText.mock.calls.map((call) => String(call[2]));
      expect(edits).toContain("🧩 card ended");
      expect(edits).not.toContain("bg done");

      streamer.freezePinnedEntries("s1", true);
      streamer.replaceByPrefix("s1", "🧩", "🧩 card changed again", "subagent:card-1");
      await vi.advanceTimersByTimeAsync(500);
      expect(editText.mock.calls.map((call) => String(call[2]))).not.toContain(
        "🧩 card changed again",
      );
    });
  });

  it("reads throttleMs again for the next flush cycle", async () => {
    vi.useFakeTimers();

    let throttleMs = 200;
    let nextMessageId = 1;
    const sendText = vi.fn(async () => nextMessageId++);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ToolCallStreamer({
      throttleMs: () => throttleMs,
      sendText,
      editText,
      deleteText,
    });

    streamer.append("s1", "first");
    await vi.advanceTimersByTimeAsync(200);
    expect(sendText).toHaveBeenCalledTimes(1);

    throttleMs = 2000;
    streamer.append("s1", "second");
    await vi.advanceTimersByTimeAsync(1999);
    expect(editText).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(editText).toHaveBeenCalledTimes(1);
    expect(editText).toHaveBeenCalledWith("s1", 1, "first\n\nsecond");
  });

  describe("gate", () => {
    it("waits for its gate before opening a new message, not before editing it", async () => {
      vi.useFakeTimers();
      const sendText = vi.fn().mockResolvedValue(10);
      const editText = vi.fn().mockResolvedValue(undefined);
      let openGate: () => void = () => {};
      const gate = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            openGate = resolve;
          }),
      );
      const streamer = new ToolCallStreamer({
        throttleMs: 100,
        sendText,
        editText,
        deleteText: vi.fn().mockResolvedValue(undefined),
        takeGate: () => gate,
      });

      streamer.append("s1", "first");
      await vi.advanceTimersByTimeAsync(100);
      expect(gate).toHaveBeenCalledTimes(1);
      expect(sendText).not.toHaveBeenCalled();

      openGate();
      await vi.waitFor(() => {
        expect(sendText).toHaveBeenCalledWith("s1", "first");
      });

      gate.mockImplementation(() => new Promise<void>(() => {}));
      streamer.append("s1", "second");
      await vi.advanceTimersByTimeAsync(100);
      expect(editText).toHaveBeenCalledWith("s1", 10, "first\n\nsecond");
      expect(gate).toHaveBeenCalledTimes(1);
    });

    it("does not wait for its gate while the stream is broken", async () => {
      vi.useFakeTimers();
      const sendText = vi.fn().mockResolvedValue(10);
      const gate = vi.fn(() => new Promise<void>(() => {}));
      const streamer = new ToolCallStreamer({
        throttleMs: 100,
        sendText,
        editText: vi.fn().mockResolvedValue(undefined),
        deleteText: vi.fn().mockResolvedValue(undefined),
        takeGate: () => gate,
      });

      streamer.append("s1", "line");
      await streamer.breakSession("s1", "test_break");

      expect(gate).not.toHaveBeenCalled();
      expect(sendText).toHaveBeenCalledWith("s1", "line");
    });

    it("takes the gate when a stream starts", async () => {
      vi.useFakeTimers();
      const takeGate = vi.fn().mockReturnValue(undefined);
      const streamer = new ToolCallStreamer({
        throttleMs: 100,
        sendText: vi.fn().mockResolvedValue(10),
        editText: vi.fn().mockResolvedValue(undefined),
        deleteText: vi.fn().mockResolvedValue(undefined),
        takeGate,
      });

      streamer.append("s1", "first");
      streamer.append("s1", "second");
      expect(takeGate).toHaveBeenCalledTimes(1);
      expect(streamer.hasUnsentMessages("s1")).toBe(true);

      await vi.advanceTimersByTimeAsync(100);
      expect(streamer.hasUnsentMessages("s1")).toBe(false);
    });

    it("stops every stream of a session taking lines as soon as a break starts", async () => {
      vi.useFakeTimers();
      let releaseFirst: () => void = () => {};
      const sendText = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<number>((resolve) => {
              releaseFirst = () => resolve(10);
            }),
        )
        .mockResolvedValue(11);
      const streamer = new ToolCallStreamer({
        throttleMs: 100,
        sendText,
        editText: vi.fn().mockResolvedValue(undefined),
        deleteText: vi.fn().mockResolvedValue(undefined),
      });

      streamer.append("s1", "default line");
      streamer.append("s1", "subagent card", "subagent:card");
      const broken = streamer.breakSession("s1", "test_break");
      streamer.append("s1", "later subagent card", "subagent:card");
      await vi.waitFor(() => {
        expect(sendText).toHaveBeenCalledTimes(1);
      });
      releaseFirst();
      await vi.advanceTimersByTimeAsync(1000);
      await broken;
      await vi.advanceTimersByTimeAsync(1000);

      const sentTexts = sendText.mock.calls.map((call) => call[1]);
      expect(sentTexts).toContain("subagent card");
      expect(sentTexts).toContain("later subagent card");
    });
  });
});
