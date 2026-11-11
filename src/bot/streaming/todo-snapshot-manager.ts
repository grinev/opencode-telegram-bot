import { formatCollapsedTodoSnapshot } from "../../app/formatters/summary-formatter.js";
import type { TodoSnapshotInfo } from "../../app/types/settings.js";
import { logger } from "../../utils/logger.js";

/** What one delivered todo snapshot shows and counts. */
export interface TodoSnapshot {
  text: string;
  done: number;
  total: number;
}

interface DeliveredSnapshot extends TodoSnapshot, TodoSnapshotInfo {
  /** Which call owns the message; absent for a record read back from settings. */
  callId?: string | undefined;
}

interface PendingSnapshot {
  sessionId: string;
  chatId: number;
  snapshot: TodoSnapshot;
}

interface TodoSnapshotManagerOptions {
  /** Hands one message to the chat after everything already on its way, if still wanted. */
  sendText: (
    sessionId: string,
    text: string,
    shouldSend: () => boolean,
  ) => Promise<number | null>;
  editText: (sessionId: string, messageId: number, text: string) => Promise<void>;
  getStoredSnapshot: () => TodoSnapshotInfo | undefined;
  storeSnapshot: (info: TodoSnapshotInfo) => Promise<void>;
}

/**
 * Keeps one full todo snapshot on screen: a new call opens a message of its own at the bottom,
 * the same call keeps editing it, and the delivery of a newer snapshot collapses the previous one
 * to a single line of counts. Everything else about the snapshot outlives turns, sessions and
 * restarts, so nothing here is cleared with the streams.
 */
export class TodoSnapshotManager {
  private readonly sendText: TodoSnapshotManagerOptions["sendText"];
  private readonly editText: TodoSnapshotManagerOptions["editText"];
  private readonly getStoredSnapshot: TodoSnapshotManagerOptions["getStoredSnapshot"];
  private readonly storeSnapshot: TodoSnapshotManagerOptions["storeSnapshot"];
  private readonly queues = new Map<number, Promise<void>>();
  private readonly desired = new Map<string, PendingSnapshot>();
  private readonly chats = new Map<string, number>();
  // Calls whose list must never be drawn again: collapsed into history, or undeliverable.
  private readonly closedCalls = new Set<string>();
  private lastDelivered: DeliveredSnapshot | null = null;
  private lastDeliveredLoaded = false;

  constructor(options: TodoSnapshotManagerOptions) {
    this.sendText = options.sendText;
    this.editText = options.editText;
    this.getStoredSnapshot = options.getStoredSnapshot;
    this.storeSnapshot = options.storeSnapshot;
  }

  /** Takes the latest state of a call's list; a call already closed keeps what it shows. */
  track(sessionId: string, callId: string, chatId: number, snapshot: TodoSnapshot): void {
    if (this.closedCalls.has(callId)) {
      return;
    }

    this.chats.set(sessionId, chatId);
    this.desired.set(callId, { sessionId, chatId, snapshot });
    this.enqueue(chatId, () => this.apply(callId));
  }

  /** Waits for the snapshots this session has in flight, so later output lands below them. */
  async flush(sessionId: string): Promise<void> {
    const chatId = this.chats.get(sessionId);
    if (chatId === undefined) {
      return;
    }

    await (this.queues.get(chatId) ?? Promise.resolve());
  }

  /**
   * Drops the snapshots still waiting for this session (or for all of them): they belong to work
   * the caller is ending. A snapshot already being sent still lands and stays the last one.
   */
  cancelPending(sessionId?: string): void {
    for (const [callId, pending] of Array.from(this.desired)) {
      if (sessionId === undefined || pending.sessionId === sessionId) {
        this.desired.delete(callId);
      }
    }
  }

