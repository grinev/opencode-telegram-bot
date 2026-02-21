import { logger } from "../utils/logger.js";

const DEFAULT_INTERVAL_SECONDS = 5;
const TELEGRAM_MESSAGE_MAX_LENGTH = 4096;

type SendMessageCallback = (sessionId: string, text: string) => Promise<void>;

interface ToolMessageBatcherOptions {
  intervalSeconds: number;
  sendMessage: SendMessageCallback;
}

function normalizeIntervalSeconds(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_INTERVAL_SECONDS;
  }

  const normalized = Math.floor(value);
  if (normalized < 0) {
    return DEFAULT_INTERVAL_SECONDS;
  }

  return normalized;
}

export class ToolMessageBatcher {
  private intervalSeconds: number;
  private readonly sendMessage: SendMessageCallback;
  private readonly queues: Map<string, string[]> = new Map();
  private readonly timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private generation = 0;

  constructor(options: ToolMessageBatcherOptions) {
    this.intervalSeconds = normalizeIntervalSeconds(options.intervalSeconds);
    this.sendMessage = options.sendMessage;
  }

  setIntervalSeconds(nextIntervalSeconds: number): void {
    const normalized = normalizeIntervalSeconds(nextIntervalSeconds);
    if (this.intervalSeconds === normalized) {
      return;
    }

    this.intervalSeconds = normalized;
    logger.info(`[ToolBatcher] Interval updated: ${normalized}s`);

    if (normalized === 0) {
      void this.flushAll("interval_updated");
      return;
    }

    const sessionIds = Array.from(this.queues.keys());
    for (const sessionId of sessionIds) {
      this.restartTimer(sessionId);
    }
  }

  getIntervalSeconds(): number {
    return this.intervalSeconds;
  }

  enqueue(sessionId: string, message: string): void {
    const normalizedMessage = message.trim();
    if (!sessionId || normalizedMessage.length === 0) {
      return;
    }

    if (this.intervalSeconds === 0) {
      const expectedGeneration = this.generation;
      logger.debug(`[ToolBatcher] Sending immediate message: session=${sessionId}`);
      void this.sendMessageSafe(sessionId, normalizedMessage, "immediate", expectedGeneration);
      return;
    }

    const queue = this.queues.get(sessionId) ?? [];
    queue.push(normalizedMessage);
    this.queues.set(sessionId, queue);
    logger.debug(
      `[ToolBatcher] Queued message: session=${sessionId}, queueSize=${queue.length}, interval=${this.intervalSeconds}s`,
    );

    this.ensureTimer(sessionId);
  }

  async flushSession(sessionId: string, reason: string): Promise<void> {
    const expectedGeneration = this.generation;
    this.clearTimer(sessionId);

    const queuedMessages = this.queues.get(sessionId);
    if (!queuedMessages || queuedMessages.length === 0) {
      return;
    }

    this.queues.delete(sessionId);

    const batches = this.packMessages(queuedMessages);
    logger.debug(
      `[ToolBatcher] Flushing ${queuedMessages.length} tool messages as ${batches.length} Telegram messages (session=${sessionId}, reason=${reason})`,
    );

    for (const batchMessage of batches) {
      await this.sendMessageSafe(sessionId, batchMessage, reason, expectedGeneration);
    }
  }

  async flushAll(reason: string): Promise<void> {
    for (const sessionId of Array.from(this.timers.keys())) {
      this.clearTimer(sessionId);
    }

    const sessionIds = Array.from(this.queues.keys());
    for (const sessionId of sessionIds) {
      await this.flushSession(sessionId, reason);
    }
  }

  clearSession(sessionId: string, reason: string): void {
    this.generation++;
    this.clearTimer(sessionId);

    if (this.queues.delete(sessionId)) {
      logger.debug(`[ToolBatcher] Cleared session queue: session=${sessionId}, reason=${reason}`);
    }
  }

  clearAll(reason: string): void {
    this.generation++;

    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }

    const queuedSessions = this.queues.size;
    this.timers.clear();
    this.queues.clear();

    if (queuedSessions > 0) {
      logger.debug(
        `[ToolBatcher] Cleared all queued tool messages: sessions=${queuedSessions}, reason=${reason}`,
      );
    }
  }

  private clearTimer(sessionId: string): void {
    const timer = this.timers.get(sessionId);
    if (!timer) {
      return;
    }

    clearTimeout(timer);
    this.timers.delete(sessionId);
  }

  private ensureTimer(sessionId: string): void {
    if (this.timers.has(sessionId)) {
      return;
    }

    this.restartTimer(sessionId);
  }

  private restartTimer(sessionId: string): void {
    this.clearTimer(sessionId);

    const timer = setTimeout(() => {
      this.timers.delete(sessionId);
      void this.flushSession(sessionId, "interval_elapsed");
    }, this.intervalSeconds * 1000);

    this.timers.set(sessionId, timer);
  }

  private async sendMessageSafe(
    sessionId: string,
    text: string,
    reason: string,
    expectedGeneration: number,
  ): Promise<void> {
    if (this.generation !== expectedGeneration) {
      logger.debug(
        `[ToolBatcher] Dropping stale tool batch message: session=${sessionId}, reason=${reason}`,
      );
      return;
    }

    try {
      await this.sendMessage(sessionId, text);
    } catch (err) {
      logger.error(
        `[ToolBatcher] Failed to send tool batch message: session=${sessionId}, reason=${reason}`,
        err,
      );
    }
  }

  private packMessages(messages: string[]): string[] {
    const normalizedEntries = messages
      .flatMap((message) => this.splitLongText(message, TELEGRAM_MESSAGE_MAX_LENGTH))
      .filter((entry) => entry.length > 0);

    if (normalizedEntries.length === 0) {
      return [];
    }

    const result: string[] = [];
    let current = "";

    for (const entry of normalizedEntries) {
      if (!current) {
        current = entry;
        continue;
      }

      const candidate = `${current}\n\n${entry}`;
      if (candidate.length <= TELEGRAM_MESSAGE_MAX_LENGTH) {
        current = candidate;
        continue;
      }

      result.push(current);
      current = entry;
    }

    if (current) {
      result.push(current);
    }

    return result;
  }

  private splitLongText(text: string, limit: number): string[] {
    if (text.length <= limit) {
      return [text];
    }

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > limit) {
      let splitIndex = remaining.lastIndexOf("\n", limit);
      if (splitIndex <= 0 || splitIndex < Math.floor(limit * 0.5)) {
        splitIndex = limit;
      }

      chunks.push(remaining.slice(0, splitIndex));
      remaining = remaining.slice(splitIndex).replace(/^\n+/, "");
    }

    if (remaining.length > 0) {
      chunks.push(remaining);
    }

    return chunks;
  }
}
