import { logger } from "../utils/logger.js";
import { createScopeKeyFromParams } from "./scope.js";

const GLOBAL_MIN_INTERVAL_MS = 40;
const PER_CHAT_MIN_INTERVAL_MS = 1100;
const GROUP_WINDOW_MS = 60_000;
const GROUP_LIMIT_PER_WINDOW = 20;

const RATE_LIMITED_METHODS = new Set<string>([
  "sendMessage",
  "editMessageText",
  "sendDocument",
  "sendPhoto",
  "sendAudio",
  "sendVoice",
  "sendVideo",
  "sendAnimation",
  "sendMediaGroup",
]);

interface QueueJob {
  method: string;
  scopeKey: string | null;
  chatId: number | null;
  isGroupLike: boolean;
  notBefore: number;
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

function parseChatId(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const value = Reflect.get(payload, "chat_id");
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseThreadId(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const value = Reflect.get(payload, "message_thread_id");
  return typeof value === "number" ? value : null;
}

function scopeKeyFromPayload(payload: unknown): string | null {
  const chatId = parseChatId(payload);
  if (chatId === null) {
    return null;
  }

  if (chatId > 0) {
    return createScopeKeyFromParams({
      chatId,
      context: "dm",
    });
  }

  const threadId = parseThreadId(payload);
  if (threadId !== null) {
    return createScopeKeyFromParams({
      chatId,
      threadId,
      context: threadId === 1 ? "group-general" : "group-topic",
    });
  }

  return createScopeKeyFromParams({
    chatId,
    context: "group-general",
  });
}

function isGroupLikeChat(chatId: number | null): boolean {
  return chatId !== null && chatId < 0;
}

function getRetryAfterMs(error: unknown): number | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const params = Reflect.get(error, "parameters");
  if (!params || typeof params !== "object") {
    return null;
  }

  const retryAfter = Reflect.get(params, "retry_after");
  if (typeof retryAfter !== "number" || retryAfter <= 0) {
    return null;
  }

  return retryAfter * 1000;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TelegramRateLimiter {
  private readonly queue: QueueJob[] = [];
  private processing = false;
  private lastGlobalSentAt = 0;
  private readonly lastSentAtByChat = new Map<number, number>();
  private readonly groupWindowByChat = new Map<number, number[]>();
  private activeScopeKey: string | null = null;

  setActiveScopeKey(scopeKey: string | null): void {
    this.activeScopeKey = scopeKey;
  }

  enqueue<T>(method: string, payload: unknown, run: () => Promise<T>): Promise<T> {
    if (!RATE_LIMITED_METHODS.has(method)) {
      return run();
    }

    const chatId = parseChatId(payload);
    const job: QueueJob = {
      method,
      scopeKey: scopeKeyFromPayload(payload),
      chatId,
      isGroupLike: isGroupLikeChat(chatId),
      notBefore: 0,
      run,
      resolve: () => undefined,
      reject: () => undefined,
    };

    const promise = new Promise<unknown>((resolve, reject) => {
      job.resolve = resolve;
      job.reject = reject;
    });

    this.queue.push(job);
    if (this.queue.length > 25) {
      logger.debug(`[RateLimiter] Outbound queue depth=${this.queue.length}`);
    }

    this.ensureProcessing();
    return promise as Promise<T>;
  }

  private ensureProcessing(): void {
    if (this.processing) {
      return;
    }

    this.processing = true;
    void this.processLoop();
  }

  private findNextIndex(now: number): { index: number; waitMs: number } {
    let prioritizedReadyIndex = -1;
    let firstReadyIndex = -1;
    let minWaitMs = Number.POSITIVE_INFINITY;
    let minWaitIndex = 0;

    for (let index = 0; index < this.queue.length; index++) {
      const job = this.queue[index];
      const waitMs = this.getWaitMs(job, now);

      if (waitMs <= 0) {
        if (
          this.activeScopeKey &&
          prioritizedReadyIndex < 0 &&
          job.scopeKey === this.activeScopeKey
        ) {
          prioritizedReadyIndex = index;
        }

        if (firstReadyIndex < 0) {
          firstReadyIndex = index;
        }

        continue;
      }

      if (waitMs < minWaitMs) {
        minWaitMs = waitMs;
        minWaitIndex = index;
      }
    }

    if (prioritizedReadyIndex >= 0) {
      return { index: prioritizedReadyIndex, waitMs: 0 };
    }

    if (firstReadyIndex >= 0) {
      return { index: firstReadyIndex, waitMs: 0 };
    }

    return {
      index: minWaitIndex,
      waitMs: Number.isFinite(minWaitMs) ? Math.max(1, minWaitMs) : 1,
    };
  }

  private pruneGroupWindow(chatId: number, now: number): number[] {
    const current = this.groupWindowByChat.get(chatId) ?? [];
    const pruned = current.filter((ts) => now - ts < GROUP_WINDOW_MS);
    this.groupWindowByChat.set(chatId, pruned);
    return pruned;
  }

  private getWaitMs(job: QueueJob, now: number = Date.now()): number {
    const waits: number[] = [];

    waits.push(job.notBefore - now);

    waits.push(this.lastGlobalSentAt + GLOBAL_MIN_INTERVAL_MS - now);

    if (job.chatId !== null) {
      const lastPerChat = this.lastSentAtByChat.get(job.chatId) ?? 0;
      waits.push(lastPerChat + PER_CHAT_MIN_INTERVAL_MS - now);
    }

    if (job.isGroupLike && job.chatId !== null) {
      const timestamps = this.pruneGroupWindow(job.chatId, now);
      if (timestamps.length >= GROUP_LIMIT_PER_WINDOW) {
        waits.push(timestamps[0] + GROUP_WINDOW_MS - now);
      }
    }

    return Math.max(0, ...waits);
  }

  private markSent(job: QueueJob): void {
    const now = Date.now();
    this.lastGlobalSentAt = now;

    if (job.chatId !== null) {
      this.lastSentAtByChat.set(job.chatId, now);
    }

    if (job.isGroupLike && job.chatId !== null) {
      const timestamps = this.pruneGroupWindow(job.chatId, now);
      timestamps.push(now);
      this.groupWindowByChat.set(job.chatId, timestamps);
    }
  }

  private async executeJob(job: QueueJob): Promise<"done" | "retry"> {
    try {
      const result = await job.run();
      this.markSent(job);
      job.resolve(result);
      return "done";
    } catch (error) {
      const retryAfterMs = getRetryAfterMs(error);
      if (!retryAfterMs) {
        job.reject(error);
        return "done";
      }

      const cappedDelay = Math.min(retryAfterMs + 100, 10_000);
      job.notBefore = Date.now() + cappedDelay;
      logger.warn(
        `[RateLimiter] Telegram 429 for ${job.method}; requeue in ${cappedDelay}ms (queue=${this.queue.length + 1})`,
      );
      return "retry";
    }
  }

  private async processLoop(): Promise<void> {
    try {
      while (this.queue.length > 0) {
        const now = Date.now();
        const selection = this.findNextIndex(now);
        if (selection.waitMs > 0) {
          await sleep(selection.waitMs);
          continue;
        }

        const index = selection.index;
        const [job] = this.queue.splice(index, 1);
        const outcome = await this.executeJob(job);
        if (outcome === "retry") {
          this.queue.push(job);
        }
      }
    } finally {
      this.processing = false;
      if (this.queue.length > 0) {
        this.ensureProcessing();
      }
    }
  }
}
