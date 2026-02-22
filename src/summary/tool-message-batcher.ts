import type { CodeFileData } from "./formatter.js";
import { logger } from "../utils/logger.js";

const DEFAULT_INTERVAL_SECONDS = 5;
const TELEGRAM_MESSAGE_MAX_LENGTH = 4096;

type SendTextCallback = (sessionId: string, text: string) => Promise<void>;
type SendFileCallback = (sessionId: string, fileData: CodeFileData) => Promise<void>;

interface ToolMessageBatcherOptions {
  intervalSeconds: number;
  sendText: SendTextCallback;
  sendFile: SendFileCallback;
}

type QueueItem =
  | {
      kind: "text";
      text: string;
    }
  | {
      kind: "file";
      fileData: CodeFileData;
    };

type FlushItem =
  | {
      kind: "text";
      text: string;
    }
  | {
      kind: "file";
      fileData: CodeFileData;
    };

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
  private readonly sendText: SendTextCallback;
  private readonly sendFile: SendFileCallback;
  private readonly queues: Map<string, QueueItem[]> = new Map();
  private readonly timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private readonly sessionTasks: Map<string, Promise<void>> = new Map();
  private generation = 0;

  constructor(options: ToolMessageBatcherOptions) {
    this.intervalSeconds = normalizeIntervalSeconds(options.intervalSeconds);
    this.sendText = options.sendText;
    this.sendFile = options.sendFile;
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
      logger.debug(`[ToolBatcher] Sending immediate text message: session=${sessionId}`);
      void this.enqueueTask(sessionId, () =>
        this.sendTextSafe(sessionId, normalizedMessage, "immediate", expectedGeneration),
      );
      return;
    }

    const queue = this.queues.get(sessionId) ?? [];
    queue.push({ kind: "text", text: normalizedMessage });
    this.queues.set(sessionId, queue);
    logger.debug(
      `[ToolBatcher] Queued text message: session=${sessionId}, queueSize=${queue.length}, interval=${this.intervalSeconds}s`,
    );

    this.ensureTimer(sessionId);
  }

  enqueueFile(sessionId: string, fileData: CodeFileData): void {
    if (!sessionId) {
      return;
    }

    if (this.intervalSeconds === 0) {
      const expectedGeneration = this.generation;
      logger.debug(`[ToolBatcher] Sending immediate file message: session=${sessionId}`);
      void this.enqueueTask(sessionId, () =>
        this.sendFileSafe(sessionId, fileData, "immediate", expectedGeneration),
      );
      return;
    }

    const queue = this.queues.get(sessionId) ?? [];
    queue.push({ kind: "file", fileData });
    this.queues.set(sessionId, queue);
    logger.debug(
      `[ToolBatcher] Queued file message: session=${sessionId}, queueSize=${queue.length}, interval=${this.intervalSeconds}s`,
    );

    this.ensureTimer(sessionId);
  }

  async flushSession(sessionId: string, reason: string): Promise<void> {
    await this.enqueueTask(sessionId, () => this.flushSessionInternal(sessionId, reason));
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

  private enqueueTask(sessionId: string, task: () => Promise<void>): Promise<void> {
    const previousTask = this.sessionTasks.get(sessionId) ?? Promise.resolve();
    const nextTask = previousTask
      .catch(() => undefined)
      .then(task)
      .finally(() => {
        if (this.sessionTasks.get(sessionId) === nextTask) {
          this.sessionTasks.delete(sessionId);
        }
      });

    this.sessionTasks.set(sessionId, nextTask);
    return nextTask;
  }

  private async flushSessionInternal(sessionId: string, reason: string): Promise<void> {
    const expectedGeneration = this.generation;
    this.clearTimer(sessionId);

    const queuedItems = this.queues.get(sessionId);
    if (!queuedItems || queuedItems.length === 0) {
      return;
    }

    this.queues.delete(sessionId);

    const flushItems = this.buildFlushItems(queuedItems);
    logger.debug(
      `[ToolBatcher] Flushing ${queuedItems.length} queued items as ${flushItems.length} Telegram sends (session=${sessionId}, reason=${reason})`,
    );

    for (const item of flushItems) {
      if (item.kind === "text") {
        await this.sendTextSafe(sessionId, item.text, reason, expectedGeneration);
      } else {
        await this.sendFileSafe(sessionId, item.fileData, reason, expectedGeneration);
      }
    }
  }

  private async sendTextSafe(
    sessionId: string,
    text: string,
    reason: string,
    expectedGeneration: number,
  ): Promise<void> {
    if (this.generation !== expectedGeneration) {
      logger.debug(
        `[ToolBatcher] Dropping stale tool text message: session=${sessionId}, reason=${reason}`,
      );
      return;
    }

    try {
      await this.sendText(sessionId, text);
    } catch (err) {
      logger.error(
        `[ToolBatcher] Failed to send tool text message: session=${sessionId}, reason=${reason}`,
        err,
      );
    }
  }

  private async sendFileSafe(
    sessionId: string,
    fileData: CodeFileData,
    reason: string,
    expectedGeneration: number,
  ): Promise<void> {
    if (this.generation !== expectedGeneration) {
      logger.debug(
        `[ToolBatcher] Dropping stale tool file message: session=${sessionId}, reason=${reason}`,
      );
      return;
    }

    try {
      await this.sendFile(sessionId, fileData);
    } catch (err) {
      logger.error(
        `[ToolBatcher] Failed to send tool file message: session=${sessionId}, reason=${reason}`,
        err,
      );
    }
  }

  private buildFlushItems(entries: QueueItem[]): FlushItem[] {
    const result: FlushItem[] = [];
    const textBuffer: string[] = [];

    const flushTextBuffer = () => {
      if (textBuffer.length === 0) {
        return;
      }

      const packedTextMessages = this.packMessages(textBuffer);
      for (const text of packedTextMessages) {
        result.push({ kind: "text", text });
      }

      textBuffer.length = 0;
    };

    for (const entry of entries) {
      if (entry.kind === "text") {
        textBuffer.push(entry.text);
      } else {
        flushTextBuffer();
        result.push({ kind: "file", fileData: entry.fileData });
      }
    }

    flushTextBuffer();
    return result;
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
