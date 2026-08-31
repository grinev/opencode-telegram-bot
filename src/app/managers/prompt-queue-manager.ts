import { logger } from "../../utils/logger.js";

export const MAX_QUEUED_PROMPTS = 5;

export interface QueuedPrompt {
  id: string;
  text: string;
}

/**
 * Prompt Queue - holds user text prompts received while the session is busy.
 * Kept in memory only: queued messages must not survive a restart and leak into
 * a different session context.
 * Singleton pattern
 */
class PromptQueueManager {
  private items: QueuedPrompt[] = [];
  private nextId = 1;

  add(text: string): QueuedPrompt | null {
    const normalizedText = text.trim();
    if (!normalizedText || this.isFull()) {
      return null;
    }

    const item: QueuedPrompt = { id: `queued-${this.nextId++}`, text: normalizedText };
    this.items.push(item);
    logger.debug(`[PromptQueue] Prompt queued: id=${item.id}, size=${this.items.length}`);
    return item;
  }

  list(): QueuedPrompt[] {
    return this.items.map((item) => ({ ...item }));
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
    logger.debug(
      `[PromptQueue] Prompt removed: id=${removed.id}, position=${index + 1}, size=${this.items.length}`,
    );
    return removed;
  }

  takeNext(): QueuedPrompt | null {
    const item = this.items.shift() ?? null;
    if (item) {
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

  clear(reason: string): void {
    if (this.items.length === 0) {
      return;
    }

    logger.info(`[PromptQueue] Cleared queue: reason=${reason}, count=${this.items.length}`);
    this.items = [];
  }

  __resetForTests(): void {
    this.items = [];
    this.nextId = 1;
  }
}

export const promptQueue = new PromptQueueManager();
