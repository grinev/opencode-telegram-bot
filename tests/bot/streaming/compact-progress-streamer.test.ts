import { afterEach, describe, expect, it, vi } from "vitest";
import { CompactProgressStreamer } from "../../../src/bot/streaming/compact-progress-streamer.js";

describe("bot/streaming/compact-progress-streamer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends one progress message and finalizes it in place", async () => {
    const sendText = vi.fn().mockResolvedValue(10);
    const editText = vi.fn().mockResolvedValue(undefined);
    const streamer = new CompactProgressStreamer({ throttleMs: 0, sendText, editText });

    streamer.updateActivity("s1", "working");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await streamer.finalize("s1");

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith("s1", "⏳ Working\nworking");
    expect(editText).toHaveBeenCalledTimes(1);
    expect(editText).toHaveBeenCalledWith(
      "s1",
      10,
      "✅ Finished Work\ntool calls: 0 · changed files: 0",
    );
  });

  it("deletes the progress message on finalize when deleteOnFinish is set", async () => {
    const sendText = vi.fn().mockResolvedValue(10);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new CompactProgressStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.updateActivity("s1", "working");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await streamer.finalize("s1", true);

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith("s1", "⏳ Working\nworking");
    expect(deleteText).toHaveBeenCalledTimes(1);
    expect(deleteText).toHaveBeenCalledWith("s1", 10);
    expect(editText).not.toHaveBeenCalled();
  });

  it("keeps the final summary edit when deleteOnFinish is false", async () => {
    const sendText = vi.fn().mockResolvedValue(10);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new CompactProgressStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.updateActivity("s1", "working");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await streamer.finalize("s1", false);

    expect(deleteText).not.toHaveBeenCalled();
    expect(editText).toHaveBeenCalledTimes(1);
    expect(editText).toHaveBeenCalledWith(
      "s1",
      10,
      "✅ Finished Work\ntool calls: 0 · changed files: 0",
    );
  });

  it("creates a message for thinking-only activity", async () => {
    const sendText = vi.fn().mockResolvedValue(10);
    const editText = vi.fn().mockResolvedValue(undefined);
    const streamer = new CompactProgressStreamer({ throttleMs: 0, sendText, editText });

    streamer.updateThinking("s1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await streamer.finalize("s1");

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith("s1", "⏳ Working\n💭 Thinking...");
    expect(editText).toHaveBeenCalledTimes(1);
    expect(editText).toHaveBeenCalledWith(
      "s1",
      10,
      "✅ Finished Work\ntool calls: 0 · changed files: 0",
    );
  });

  it("creates a message for writing-only activity", async () => {
    const sendText = vi.fn().mockResolvedValue(10);
    const editText = vi.fn().mockResolvedValue(undefined);
    const streamer = new CompactProgressStreamer({ throttleMs: 0, sendText, editText });

    streamer.updateResponding("s1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await streamer.finalize("s1");

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith("s1", "⏳ Working\n✍️ Writing answer...");
    expect(editText).toHaveBeenCalledTimes(1);
    expect(editText).toHaveBeenCalledWith(
      "s1",
      10,
      "✅ Finished Work\ntool calls: 0 · changed files: 0",
    );
  });

  it("updates active progress when thinking starts", async () => {
    const sendText = vi.fn().mockResolvedValue(10);
    const editText = vi.fn().mockResolvedValue(undefined);
    const streamer = new CompactProgressStreamer({ throttleMs: 0, sendText, editText });

    streamer.updateActivity("s1", "reading");
    await new Promise((resolve) => setTimeout(resolve, 0));
    streamer.addToolCall("s1", "call-1");

    streamer.updateThinking("s1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await streamer.finalize("s1");

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith("s1", "⏳ Working\nreading");
    expect(editText).toHaveBeenNthCalledWith(1, "s1", 10, "⏳ Working\n💭 Thinking...");
    expect(editText).toHaveBeenNthCalledWith(
      2,
      "s1",
      10,
      "✅ Finished Work\ntool calls: 1 · changed files: 0",
    );
  });

  it("keeps thinking, a tool, and writing on one message", async () => {
    const sendText = vi.fn().mockResolvedValue(10);
    const editText = vi.fn().mockResolvedValue(undefined);
    const streamer = new CompactProgressStreamer({ throttleMs: 0, sendText, editText });

    streamer.updateThinking("s1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    streamer.updateActivity("s1", "reading");
    await new Promise((resolve) => setTimeout(resolve, 0));
    streamer.updateResponding("s1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await streamer.finalize("s1");

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith("s1", "⏳ Working\n💭 Thinking...");
    expect(editText).toHaveBeenNthCalledWith(1, "s1", 10, "⏳ Working\nreading");
    expect(editText).toHaveBeenNthCalledWith(2, "s1", 10, "⏳ Working\n✍️ Writing answer...");
    expect(editText).toHaveBeenNthCalledWith(
      3,
      "s1",
      10,
      "✅ Finished Work\ntool calls: 0 · changed files: 0",
    );
  });

  it("counts unique tool calls and changed files", async () => {
    const sendText = vi.fn().mockResolvedValue(20);
    const editText = vi.fn().mockResolvedValue(undefined);
    const streamer = new CompactProgressStreamer({ throttleMs: 100, sendText, editText });

    streamer.updateActivity("s1", "working");
    streamer.addToolCall("s1", "call-1");
    streamer.addToolCall("s1", "call-1");
    streamer.addToolCall("s1", "call-2");
    streamer.addFileChange("s1", "src/a.ts");
    streamer.addFileChange("s1", "src/a.ts");
    streamer.addFileChange("s1", "src/b.ts");

    await streamer.finalize("s1");

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith(
      "s1",
      "✅ Finished Work\ntool calls: 2 · changed files: 2",
    );
    expect(editText).not.toHaveBeenCalled();
  });

  it("lets a new run create progress while the previous card is still finalizing", async () => {
    const sendText = vi.fn().mockResolvedValue(10);
    const editText = vi.fn().mockResolvedValue(undefined);
    const streamer = new CompactProgressStreamer({ throttleMs: 0, sendText, editText });

    streamer.updateActivity("s1", "run-a");
    const finalizePromise = streamer.finalize("s1");
    streamer.updateThinking("s1");
    await finalizePromise;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendText.mock.calls.some((call) => String(call[1]).includes("run-a") || String(call[1]).includes("Finished Work"))).toBe(
      true,
    );
    expect(sendText.mock.calls.some((call) => String(call[1]).includes("💭 Thinking..."))).toBe(true);
  });

  it("finalizes a second run while the first card is still being finalized", async () => {
    const sendText = vi.fn().mockImplementation(async (_sessionId: string, _text: string) => {
      return sendText.mock.calls.length * 10;
    });
    const editText = vi.fn().mockResolvedValue(undefined);
    const streamer = new CompactProgressStreamer({ throttleMs: 0, sendText, editText });

    streamer.updateActivity("s1", "run-a");
    const firstFinalize = streamer.finalize("s1");
    streamer.updateThinking("s1");
    const secondFinalize = streamer.finalize("s1");
    await Promise.all([firstFinalize, secondFinalize]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendText.mock.calls.some((call) => String(call[1]).includes("run-a"))).toBe(true);
    expect(sendText.mock.calls.some((call) => String(call[1]).includes("💭 Thinking..."))).toBe(true);
    expect(editText).toHaveBeenCalledTimes(2);
    expect(editText.mock.calls.every((call) => String(call[2]).includes("✅ Finished Work"))).toBe(true);
  });

  it("does not finish a detached card after the session is cleared", async () => {
    let releaseSend: (() => void) | undefined;
    const sendText = vi.fn().mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          releaseSend = () => resolve(10);
        }),
    );
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new CompactProgressStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.updateActivity("s1", "working");
    const finalizePromise = streamer.finalize("s1", true);
    streamer.clearSession("s1", "session_error");
    releaseSend?.();
    await finalizePromise;

    expect(editText).not.toHaveBeenCalled();
    expect(deleteText).not.toHaveBeenCalled();
  });

  it("does not finish a detached card after all sessions are cleared", async () => {
    let releaseSend: (() => void) | undefined;
    const sendText = vi.fn().mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          releaseSend = () => resolve(10);
        }),
    );
    const editText = vi.fn().mockResolvedValue(undefined);
    const streamer = new CompactProgressStreamer({ throttleMs: 0, sendText, editText });

    streamer.updateActivity("s1", "working");
    const finalizePromise = streamer.finalize("s1");
    streamer.clearAll("runtime_clear");
    releaseSend?.();
    await finalizePromise;

    expect(editText).not.toHaveBeenCalled();
  });

  it("does not create a message when finalizing an inactive session", async () => {
    const sendText = vi.fn().mockResolvedValue(20);
    const editText = vi.fn().mockResolvedValue(undefined);
    const streamer = new CompactProgressStreamer({ throttleMs: 0, sendText, editText });

    await streamer.finalize("s1");

    expect(sendText).not.toHaveBeenCalled();
    expect(editText).not.toHaveBeenCalled();
  });

  it("cancels a pending throttle flush when the session is cleared", async () => {
    vi.useFakeTimers();

    const sendText = vi.fn().mockResolvedValue(30);
    const editText = vi.fn().mockResolvedValue(undefined);
    const streamer = new CompactProgressStreamer({ throttleMs: 2000, sendText, editText });

    streamer.updateActivity("s1", "working");
    streamer.clearSession("s1", "session_idle");
    await vi.advanceTimersByTimeAsync(2000);

    expect(sendText).not.toHaveBeenCalled();
    expect(editText).not.toHaveBeenCalled();
  });

  it("throttles progress edits", async () => {
    vi.useFakeTimers();

    const sendText = vi.fn().mockResolvedValue(30);
    const editText = vi.fn().mockResolvedValue(undefined);
    const streamer = new CompactProgressStreamer({ throttleMs: 100, sendText, editText });

    streamer.updateActivity("s1", "first");
    streamer.updateActivity("s1", "second");

    expect(sendText).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith("s1", "⏳ Working\nsecond");
  });

  it("reads throttleMs again for the next flush cycle", async () => {
    vi.useFakeTimers();

    let throttleMs = 100;
    const sendText = vi.fn().mockResolvedValue(30);
    const editText = vi.fn().mockResolvedValue(undefined);
    const streamer = new CompactProgressStreamer({
      throttleMs: () => throttleMs,
      sendText,
      editText,
    });

    streamer.updateActivity("s1", "first");
    await vi.advanceTimersByTimeAsync(100);
    expect(sendText).toHaveBeenCalledTimes(1);

    throttleMs = 2000;
    streamer.updateActivity("s1", "second");
    await vi.advanceTimersByTimeAsync(1999);
    expect(editText).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(editText).toHaveBeenCalledTimes(1);
    expect(editText).toHaveBeenCalledWith("s1", 30, "⏳ Working\nsecond");
  });

  it("flushes a pending card before close so the summary edits that message", async () => {
    vi.useFakeTimers();

    const sendText = vi.fn().mockResolvedValue(40);
    const editText = vi.fn().mockResolvedValue(undefined);
    const streamer = new CompactProgressStreamer({ throttleMs: 5000, sendText, editText });

    streamer.updateActivity("s1", "working");
    expect(sendText).not.toHaveBeenCalled();

    await streamer.flushPending("s1");
    await streamer.finalize("s1");

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith("s1", "⏳ Working\nworking");
    expect(editText).toHaveBeenCalledWith(
      "s1",
      40,
      "✅ Finished Work\ntool calls: 0 · changed files: 0",
    );
  });

  it("holds activity that arrives before close and puts it on the next card", async () => {
    const sendText = vi.fn().mockResolvedValueOnce(50).mockResolvedValueOnce(51);
    const editText = vi.fn().mockResolvedValue(undefined);
    const streamer = new CompactProgressStreamer({ throttleMs: 0, sendText, editText });

    streamer.updateActivity("s1", "first");
    streamer.addToolCall("s1", "call-1");
    await new Promise((resolve) => setTimeout(resolve, 0));

    streamer.holdForClose("s1");
    streamer.updateActivity("s1", "second");
    streamer.addToolCall("s1", "call-2");
    await streamer.finalize("s1");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(editText).toHaveBeenCalledWith(
      "s1",
      50,
      "✅ Finished Work\ntool calls: 1 · changed files: 0",
    );
    expect(sendText).toHaveBeenCalledWith("s1", "⏳ Working\nsecond");
    expect(editText.mock.calls.some((call) => String(call[2]).includes("second"))).toBe(false);

    await streamer.finalize("s1");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(editText).toHaveBeenCalledWith(
      "s1",
      51,
      "✅ Finished Work\ntool calls: 1 · changed files: 0",
    );
  });

  it("drops held activity when the session is cleared", async () => {
    const sendText = vi.fn().mockResolvedValue(60);
    const editText = vi.fn().mockResolvedValue(undefined);
    const streamer = new CompactProgressStreamer({ throttleMs: 0, sendText, editText });

    streamer.updateActivity("s1", "working");
    await new Promise((resolve) => setTimeout(resolve, 0));
    streamer.holdForClose("s1");
    streamer.updateActivity("s1", "later");
    streamer.clearSession("s1", "assistant_finalize_failed");
    await streamer.finalize("s1");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(editText).not.toHaveBeenCalled();
  });

  it("coalesces flushes of a card that has not been sent yet", async () => {
    let releaseSend: (messageId: number) => void = () => {};
    const gate = new Promise<number>((resolve) => {
      releaseSend = resolve;
    });
    const sendText = vi.fn().mockReturnValue(gate);
    const editText = vi.fn().mockResolvedValue(undefined);
    const streamer = new CompactProgressStreamer({ throttleMs: 5000, sendText, editText });

    streamer.updateActivity("s1", "working");
    const firstFlush = streamer.flushPending("s1");
    const secondFlush = streamer.flushPending("s1");
    await Promise.resolve();
    await Promise.resolve();
    expect(sendText).toHaveBeenCalledTimes(1);

    releaseSend(70);
    await Promise.all([firstFlush, secondFlush]);
    expect(editText).not.toHaveBeenCalled();
  });

  it("does not send a finished summary when the card never landed", async () => {
    const sendText = vi.fn().mockRejectedValue(new Error("telegram down"));
    const editText = vi.fn().mockResolvedValue(undefined);
    const streamer = new CompactProgressStreamer({ throttleMs: 0, sendText, editText });

    streamer.updateActivity("s1", "working");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await streamer.finalize("s1");

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(editText).not.toHaveBeenCalled();
  });

  it("keeps a file change on the closing card instead of the next one", async () => {
    const sendText = vi.fn().mockResolvedValueOnce(80).mockResolvedValueOnce(81);
    const editText = vi.fn().mockResolvedValue(undefined);
    const streamer = new CompactProgressStreamer({ throttleMs: 0, sendText, editText });

    streamer.updateActivity("s1", "first");
    await new Promise((resolve) => setTimeout(resolve, 0));
    streamer.holdForClose("s1");
    streamer.addFileChange("s1", "src/a.ts");
    streamer.updateActivity("s1", "second");
    await streamer.finalize("s1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await streamer.finalize("s1");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(editText).toHaveBeenCalledWith(
      "s1",
      80,
      "✅ Finished Work\ntool calls: 0 · changed files: 1",
    );
    expect(editText).toHaveBeenCalledWith(
      "s1",
      81,
      "✅ Finished Work\ntool calls: 0 · changed files: 0",
    );
  });

  it("puts held activity back on the open card when the close is abandoned", async () => {
    const sendText = vi.fn().mockResolvedValue(90);
    const editText = vi.fn().mockResolvedValue(undefined);
    const streamer = new CompactProgressStreamer({ throttleMs: 0, sendText, editText });

    streamer.updateActivity("s1", "first");
    await new Promise((resolve) => setTimeout(resolve, 0));
    streamer.holdForClose("s1");
    streamer.updateActivity("s1", "still working");
    streamer.releaseHold("s1");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(editText).toHaveBeenCalledWith("s1", 90, "⏳ Working\nstill working");
  });
});
