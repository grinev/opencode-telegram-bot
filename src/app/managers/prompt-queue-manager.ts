import { logger } from "../../utils/logger.js";
import type { IncomingPrompt } from "../types/prompt.js";

export const MAX_QUEUED_PROMPTS = 5;
/** Maximum raw Telegram media bytes retained by all queued prompts. */
export const MAX_QUEUED_MEDIA_BYTES = 20 * 1024 * 1024;

/** Number of recently delivered, unmatched OpenCode inbox ids kept for late admissions. */
const MAX_REMEMBERED_DELIVERED_INBOX_IDS = 20;

/** Where a prompt waits in the OpenCode V2 session inbox. */
export interface QueuedPromptInbox {
  sessionId: string;
  inboxId: string;
  delivery: "steer" | "queue";
}

export interface QueuedPrompt extends IncomingPrompt {
  id: string;
  displayText: string;
  responseMode?: "text_only" | "text_and_tts";
  mediaBytes: number;
  /** Set when the prompt waits in OpenCode rather than in the bot: this item only mirrors it. */
  inbox?: QueuedPromptInbox;
}

export interface InboxPromptInput {
  displayText: string;
  responseMode?: "text_only" | "text_and_tts";
  inbox: QueuedPromptInbox;
}

export interface QueuedPromptInput extends IncomingPrompt {
  displayText?: string;
  responseMode?: "text_only" | "text_and_tts";
  /** Raw media bytes from Telegram file_size metadata, before base64 encoding. */
  mediaBytes?: number;
}

/**
 * Prompt Queue - holds prepared user prompts received while the session is busy.
 * On OpenCode V2 the prompts wait in the session inbox instead, and the items only
 * mirror them; an admission still on its way to OpenCode holds a reservation so the
 * cap counts it and a clear can withdraw it.
 * Kept in memory only: queued messages must not survive a restart and leak into
 * a different session context.
 * Singleton pattern
 */
class PromptQueueManager {
  private items: QueuedPrompt[] = [];
  private nextId = 1;
  private queuedMediaBytes = 0;
  private reservations = new Set<string>();
  private deliveredInboxIds: string[] = [];

  add(input: QueuedPromptInput): QueuedPrompt | null {
    const normalizedText = input.text.trim();
    const displayText = (input.displayText ?? (normalizedText || "[Attachment]")).trim();
    const mediaBytes = input.mediaBytes ?? 0;
    if (
      (!normalizedText && input.fileParts.length === 0 && input.photos.length === 0) ||
      !displayText ||
      this.isFull() ||
      !this.canAcceptMedia(mediaBytes)
    ) {
      return null;
    }

    const item: QueuedPrompt = {
      id: `queued-${this.nextId++}`,
      text: normalizedText,
      fileParts: [...input.fileParts],
      photos: [...input.photos],
      displayText,
      mediaBytes,
      ...(input.responseMode ? { responseMode: input.responseMode } : {}),
    };
    this.items.push(item);
    this.queuedMediaBytes += mediaBytes;
    logger.debug(`[PromptQueue] Prompt queued: id=${item.id}, size=${this.items.length}`);
    return item;
  }

  /** Holds a slot for an admission to OpenCode; null when the queue is full. */
  reserve(): string | null {
    if (this.isFull()) {
      return null;
    }
    const reservationId = `reserved-${this.nextId++}`;
    this.reservations.add(reservationId);
    return reservationId;
  }

  /**
   * Turns a reservation into a mirror item. Returns null when the reservation is gone:
   * the queue was cleared while the admission was on its way.
   */
  confirmReservation(reservationId: string, input: InboxPromptInput): QueuedPrompt | null {
    if (!this.reservations.delete(reservationId)) {
      return null;
    }

    const item: QueuedPrompt = {
      id: `queued-${this.nextId++}`,
      text: "",
      fileParts: [],
      photos: [],
      displayText: input.displayText.trim() || "[Attachment]",
      mediaBytes: 0,
      inbox: { ...input.inbox },
      ...(input.responseMode ? { responseMode: input.responseMode } : {}),
    };
    this.items.push(item);
    logger.debug(
      `[PromptQueue] Inbox prompt mirrored: id=${item.id}, inboxId=${input.inbox.inboxId}, size=${this.items.length}`,
    );
    return item;
  }

  /** Releases a reservation; returns false when a clear already dropped it. */
  releaseReservation(reservationId: string): boolean {
    return this.reservations.delete(reservationId);
  }

  findByInboxId(inboxId: string): QueuedPrompt | null {
    const item = this.items.find((candidate) => candidate.inbox?.inboxId === inboxId);
    return item ? copyQueuedPrompt(item) : null;
  }

  /** Remembers an inbox id delivered before any item carried it. */
  rememberDeliveredInboxId(inboxId: string): void {
    this.deliveredInboxIds.push(inboxId);
    if (this.deliveredInboxIds.length > MAX_REMEMBERED_DELIVERED_INBOX_IDS) {
      this.deliveredInboxIds.shift();
    }
  }

  wasInboxIdDelivered(inboxId: string): boolean {
    return this.deliveredInboxIds.includes(inboxId);
  }

  list(): QueuedPrompt[] {
    return this.items.map(copyQueuedPrompt);
  }

  removeById(id: string): QueuedPrompt | null {
    const index = this.items.findIndex((item) => item.id === id);
    if (index < 0) {
      return null;
    }

    const [removed] = this.items.splice(index, 1);
    if (!removed) {
      return null;
    }
    this.queuedMediaBytes -= removed.mediaBytes;
    logger.debug(
      `[PromptQueue] Prompt removed: id=${removed.id}, position=${index + 1}, size=${this.items.length}`,
    );
    return removed;
  }

  takeNext(): QueuedPrompt | null {
    const item = this.items.shift() ?? null;
    if (item) {
      this.queuedMediaBytes -= item.mediaBytes;
      logger.debug(`[PromptQueue] Prompt taken: id=${item.id}, size=${this.items.length}`);
    }
    return item;
  }

  size(): number {
    return this.items.length;
  }

  isFull(): boolean {
    return this.items.length + this.reservations.size >= MAX_QUEUED_PROMPTS;
  }

  canAcceptMedia(mediaBytes: number): boolean {
    return mediaBytes >= 0 && this.queuedMediaBytes + mediaBytes <= MAX_QUEUED_MEDIA_BYTES;
  }

  mediaSize(): number {
    return this.queuedMediaBytes;
  }

  /** Empties the queue, reservations included, and returns the items it removed. */
  clear(reason: string): QueuedPrompt[] {
    this.deliveredInboxIds = [];
    if (this.items.length === 0 && this.reservations.size === 0) {
      return [];
    }

    logger.info(
      `[PromptQueue] Cleared queue: reason=${reason}, count=${this.items.length}, reservations=${this.reservations.size}`,
    );
    const removed = this.items;
    this.items = [];
    this.reservations.clear();
    this.queuedMediaBytes = 0;
    return removed;
  }

  __resetForTests(): void {
    this.items = [];
    this.nextId = 1;
    this.queuedMediaBytes = 0;
    this.reservations.clear();
    this.deliveredInboxIds = [];
  }
}

export const promptQueue = new PromptQueueManager();

function copyQueuedPrompt(item: QueuedPrompt): QueuedPrompt {
  return {
    ...item,
    fileParts: [...item.fileParts],
    photos: [...item.photos],
    ...(item.inbox ? { inbox: { ...item.inbox } } : {}),
  };
}
