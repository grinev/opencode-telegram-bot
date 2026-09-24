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

  it("keeps todo updates in a separate message stream", async () => {
    vi.useFakeTimers();

    const sendText = vi.fn().mockResolvedValueOnce(10).mockResolvedValueOnce(11);
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

    streamer.append("s1", "todo tool", "todo");
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(2);
    });

    streamer.append("s1", "regular tool update");
    await vi.waitFor(() => {
      expect(editText).toHaveBeenCalledTimes(1);
    });

    expect(sendText).toHaveBeenNthCalledWith(1, "s1", "regular tool");
    expect(sendText).toHaveBeenNthCalledWith(2, "s1", "todo tool");
    expect(editText).toHaveBeenCalledWith("s1", 10, "regular tool\n\nregular tool update");
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

  it("freezes every tool stream before waiting on the first stream's pending edit", async () => {
    vi.useFakeTimers();
    let resolveEdit: (() => void) | undefined;
    let id = 1;
    const sendText = vi.fn(async () => id++);
    const editText = vi.fn((_sessionId: string, _messageId: number, _text: string) =>
      new Promise<void>((resolve) => { resolveEdit = resolve; }),
    );
    const streamer = new ToolCallStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText: vi.fn().mockResolvedValue(undefined),
    });

    streamer.replaceByPrefix("s1", "⏳first", "⏳ first");
    await vi.waitFor(() => expect(sendText).toHaveBeenCalledTimes(1));
    streamer.replaceByPrefix("s1", "⏳todo", "⏳ todo", "todo");
    await vi.waitFor(() => expect(sendText).toHaveBeenCalledTimes(2));
    streamer.replaceByPrefix("s1", "⏳first", "⏳ first updated");
    await vi.waitFor(() => expect(editText).toHaveBeenCalledTimes(1));

    const breaking = streamer.breakSession("s1", "session_error");
    streamer.replaceByPrefix("s1", "⏳todo", "todo finished", "todo");
    resolveEdit?.();
    await breaking;
    expect(editText.mock.calls.some((call) => String(call[2]).includes("todo finished"))).toBe(false);
    expect(sendText).toHaveBeenCalledTimes(2);
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
    streamer.append("s1", "todo tool", "todo");

    const flushPromise = streamer.flushSession("s1", "manual_flush");
    await vi.advanceTimersByTimeAsync(200);
    await flushPromise;

    expect(sendText).toHaveBeenCalledTimes(2);
    expect(sendText).toHaveBeenNthCalledWith(1, "s1", "regular tool");
    expect(sendText).toHaveBeenNthCalledWith(2, "s1", "todo tool");
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
});
