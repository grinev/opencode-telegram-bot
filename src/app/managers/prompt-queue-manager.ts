import { logger } from "../../utils/logger.js";
import type { IncomingPrompt } from "../types/prompt.js";

export const MAX_QUEUED_PROMPTS = 5;
/** Maximum raw Telegram media bytes retained by all queued prompts. */
export const MAX_QUEUED_MEDIA_BYTES = 20 * 1024 * 1024;

export interface QueuedPrompt extends IncomingPrompt {
  id: string;
  displayText: string;
  responseMode?: "text_only" | "text_and_tts";
  mediaBytes: number;
}

export interface QueuedPromptInput extends IncomingPrompt {
  displayText?: string;
  responseMode?: "text_only" | "text_and_tts";
  /** Raw media bytes from Telegram file_size metadata, before base64 encoding. */
  mediaBytes?: number;
}

/**
 * Prompt Queue - holds prepared user prompts received while the session is busy.
 * Kept in memory only: queued messages must not survive a restart and leak into
 * a different session context.
 * Singleton pattern
 */
class PromptQueueManager {
  private items: QueuedPrompt[] = [];
  private nextId = 1;
  private queuedMediaBytes = 0;

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
    return this.items.length >= MAX_QUEUED_PROMPTS;
  }

  canAcceptMedia(mediaBytes: number): boolean {
    return mediaBytes >= 0 && this.queuedMediaBytes + mediaBytes <= MAX_QUEUED_MEDIA_BYTES;
  }

  mediaSize(): number {
    return this.queuedMediaBytes;
  }

  clear(reason: string): void {
    if (this.items.length === 0) {
      return;
    }

    logger.info(`[PromptQueue] Cleared queue: reason=${reason}, count=${this.items.length}`);
    this.items = [];
    this.queuedMediaBytes = 0;
  }

  __resetForTests(): void {
    this.items = [];
    this.nextId = 1;
    this.queuedMediaBytes = 0;
  }
}

export const promptQueue = new PromptQueueManager();

function copyQueuedPrompt(item: QueuedPrompt): QueuedPrompt {
  return {
    ...item,
    fileParts: [...item.fileParts],
    photos: [...item.photos],
  };
}
