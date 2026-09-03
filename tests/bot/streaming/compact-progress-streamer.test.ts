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

  it("does not create a message for thinking-only activity", async () => {
    const sendText = vi.fn().mockResolvedValue(10);
    const editText = vi.fn().mockResolvedValue(undefined);
    const streamer = new CompactProgressStreamer({ throttleMs: 0, sendText, editText });

    streamer.updateThinking("s1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await streamer.finalize("s1");

    expect(sendText).not.toHaveBeenCalled();
    expect(editText).not.toHaveBeenCalled();
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
});
