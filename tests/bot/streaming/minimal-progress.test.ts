import { afterEach, describe, expect, it, vi } from "vitest";
import { MinimalProgress } from "../../../src/bot/streaming/minimal-progress.js";
import type { TelegramDestination } from "../../../src/bot/events/telegram-event-delivery.js";

const destination = { chatId: 42 } as TelegramDestination;

function setup() {
  const sendText = vi.fn().mockResolvedValue(100);
  const deleteText = vi.fn().mockResolvedValue(undefined);
  return { progress: new MinimalProgress({ sendText, deleteText }), sendText, deleteText };
}

describe("minimal progress", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not wait for a pending send and deletes it when it lands after detach", async () => {
    const { progress, sendText, deleteText } = setup();
    let finishSend!: (id: number) => void;
    sendText.mockReturnValueOnce(
      new Promise<number>((resolve) => {
        finishSend = resolve;
      }),
    );

    progress.activity("previous", destination, false);
    progress.clear("previous");
    progress.activity("next", destination, false);
    expect(deleteText).not.toHaveBeenCalled();
    finishSend(89);
    await Promise.resolve();

    expect(deleteText).toHaveBeenCalledExactlyOnceWith(destination, 89);
    expect(sendText).toHaveBeenCalledTimes(2);
  });

  it("lets the response through after a deletion fails and retries the captured ID", async () => {
    vi.useFakeTimers();
    const { progress, deleteText } = setup();
    deleteText.mockRejectedValueOnce({ error_code: 503 });
    progress.activity("session", destination, false);
    progress.trackReply("session", "reply");
    await Promise.resolve();

    await progress.beforeReply("session", "reply");
    expect(deleteText).toHaveBeenCalledTimes(1);
    progress.completeReply("session", "reply");
    progress.activity("session", destination, false);
    await vi.runAllTimersAsync();

    expect(deleteText.mock.calls).toEqual([[destination, 100], [destination, 100]]);
  });

  it("respects each Telegram retry-after while the reply and stale cleanup proceed separately", async () => {
    vi.useFakeTimers();
    const { progress, deleteText } = setup();
    deleteText
      .mockRejectedValueOnce({ error_code: 429, parameters: { retry_after: 5 } })
      .mockRejectedValueOnce({ error_code: 429, parameters: { retry_after: 10 } });
    progress.activity("session", destination, false);
    progress.trackReply("session", "reply");
    await Promise.resolve();

    await progress.beforeReply("session", "reply");
    progress.clear("session");
    await vi.advanceTimersByTimeAsync(4_999);
    expect(deleteText).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(deleteText).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(deleteText).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(deleteText.mock.calls).toEqual([
      [destination, 100],
      [destination, 100],
      [destination, 100],
    ]);
  });

  it("does not hold reply delivery behind an indefinitely slow deletion", async () => {
    vi.useFakeTimers();
    const { progress, deleteText } = setup();
    deleteText.mockReturnValueOnce(new Promise(() => {}));
    progress.activity("session", destination, false);
    progress.trackReply("session", "reply");
    await Promise.resolve();

    const delivered = vi.fn();
    void progress.beforeReply("session", "reply")?.then(delivered);
    expect(deleteText).toHaveBeenCalledTimes(1);
    expect(delivered).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();

    expect(delivered).toHaveBeenCalledTimes(1);
  });

  it("does not let a late end or an already visible reply take a fresh marker", async () => {
    const { progress, sendText, deleteText } = setup();
    sendText.mockResolvedValueOnce(100).mockResolvedValueOnce(101);
    progress.activity("session", destination, false);
    progress.trackReply("session", "reply");
    await Promise.resolve();
    const oldEnd = progress.captureEnd("session");
    await progress.beforeReply("session", "reply");
    progress.completeReply("session", "reply");
    progress.activity("session", destination, false);
    await Promise.resolve();

    await oldEnd?.();
    await progress.beforeReply("session", "reply");
    expect(deleteText).toHaveBeenCalledExactlyOnceWith(destination, 100);
    progress.clear("session");
    expect(deleteText).toHaveBeenLastCalledWith(destination, 101);
  });

  it("holds fresh work behind delivery and associates the next reply with its own marker", async () => {
    const { progress, sendText, deleteText } = setup();
    sendText.mockResolvedValueOnce(100).mockResolvedValueOnce(101);
    progress.activity("session", destination, false, { messageId: "first" });
    progress.trackReply("session", "first");
    progress.beginReplyCompletion("session", "first");
    progress.activity("session", destination, false, { messageId: "next" });
    progress.trackReply("session", "next");
    await Promise.resolve();
    expect(sendText).toHaveBeenCalledTimes(1);

    await progress.beforeReply("session", "first");
    progress.completeReply("session", "first");
    await Promise.resolve();
    await progress.beforeReply("session", "next");

    expect(sendText).toHaveBeenCalledTimes(2);
    expect(deleteText.mock.calls).toEqual([[destination, 100], [destination, 101]]);
  });
});
