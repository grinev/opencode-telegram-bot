import { afterEach, describe, expect, it, vi } from "vitest";
import { CompactProgressStreamer } from "../../../src/bot/streaming/compact-progress-streamer.js";

const READ = { commands: 0, edits: 0, reads: 1, tools: 0 };
const COMMAND = { commands: 1, edits: 0, reads: 0, tools: 0 };
const TOOL = { commands: 0, edits: 0, reads: 0, tools: 1 };

describe("bot/streaming/compact-progress-streamer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends one progress message and finalizes it in place", async () => {
    const sendText = vi.fn().mockResolvedValue(10);
    const editText = vi.fn().mockResolvedValue(undefined);
    const streamer = new CompactProgressStreamer({ throttleMs: 0, sendText, editText });

    streamer.updateActivity("s1", "working");
    streamer.addToolCall("s1", "call-1", READ);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await streamer.finalize("s1");

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith("s1", "⏳ Working\nworking");
    expect(editText).toHaveBeenCalledTimes(1);
    expect(editText).toHaveBeenCalledWith("s1", 10, "✅ reads: 1");
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
    streamer.addToolCall("s1", "call-1", COMMAND);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await streamer.finalize("s1", false);

    expect(deleteText).not.toHaveBeenCalled();
    expect(editText).toHaveBeenCalledTimes(1);
    expect(editText).toHaveBeenCalledWith("s1", 10, "✅ commands: 1");
  });

  it("removes a thinking-only card, which has nothing to count", async () => {
    const sendText = vi.fn().mockResolvedValue(10);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new CompactProgressStreamer({ throttleMs: 0, sendText, editText, deleteText });

    streamer.updateThinking("s1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await streamer.finalize("s1");

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith("s1", "⏳ Working\n💭 Thinking...");
    expect(editText).not.toHaveBeenCalled();
    expect(deleteText).toHaveBeenCalledWith("s1", 10);
  });

  it("removes a writing-only card, which has nothing to count", async () => {
    const sendText = vi.fn().mockResolvedValue(10);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new CompactProgressStreamer({ throttleMs: 0, sendText, editText, deleteText });

    streamer.updateResponding("s1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await streamer.finalize("s1");

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith("s1", "⏳ Working\n✍️ Writing answer...");
    expect(editText).not.toHaveBeenCalled();
    expect(deleteText).toHaveBeenCalledWith("s1", 10);
  });

  it("sends nothing for a zero-count card that was never sent", async () => {
    const sendText = vi.fn().mockResolvedValue(10);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new CompactProgressStreamer({ throttleMs: 5000, sendText, editText, deleteText });

    streamer.updateThinking("s1");
    await streamer.finalize("s1");

    expect(sendText).not.toHaveBeenCalled();
    expect(editText).not.toHaveBeenCalled();
    expect(deleteText).not.toHaveBeenCalled();
  });

  it("leaves a zero-count card as it is when its removal fails", async () => {
    const sendText = vi.fn().mockResolvedValue(10);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockRejectedValue(new Error("message can't be deleted"));
    const streamer = new CompactProgressStreamer({ throttleMs: 0, sendText, editText, deleteText });

    streamer.updateThinking("s1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await streamer.finalize("s1");

    expect(deleteText).toHaveBeenCalledWith("s1", 10);
    expect(editText).not.toHaveBeenCalled();
  });

  it("updates active progress when thinking starts", async () => {
    const sendText = vi.fn().mockResolvedValue(10);
    const editText = vi.fn().mockResolvedValue(undefined);
    const streamer = new CompactProgressStreamer({ throttleMs: 0, sendText, editText });

    streamer.updateActivity("s1", "reading");
    await new Promise((resolve) => setTimeout(resolve, 0));
    streamer.addToolCall("s1", "call-1", READ);

    streamer.updateThinking("s1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await streamer.finalize("s1");

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith("s1", "⏳ Working\nreading");
    expect(editText).toHaveBeenNthCalledWith(1, "s1", 10, "⏳ Working\n💭 Thinking...");
    expect(editText).toHaveBeenNthCalledWith(2, "s1", 10, "✅ reads: 1");
  });

  it("keeps thinking, a tool, and writing on one message", async () => {
    const sendText = vi.fn().mockResolvedValue(10);
    const editText = vi.fn().mockResolvedValue(undefined);
    const streamer = new CompactProgressStreamer({ throttleMs: 0, sendText, editText });

    streamer.updateThinking("s1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    streamer.updateActivity("s1", "reading");
    streamer.addToolCall("s1", "call-1", TOOL);
    await new Promise((resolve) => setTimeout(resolve, 0));
    streamer.updateResponding("s1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await streamer.finalize("s1");

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith("s1", "⏳ Working\n💭 Thinking...");
    expect(editText).toHaveBeenNthCalledWith(1, "s1", 10, "⏳ Working\nreading");
    expect(editText).toHaveBeenNthCalledWith(2, "s1", 10, "⏳ Working\n✍️ Writing answer...");
    expect(editText).toHaveBeenNthCalledWith(3, "s1", 10, "✅ tools: 1");
  });

  it("counts unique tool calls by category and changed files", async () => {
    const sendText = vi.fn().mockResolvedValue(20);
    const editText = vi.fn().mockResolvedValue(undefined);
    const streamer = new CompactProgressStreamer({ throttleMs: 100, sendText, editText });

    streamer.updateActivity("s1", "working");
    streamer.addToolCall("s1", "call-1", READ);
    streamer.addToolCall("s1", "call-1", READ);
    streamer.addToolCall("s1", "call-2", COMMAND);
    streamer.addFileChange("s1", "src/a.ts");
    streamer.addFileChange("s1", "src/a.ts");
    streamer.addFileChange("s1", "src/b.ts");

    await streamer.finalize("s1");

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith("s1", "✅ commands: 1, reads: 1, changed files: 2");
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

    expect(sendText.mock.calls.some((call) => String(call[1]).includes("run-a"))).toBe(true);
    expect(sendText.mock.calls.some((call) => String(call[1]).includes("💭 Thinking..."))).toBe(true);
  });

  it("finalizes a second run while the first card is still being finalized", async () => {
    const sendText = vi.fn().mockImplementation(async (_sessionId: string, _text: string) => {
      return sendText.mock.calls.length * 10;
    });
    const editText = vi.fn().mockResolvedValue(undefined);
    const streamer = new CompactProgressStreamer({ throttleMs: 0, sendText, editText });

    streamer.updateActivity("s1", "run-a");
    streamer.addToolCall("s1", "call-a", READ);
    const firstFinalize = streamer.finalize("s1");
    streamer.updateThinking("s1");
    streamer.addToolCall("s1", "call-b", READ);
    const secondFinalize = streamer.finalize("s1");
    await Promise.all([firstFinalize, secondFinalize]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendText.mock.calls.some((call) => String(call[1]).includes("run-a"))).toBe(true);
    expect(sendText.mock.calls.some((call) => String(call[1]).includes("💭 Thinking..."))).toBe(true);
    expect(editText).toHaveBeenCalledTimes(2);
    expect(editText.mock.calls.every((call) => call[2] === "✅ reads: 1")).toBe(true);
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
    streamer.addToolCall("s1", "call-1", READ);
    expect(sendText).not.toHaveBeenCalled();

    await streamer.flushPending("s1");
    await streamer.finalize("s1");

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith("s1", "⏳ Working\nworking");
    expect(editText).toHaveBeenCalledWith("s1", 40, "✅ reads: 1");
  });

  it("holds activity that arrives before close and puts it on the next card", async () => {
    const sendText = vi.fn().mockResolvedValueOnce(50).mockResolvedValueOnce(51);
    const editText = vi.fn().mockResolvedValue(undefined);
    const streamer = new CompactProgressStreamer({ throttleMs: 0, sendText, editText });

    streamer.updateActivity("s1", "first");
    streamer.addToolCall("s1", "call-1", READ);
    await new Promise((resolve) => setTimeout(resolve, 0));

    streamer.holdForClose("s1");
    streamer.updateActivity("s1", "second");
    streamer.addToolCall("s1", "call-2", COMMAND);
    await streamer.finalize("s1");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(editText).toHaveBeenCalledWith("s1", 50, "✅ reads: 1");
    expect(sendText).toHaveBeenCalledWith("s1", "⏳ Working\nsecond");
    expect(editText.mock.calls.some((call) => String(call[2]).includes("second"))).toBe(false);

    await streamer.finalize("s1");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(editText).toHaveBeenCalledWith("s1", 51, "✅ commands: 1");
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

    expect(editText).toHaveBeenCalledWith("s1", 80, "✅ changed files: 1");
    expect(editText.mock.calls.some((call) => call[1] === 81)).toBe(false);
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

  describe("background operations", () => {
    function createStreamer() {
      let nextId = 10;
      const sendText = vi.fn(async (_sessionId: string, _text: string) => nextId++);
      const editText = vi.fn(
        async (_sessionId: string, _messageId: number, _text: string) => undefined,
      );
      const deleteText = vi.fn(async (_sessionId: string, _messageId: number) => undefined);
      const onPark = vi.fn();
      const streamer = new CompactProgressStreamer({
        throttleMs: 0,
        sendText,
        editText,
        deleteText,
        onPark,
      });
      return { streamer, sendText, editText, deleteText, onPark };
    }

    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

    it("promotes old and new calls onto their own cards while a reply is held", async () => {
      const { streamer, sendText, editText, onPark } = createStreamer();
      streamer.registerToolCall("s1", "old", true);
      streamer.updateActivity("s1", "old task", "old");
      await tick();

      streamer.holdForClose("s1");
      streamer.registerToolCall("s1", "new", true);
      streamer.addBackgroundOperation("s1", "new", "new task");
      streamer.updateActivity("s1", "new task", "new");
      streamer.addBackgroundOperation("s1", "old", "old task");
      streamer.updateActivity("s1", "old task · 🕒 20s", "old");
      await streamer.finalize("s1");
      await tick();

      expect(onPark).toHaveBeenCalledExactlyOnceWith("s1", ["old"]);
      expect(sendText).toHaveBeenNthCalledWith(2, "s1", "⏳ Working\nnew task");
      await streamer.endBackgroundOperation("s1", "old", TOOL);
      expect(editText).toHaveBeenLastCalledWith("s1", 10, "✅ tools: 1");

      await streamer.endBackgroundOperation("s1", "new", TOOL);
      await streamer.finalize("s1");
      expect(editText).toHaveBeenLastCalledWith("s1", 11, "✅ tools: 1");
    });

    it("shows parked background calls by start order, not promotion order", async () => {
      const { streamer, sendText, editText } = createStreamer();
      streamer.registerToolCall("s1", "earlier", true);
      streamer.registerToolCall("s1", "later", true);
      streamer.updateActivity("s1", "working");
      await tick();

      streamer.addBackgroundOperation("s1", "later", "later task");
      streamer.addBackgroundOperation("s1", "earlier", "earlier task");
      await streamer.finalize("s1");
      await tick();
      expect(editText).toHaveBeenLastCalledWith("s1", 10, "⏳ Working\nlater task");

      await streamer.endBackgroundOperation("s1", "later", TOOL);
      await tick();
      expect(editText).toHaveBeenLastCalledWith("s1", 10, "⏳ Working\nearlier task");
      await streamer.endBackgroundOperation("s1", "earlier", TOOL);
      expect(editText).toHaveBeenLastCalledWith("s1", 10, "✅ tools: 2");
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    it("keeps a card with a running background operation open past its close", async () => {
      const { streamer, editText, onPark } = createStreamer();

      streamer.updateActivity("s1", "bash sleep 90");
      streamer.addBackgroundOperation("s1", "call-bg", "bash sleep 90");
      await tick();
      await streamer.finalize("s1");
      streamer.updateBackgroundOperation("s1", "call-bg", "bash sleep 90 · 🕒 30s");
      await tick();

      expect(onPark).toHaveBeenCalledWith("s1", ["call-bg"]);
      expect(editText).toHaveBeenLastCalledWith("s1", 10, "⏳ Working\nbash sleep 90 · 🕒 30s");
      expect(editText.mock.calls.some((call) => !call[2].startsWith("⏳ Working"))).toBe(false);
    });

    it("opens a new card for the next stretch while the parked one stays", async () => {
      const { streamer, sendText, editText, deleteText } = createStreamer();

      streamer.addBackgroundOperation("s1", "call-bg", "bash sleep 90");
      streamer.updateActivity("s1", "bash sleep 90");
      await tick();
      await streamer.finalize("s1");
      streamer.updateActivity("s1", "💭 Thinking...");
      await tick();
      await streamer.finalize("s1");

      expect(sendText).toHaveBeenCalledTimes(2);
      expect(deleteText).toHaveBeenCalledWith("s1", 11);
      expect(deleteText).not.toHaveBeenCalledWith("s1", 10);
      expect(editText.mock.calls.some((call) => call[1] === 10 && !call[2].startsWith("⏳"))).toBe(
        false,
      );
    });

    it("closes the parked card with its own counts when the operation ends", async () => {
      const { streamer, editText } = createStreamer();

      streamer.updateActivity("s1", "bash sleep 90");
      streamer.addToolCall("s1", "call-read", READ);
      streamer.addBackgroundOperation("s1", "call-bg", "bash sleep 90");
      await tick();
      await streamer.finalize("s1");
      await streamer.endBackgroundOperation("s1", "call-bg", COMMAND);

      expect(editText).toHaveBeenLastCalledWith("s1", 10, "✅ commands: 1, reads: 1");
    });

    it("deletes the parked card when the operation ends with delete on finish", async () => {
      const { streamer, deleteText } = createStreamer();

      streamer.addBackgroundOperation("s1", "call-bg", "bash sleep 90");
      streamer.updateActivity("s1", "bash sleep 90");
      await tick();
      await streamer.finalize("s1", true);
      expect(deleteText).not.toHaveBeenCalled();

      await streamer.endBackgroundOperation("s1", "call-bg", COMMAND, true);
      expect(deleteText).toHaveBeenCalledWith("s1", 10);
    });

    it("falls back to the operation still running when the newest one ends", async () => {
      const { streamer, editText } = createStreamer();

      streamer.updateActivity("s1", "second");
      streamer.addBackgroundOperation("s1", "call-1", "first");
      streamer.addBackgroundOperation("s1", "call-2", "second");
      await tick();
      await streamer.finalize("s1");
      await streamer.endBackgroundOperation("s1", "call-2", COMMAND);
      await tick();

      expect(editText).toHaveBeenLastCalledWith("s1", 10, "⏳ Working\nfirst");
    });

    it("leaves a parked card as it is once its operations are dropped", async () => {
      const { streamer, editText } = createStreamer();

      streamer.updateActivity("s1", "bash sleep 90");
      streamer.addBackgroundOperation("s1", "call-bg", "bash sleep 90");
      await tick();
      await streamer.finalize("s1");
      await tick();
      const editsBefore = editText.mock.calls.length;
      streamer.dropBackgroundOperations("s1");
      streamer.updateBackgroundOperation("s1", "call-bg", "bash sleep 90 · 🕒 1m");
      await streamer.endBackgroundOperation("s1", "call-bg", COMMAND);

      expect(editText).toHaveBeenCalledTimes(editsBefore);
    });

    it("keeps parked cards when only the open card is discarded", async () => {
      const { streamer, editText } = createStreamer();

      streamer.updateActivity("s1", "bash sleep 90");
      streamer.addBackgroundOperation("s1", "call-bg", "bash sleep 90");
      await tick();
      await streamer.finalize("s1");
      streamer.updateActivity("s1", "next");
      streamer.discardOpenCard("s1", "session_error");
      await streamer.endBackgroundOperation("s1", "call-bg", COMMAND);

      expect(editText).toHaveBeenLastCalledWith("s1", 10, "✅ commands: 1");
    });
  });
});