  private enqueue(chatId: number, task: () => Promise<void>): void {
    const previous = this.queues.get(chatId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(task)
      .catch((error: unknown) => {
        logger.warn(`[TodoSnapshot] Snapshot operation failed: chat=${chatId}`, error);
      });
    this.queues.set(chatId, next);
    void next.finally(() => {
      if (this.queues.get(chatId) === next) {
        this.queues.delete(chatId);
      }
    });
  }

  private async apply(callId: string): Promise<void> {
    const pending = this.desired.get(callId);
    if (!pending || this.closedCalls.has(callId)) {
      return;
    }

    const delivered = this.lastDelivered;
    if (delivered?.callId === callId) {
      await this.refreshSameCall(delivered, pending);
      return;
    }

    await this.deliverNew(callId, pending);
  }

  /** The same call's message: only the visible text needs Telegram, the counters may not. */
  private async refreshSameCall(
    delivered: DeliveredSnapshot,
    pending: PendingSnapshot,
  ): Promise<void> {
    const { snapshot, sessionId } = pending;
    const countersChanged = delivered.done !== snapshot.done || delivered.total !== snapshot.total;

    if (delivered.text !== snapshot.text) {
      try {
        await this.editText(sessionId, delivered.messageId, snapshot.text);
      } catch (error) {
        // The counters stay as they were: they still describe what the chat shows.
        logger.warn(
          `[TodoSnapshot] Could not edit the running snapshot: message=${delivered.messageId}`,
          error,
        );
        return;
      }

      delivered.text = snapshot.text;
      delivered.done = snapshot.done;
      delivered.total = snapshot.total;
      this.persist(delivered);
      return;
    }

    if (countersChanged) {
      delivered.done = snapshot.done;
      delivered.total = snapshot.total;
      this.persist(delivered);
    }
  }

  private async deliverNew(callId: string, pending: PendingSnapshot): Promise<void> {
    let messageId: number | null;
    try {
      messageId = await this.sendText(pending.sessionId, pending.snapshot.text, () => {
        // A newer state of this call (or a cancel) took over while the message waited.
        return this.desired.get(callId) === pending;
      });
    } catch (error) {
      // The previous snapshot stays as it is; this call is not tried again.
      this.closedCalls.add(callId);
      this.desired.delete(callId);
      logger.warn(`[TodoSnapshot] Could not deliver a todo snapshot: call=${callId}`, error);
      return;
    }

    if (messageId === null) {
      return;
    }

    this.loadStoredSnapshot();
    const previous = this.lastDelivered;
    const delivered: DeliveredSnapshot = {
      ...pending.snapshot,
      callId,
      chatId: pending.chatId,
      messageId,
    };
    this.lastDelivered = delivered;
    this.persist(delivered);

    if (previous) {
      await this.collapse(pending.sessionId, previous, pending.chatId);
    }
  }

  /** The previous snapshot becomes one line of counts; a failure leaves both messages as sent. */
  private async collapse(
    sessionId: string,
    previous: DeliveredSnapshot,
    chatId: number,
  ): Promise<void> {
    if (previous.callId) {
      this.closedCalls.add(previous.callId);
      this.desired.delete(previous.callId);
    }

    if (previous.chatId !== chatId) {
      return;
    }

    try {
      await this.editText(
        sessionId,
        previous.messageId,
        formatCollapsedTodoSnapshot(previous.done, previous.total),
      );
    } catch (error) {
      logger.warn(
        `[TodoSnapshot] Could not collapse the previous snapshot: message=${previous.messageId}`,
        error,
      );
    }
  }

  private persist(delivered: DeliveredSnapshot): void {
    try {
      void this.storeSnapshot({
        chatId: delivered.chatId,
        messageId: delivered.messageId,
        done: delivered.done,
        total: delivered.total,
      }).catch((error: unknown) => {
        logger.warn(
          `[TodoSnapshot] Could not store the snapshot record: chat=${delivered.chatId}`,
          error,
        );
      });
    } catch (error) {
      logger.warn(`[TodoSnapshot] Could not store the snapshot record: chat=${delivered.chatId}`, error);
    }
  }

  private loadStoredSnapshot(): void {
    if (this.lastDeliveredLoaded) {
      return;
    }

    this.lastDeliveredLoaded = true;
    const stored = this.getStoredSnapshot();
    if (stored) {
      // Its call is unknown after a restart: the next snapshot collapses it like any other.
      this.lastDelivered = { ...stored, text: "" };
    }
  }
}
