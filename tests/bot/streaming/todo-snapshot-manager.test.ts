import { describe, expect, it, vi } from "vitest";
import { TodoSnapshotManager } from "../../../src/bot/streaming/todo-snapshot-manager.js";
import type { TodoSnapshotInfo } from "../../../src/app/types/settings.js";

const SNAPSHOT = "📝 todowrite (2)\n\n✅ Read the README\n🔲 Write a summary";
const UPDATED_SNAPSHOT = "📝 todowrite (2)\n\n✅ Read the README\n✅ Write a summary";
const LATE_SNAPSHOT = "📝 todowrite (3)\n\n✅ Read the README\n✅ Write a summary\n🔲 Ship it";

interface ManagerOptions {
  sendText: (
    sessionId: string,
    text: string,
    shouldSend: () => boolean,
  ) => Promise<number | null>;
  editText: (sessionId: string, messageId: number, text: string) => Promise<void>;
  getStoredSnapshot: () => TodoSnapshotInfo | undefined;
  storeSnapshot: (info: TodoSnapshotInfo) => Promise<void>;
}

function createManager(overrides: Partial<ManagerOptions> = {}) {
  const sendText = vi.fn(
    async (_sessionId: string, _text: string, _shouldSend: () => boolean) => 100,
  );
  const editText = vi.fn(async (_sessionId: string, _messageId: number, _text: string) => {});
  const storeSnapshot = vi.fn(async (_info: TodoSnapshotInfo) => {});
  const getStoredSnapshot = vi.fn((): TodoSnapshotInfo | undefined => undefined);
  const manager = new TodoSnapshotManager({
    sendText,
    editText,
    getStoredSnapshot,
    storeSnapshot,
    ...overrides,
  });

  return { manager, sendText, editText, storeSnapshot, getStoredSnapshot };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("TodoSnapshotManager", () => {
  it("opens one message for a new call and stores its record", async () => {
    const { manager, sendText, editText, storeSnapshot } = createManager();

    manager.track("s1", "call-1", 42, { text: SNAPSHOT, done: 1, total: 2 });

    await vi.waitFor(() => {
      expect(storeSnapshot).toHaveBeenCalledWith({
        chatId: 42,
        messageId: 100,
        done: 1,
        total: 2,
      });
    });
    expect(sendText).toHaveBeenCalledWith("s1", SNAPSHOT, expect.any(Function));
    expect(editText).not.toHaveBeenCalled();
  });

  it("edits the same call's message in place and refreshes its counters", async () => {
    const { manager, sendText, editText, storeSnapshot } = createManager();

    manager.track("s1", "call-1", 42, { text: SNAPSHOT, done: 1, total: 2 });
    await vi.waitFor(() => expect(storeSnapshot).toHaveBeenCalledTimes(1));

    manager.track("s1", "call-1", 42, { text: UPDATED_SNAPSHOT, done: 2, total: 2 });

    await vi.waitFor(() => {
      expect(editText).toHaveBeenCalledWith("s1", 100, UPDATED_SNAPSHOT);
      expect(storeSnapshot).toHaveBeenLastCalledWith({
        chatId: 42,
        messageId: 100,
        done: 2,
        total: 2,
      });
    });
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  it("collapses the previous snapshot when a new call opens its own", async () => {
    const { manager, sendText, editText, storeSnapshot } = createManager();
    sendText.mockResolvedValueOnce(100).mockResolvedValueOnce(101);

    manager.track("s1", "call-1", 42, { text: SNAPSHOT, done: 1, total: 3 });
    await vi.waitFor(() => expect(storeSnapshot).toHaveBeenCalledTimes(1));

    manager.track("s1", "call-2", 42, { text: UPDATED_SNAPSHOT, done: 0, total: 2 });

    await vi.waitFor(() => {
      expect(editText).toHaveBeenCalledWith("s1", 100, "📝 todowrite (1/3)");
      expect(storeSnapshot).toHaveBeenLastCalledWith({
        chatId: 42,
        messageId: 101,
        done: 0,
        total: 2,
      });
    });
    expect(sendText).toHaveBeenCalledTimes(2);
  });

  it("stores counters that changed without a visible edit", async () => {
    const { manager, editText, storeSnapshot } = createManager();

    manager.track("s1", "call-1", 42, { text: SNAPSHOT, done: 1, total: 3 });
    await vi.waitFor(() => expect(storeSnapshot).toHaveBeenCalledTimes(1));

    manager.track("s1", "call-1", 42, { text: SNAPSHOT, done: 2, total: 3 });

    await vi.waitFor(() => {
      expect(storeSnapshot).toHaveBeenLastCalledWith({
        chatId: 42,
        messageId: 100,
        done: 2,
        total: 3,
      });
    });
    expect(editText).not.toHaveBeenCalled();
  });

  it("keeps the previous counters when the edit fails", async () => {
    const { manager, editText, storeSnapshot } = createManager();
    editText.mockRejectedValueOnce(new Error("Too Many Requests: 429"));

    manager.track("s1", "call-1", 42, { text: SNAPSHOT, done: 1, total: 2 });
    await vi.waitFor(() => expect(storeSnapshot).toHaveBeenCalledTimes(1));

    manager.track("s1", "call-1", 42, { text: UPDATED_SNAPSHOT, done: 2, total: 2 });

    await vi.waitFor(() => expect(editText).toHaveBeenCalledTimes(1));
    await settle();
    expect(storeSnapshot).toHaveBeenCalledTimes(1);
  });

  it("leaves the previous snapshot alone when the new one cannot be delivered", async () => {
    const { manager, sendText, editText, storeSnapshot } = createManager();
    sendText.mockRejectedValueOnce(new Error("Bad Request: message is too long"));

    manager.track("s1", "call-1", 42, { text: SNAPSHOT, done: 1, total: 2 });

    await vi.waitFor(() => expect(sendText).toHaveBeenCalledTimes(1));
    await settle();
    expect(editText).not.toHaveBeenCalled();
    expect(storeSnapshot).not.toHaveBeenCalled();

    manager.track("s1", "call-1", 42, { text: UPDATED_SNAPSHOT, done: 2, total: 2 });
    await settle();
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  it("keeps the delivered snapshot when the collapse fails", async () => {
    const { manager, sendText, editText, storeSnapshot } = createManager();
    sendText.mockResolvedValueOnce(100).mockResolvedValueOnce(101);
    editText.mockRejectedValueOnce(new Error("Bad Request: message to edit not found"));

    manager.track("s1", "call-1", 42, { text: SNAPSHOT, done: 1, total: 2 });
    await vi.waitFor(() => expect(storeSnapshot).toHaveBeenCalledTimes(1));

    manager.track("s1", "call-2", 42, { text: UPDATED_SNAPSHOT, done: 0, total: 2 });

    await vi.waitFor(() => {
      expect(storeSnapshot).toHaveBeenLastCalledWith({
        chatId: 42,
        messageId: 101,
        done: 0,
        total: 2,
      });
    });
    expect(editText).toHaveBeenCalledTimes(1);
  });

  it("ignores later events of a call whose snapshot was collapsed", async () => {
    const { manager, sendText, editText, storeSnapshot } = createManager();
    sendText.mockResolvedValueOnce(100).mockResolvedValueOnce(101);

    manager.track("s1", "call-1", 42, { text: SNAPSHOT, done: 1, total: 2 });
    await vi.waitFor(() => expect(storeSnapshot).toHaveBeenCalledTimes(1));
    manager.track("s1", "call-2", 42, { text: UPDATED_SNAPSHOT, done: 0, total: 2 });
    await vi.waitFor(() => expect(editText).toHaveBeenCalledTimes(1));

    manager.track("s1", "call-1", 42, { text: LATE_SNAPSHOT, done: 2, total: 2 });
    await settle();

    expect(editText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledTimes(2);
  });

  it("collapses the record left by an earlier run", async () => {
    const { manager, sendText, editText, storeSnapshot } = createManager({
      getStoredSnapshot: () => ({ chatId: 42, messageId: 77, done: 2, total: 3 }),
    });
    sendText.mockResolvedValueOnce(100);

    manager.track("s1", "call-new", 42, { text: SNAPSHOT, done: 0, total: 2 });

    await vi.waitFor(() => {
      expect(editText).toHaveBeenCalledWith("s1", 77, "📝 todowrite (2/3)");
    });
    expect(storeSnapshot).toHaveBeenCalledWith({
      chatId: 42,
      messageId: 100,
      done: 0,
      total: 2,
    });
  });

  it("does not edit a record that belongs to another chat", async () => {
    const { manager, sendText, editText, storeSnapshot } = createManager({
      getStoredSnapshot: () => ({ chatId: 7, messageId: 77, done: 2, total: 3 }),
    });
    sendText.mockResolvedValueOnce(100);

    manager.track("s1", "call-new", 42, { text: SNAPSHOT, done: 0, total: 2 });

    await vi.waitFor(() => expect(storeSnapshot).toHaveBeenCalledTimes(1));
    expect(editText).not.toHaveBeenCalled();
    expect(storeSnapshot).toHaveBeenCalledWith({
      chatId: 42,
      messageId: 100,
      done: 0,
      total: 2,
    });
  });

  it("applies an update that arrived while the first message was being sent", async () => {
    let deliver: (messageId: number) => void = () => {};
    const sendText = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          deliver = resolve;
        }),
    );
    const { manager, editText, storeSnapshot } = createManager({ sendText });

    manager.track("s1", "call-1", 42, { text: SNAPSHOT, done: 1, total: 2 });
    await vi.waitFor(() => expect(sendText).toHaveBeenCalledTimes(1));

    manager.track("s1", "call-1", 42, { text: UPDATED_SNAPSHOT, done: 2, total: 2 });
    deliver(100);

    await vi.waitFor(() => {
      expect(editText).toHaveBeenCalledWith("s1", 100, UPDATED_SNAPSHOT);
      expect(storeSnapshot).toHaveBeenLastCalledWith({
        chatId: 42,
        messageId: 100,
        done: 2,
        total: 2,
      });
    });
  });

  it("waits for an in-flight snapshot when flushed", async () => {
    let deliver: (messageId: number) => void = () => {};
    const sendText = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          deliver = resolve;
        }),
    );
    const { manager } = createManager({ sendText });

    manager.track("s1", "call-1", 42, { text: SNAPSHOT, done: 1, total: 2 });
    await vi.waitFor(() => expect(sendText).toHaveBeenCalledTimes(1));

    let flushed = false;
    const flushing = manager.flush("s1").then(() => {
      flushed = true;
    });
    await settle();
    expect(flushed).toBe(false);

    deliver(100);
    await flushing;
    expect(flushed).toBe(true);
  });

  it("drops a snapshot still waiting when the session is cancelled", async () => {
    const { manager, sendText } = createManager();

    manager.track("s1", "call-1", 42, { text: SNAPSHOT, done: 1, total: 2 });
    manager.cancelPending("s1");
    await settle();

    expect(sendText).not.toHaveBeenCalled();
  });

  it("does not deliver a snapshot cancelled while it waited", async () => {
    let shouldSend: () => boolean = () => true;
    let deliver: (messageId: number | null) => void = () => {};
    const sendText = vi.fn(
      (_sessionId: string, _text: string, predicate: () => boolean) => {
        shouldSend = predicate;
        return new Promise<number | null>((resolve) => {
          deliver = resolve;
        });
      },
    );
    const { manager, storeSnapshot } = createManager({ sendText });

    manager.track("s1", "call-1", 42, { text: SNAPSHOT, done: 1, total: 2 });
    await vi.waitFor(() => expect(sendText).toHaveBeenCalledTimes(1));

    manager.cancelPending("s1");
    expect(shouldSend()).toBe(false);

    deliver(null);
    await settle();
    expect(storeSnapshot).not.toHaveBeenCalled();
  });
});
