import { logger } from "../../utils/logger.js";
import {
  resolveStreamThrottleMs,
  type StreamThrottleMs,
} from "./stream-throttle.js";

const TELEGRAM_MESSAGE_SAFE_LENGTH = 4000;
const DEFAULT_STREAM_KEY = "default";

export type ToolStreamKey = "default" | "todo" | `subagent:${string}`;

interface ToolCallStreamerOptions {
  throttleMs: StreamThrottleMs;
  sendText: (sessionId: string, text: string) => Promise<number>;
  editText: (sessionId: string, telegramMessageId: number, text: string) => Promise<void>;
  deleteText: (sessionId: string, telegramMessageId: number) => Promise<void>;
}

interface StreamEntry {
  prefix?: string;
  text: string;
}

interface StreamState {
  key: ToolStreamKey;
  sessionId: string;
  entries: StreamEntry[];
  latestParts: string[];
  lastSentParts: string[];
  telegramMessageIds: number[];
  timer: ReturnType<typeof setTimeout> | null;
  task: Promise<boolean>;
  cancelled: boolean;
  isBroken: boolean;
  isBreaking: boolean;
  fatalErrorMessage: string | null;
  fatalErrorLogged: boolean;
  deleteWhenEmpty: boolean;
  held: boolean;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function getRetryAfterMs(error: unknown): number | null {
  const message = getErrorMessage(error);
  if (!/\b429\b/.test(message)) {
    return null;
  }

  const retryMatch = message.match(/retry after\s+(\d+)/i);
  if (!retryMatch) {
    return null;
  }

  const secondsText = retryMatch[1];
  if (!secondsText) {
    return null;
  }
  const seconds = Number.parseInt(secondsText, 10);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  return seconds * 1000;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

class TelegramOperationCancelledError extends Error {}

function splitLongText(text: string, limit: number): string[] {
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

function buildParts(entries: StreamEntry[]): string[] {
  const text = entries
    .map((entry) => entry.text.trim())
    .filter(Boolean)
    .join("\n\n");
  if (!text) {
    return [];
  }

  return splitLongText(text, TELEGRAM_MESSAGE_SAFE_LENGTH).filter(Boolean);
}

export class ToolCallStreamer {
  private readonly throttleMs: StreamThrottleMs;
  private readonly sendText: ToolCallStreamerOptions["sendText"];
  private readonly editText: ToolCallStreamerOptions["editText"];
  private readonly deleteText: ToolCallStreamerOptions["deleteText"];
  private readonly states: Map<string, StreamState> = new Map();
  private readonly allStates: Set<StreamState> = new Set();
  private readonly telegramOperationTasks = new Map<string, Promise<void>>();
  private readonly lastTelegramOperationAt = new Map<string, number>();
  private readonly telegramOperationTokens = new Map<string, object>();
  private readonly heldSessions = new Set<string>();
  private readonly documentBoundaries = new Map<string, { count: number; done: Promise<void>; release: () => void }>();
  private readonly frozenToolEntries = new Set<string>();

  constructor(options: ToolCallStreamerOptions) {
    this.throttleMs = options.throttleMs;
    this.sendText = options.sendText;
    this.editText = options.editText;
    this.deleteText = options.deleteText;
  }

  private resolveThrottleMs(sessionId: string): number {
    return resolveStreamThrottleMs(this.throttleMs, sessionId);
  }

  append(sessionId: string, text: string, streamKey: ToolStreamKey = DEFAULT_STREAM_KEY): void {
    const normalizedText = text.trim();
    if (!sessionId || !normalizedText) {
      return;
    }

    const state = this.getOrCreateState(sessionId, streamKey);
    state.entries.push({ text: normalizedText });
    state.latestParts = buildParts(state.entries);
    this.ensureTimer(state);
  }

  replaceByPrefix(
    sessionId: string,
    prefix: string,
    text: string,
    streamKey: ToolStreamKey = DEFAULT_STREAM_KEY,
  ): void {
    const normalizedPrefix = prefix.trim();
    const normalizedText = text.trim();
    if (!sessionId || !normalizedPrefix || !normalizedText) {
      return;
    }
    if (this.frozenToolEntries.has(`${sessionId}:${streamKey}:${normalizedPrefix}`)) {
      return;
    }

    const state = this.findPrefixedState(sessionId, streamKey, normalizedPrefix) ??
      this.getOrCreateState(sessionId, streamKey);
    const existingEntry = state.entries.find((entry) => entry.prefix === normalizedPrefix);
    if (existingEntry) {
      existingEntry.text = normalizedText;
    } else {
      state.entries.push({ prefix: normalizedPrefix, text: normalizedText });
    }

    state.latestParts = buildParts(state.entries);
    this.ensureTimer(state);
  }

  removeByPrefix(
    sessionId: string,
    prefix: string,
    streamKey: ToolStreamKey = DEFAULT_STREAM_KEY,
    deleteWhenEmpty = false,
  ): void {
    const normalizedPrefix = prefix.trim();
    if (!sessionId || !normalizedPrefix) {
      return;
    }

    const state = this.findPrefixedState(sessionId, streamKey, normalizedPrefix);
    if (!state) {
      return;
    }

    const entryIndex = state.entries.findIndex((entry) => entry.prefix === normalizedPrefix);
    if (entryIndex < 0) {
      return;
    }

    state.entries.splice(entryIndex, 1);
    if (deleteWhenEmpty && state.entries.length === 0) {
      state.deleteWhenEmpty = true;
    }
    state.latestParts = buildParts(state.entries);
    this.ensureTimer(state);
  }

  /** A document divides new tool messages from older, still-editable calls. */
  beginDocumentBoundary(sessionId: string): void {
    const boundary = this.documentBoundaries.get(sessionId);
    if (boundary) {
      boundary.count++;
    } else {
      let release = () => {};
      const done = new Promise<void>((resolve) => { release = resolve; });
      this.documentBoundaries.set(sessionId, { count: 1, done, release });
    }
    this.heldSessions.add(sessionId);
    for (const [id, state] of this.states) {
      if (state.sessionId === sessionId) {
        this.states.delete(id);
      }
    }
  }

  endDocumentBoundary(sessionId: string): void {
    const boundary = this.documentBoundaries.get(sessionId);
    if (!boundary || --boundary.count > 0) {
      return;
    }
    this.documentBoundaries.delete(sessionId);
    this.heldSessions.delete(sessionId);
    for (const state of this.getStatesForSession(sessionId)) {
      if (state.held) {
        state.held = false;
        this.ensureTimer(state);
      }
    }
    boundary.release();
  }

  async flushSession(sessionId: string, reason: string): Promise<void> {
    const states = this.getStatesForSession(sessionId);
    await Promise.all(
      states.filter((state) => !state.held).map(async (state) => {
        this.clearTimer(state);
        await this.enqueueTask(state, () => this.syncState(state, reason));
      }),
    );
  }

  async breakSession(sessionId: string, reason: string): Promise<void> {
    const states = this.getStatesForSession(sessionId);
    if (reason === "session_error" || reason === "session_idle") {
      for (const state of states) {
        for (const entry of state.entries) {
          if (entry.prefix?.startsWith("⏳") && entry.text.startsWith("⏳")) {
            this.frozenToolEntries.add(`${sessionId}:${state.key}:${entry.prefix}`);
          }
        }
      }
    }
    for (const state of states) {
      state.isBreaking = true;
      this.clearTimer(state);
      if (state.held) {
        await this.documentBoundaries.get(sessionId)?.done;
      }
      await this.enqueueTask(state, () => this.syncState(state, reason));
      this.cancelState(state);
      this.removeState(state);
    }
    logger.debug(`[ToolCallStreamer] Broke session stream: session=${sessionId}, reason=${reason}`);
  }

  clearSession(sessionId: string, reason: string): void {
    for (const key of this.frozenToolEntries) {
      if (key.startsWith(`${sessionId}:`)) {
        this.frozenToolEntries.delete(key);
      }
    }
    this.documentBoundaries.get(sessionId)?.release();
    this.documentBoundaries.delete(sessionId);
    this.heldSessions.delete(sessionId);
    this.cancelTelegramOperations(sessionId);
    let clearedAny = false;
    for (const state of Array.from(this.allStates)) {
      if (state.sessionId !== sessionId) {
        continue;
      }

      this.cancelState(state);
      this.removeState(state);
      clearedAny = true;
    }

    if (clearedAny) {
      logger.debug(
        `[ToolCallStreamer] Cleared session stream: session=${sessionId}, reason=${reason}`,
      );
    }
  }

  clearAll(reason: string): void {
    this.frozenToolEntries.clear();
    for (const boundary of this.documentBoundaries.values()) {
      boundary.release();
    }
    this.documentBoundaries.clear();
    this.heldSessions.clear();
    const sessionIds = new Set(Array.from(this.allStates, (state) => state.sessionId));
    for (const sessionId of sessionIds) {
      this.cancelTelegramOperations(sessionId);
    }

    for (const state of Array.from(this.allStates)) {
      this.cancelState(state);
    }

    const count = this.allStates.size;
    this.states.clear();
    this.allStates.clear();
    if (count > 0) {
      logger.debug(`[ToolCallStreamer] Cleared all streams: count=${count}, reason=${reason}`);
    }
  }

  private getStateId(sessionId: string, streamKey: ToolStreamKey): string {
    return `${sessionId}:${streamKey}`;
  }

  private getStatesForSession(sessionId: string): StreamState[] {
    return Array.from(this.allStates).filter((state) => state.sessionId === sessionId);
  }

  private findPrefixedState(sessionId: string, key: ToolStreamKey, prefix: string): StreamState | undefined {
    if (!prefix.startsWith("⏳") && !key.startsWith("subagent:")) {
      return this.states.get(this.getStateId(sessionId, key))?.entries.some((entry) => entry.prefix === prefix)
        ? this.states.get(this.getStateId(sessionId, key))
        : undefined;
    }
    return this.getStatesForSession(sessionId).reverse().find((state) =>
      state.key === key && state.entries.some((entry) => entry.prefix === prefix),
    );
  }

  private getOrCreateState(
    sessionId: string,
    streamKey: ToolStreamKey = DEFAULT_STREAM_KEY,
  ): StreamState {
    const stateId = this.getStateId(sessionId, streamKey);
    const existing = this.states.get(stateId);
    if (existing && !existing.isBroken && !existing.cancelled && !existing.isBreaking) {
      return existing;
    }

    if (existing && (existing.isBroken || existing.cancelled)) {
      this.clearTimer(existing);
      this.removeState(existing);
    }

    const state: StreamState = {
      key: streamKey,
      sessionId,
      entries: [],
      latestParts: [],
      lastSentParts: [],
      telegramMessageIds: [],
      timer: null,
      task: Promise.resolve(true),
      cancelled: false,
      isBroken: false,
      isBreaking: false,
      fatalErrorMessage: null,
      fatalErrorLogged: false,
      deleteWhenEmpty: false,
      held: this.heldSessions.has(sessionId),
    };

    this.states.set(stateId, state);
    this.allStates.add(state);
    return state;
  }

  private clearTimer(state: StreamState): void {
    if (!state.timer) {
      return;
    }

    clearTimeout(state.timer);
    state.timer = null;
  }

  private ensureTimer(state: StreamState): void {
    if (state.timer || state.isBroken || state.cancelled || state.isBreaking || state.held) {
      return;
    }

    const throttleMs = this.resolveThrottleMs(state.sessionId);
    if (throttleMs === 0) {
      void this.enqueueTask(state, () => this.syncState(state, "immediate")).catch((error) => {
        logger.error(`[ToolCallStreamer] Immediate sync failed: session=${state.sessionId}`, error);
      });
      return;
    }

    state.timer = setTimeout(() => {
      state.timer = null;
      void this.enqueueTask(state, () => this.syncState(state, "throttle_elapsed")).catch(
        (error) => {
          logger.error(
            `[ToolCallStreamer] Throttled sync failed: session=${state.sessionId}`,
            error,
          );
        },
      );
    }, throttleMs);
  }

  private enqueueTask(state: StreamState, task: () => Promise<boolean>): Promise<boolean> {
    const nextTask = state.task.catch(() => false).then(task);
    state.task = nextTask;
    return nextTask;
  }

  private cancelState(state: StreamState): void {
    state.cancelled = true;
    this.clearTimer(state);
  }

  private removeState(state: StreamState): void {
    const stateId = this.getStateId(state.sessionId, state.key);
    if (this.states.get(stateId) === state) {
      this.states.delete(stateId);
    }

    this.allStates.delete(state);
  }

  private async syncState(state: StreamState, reason: string): Promise<boolean> {
    if (state.cancelled) {
      return false;
    }

    if (state.isBroken) {
      return false;
    }

    while (!state.isBroken && !state.cancelled) {
      const parts = state.latestParts;
      const unchanged =
        parts.length === state.lastSentParts.length &&
        parts.every((part, index) => state.lastSentParts[index] === part);

      if (unchanged) {
        return state.telegramMessageIds.length > 0;
      }

      if (parts.length === 0 && !state.deleteWhenEmpty) {
        return state.telegramMessageIds.length > 0;
      }

      try {
        await this.syncMessages(state, parts);
        state.deleteWhenEmpty = false;
        if (state.cancelled) {
          return false;
        }

        logger.debug(
          `[ToolCallStreamer] Stream synced: session=${state.sessionId}, reason=${reason}, parts=${parts.length}`,
        );
        return true;
      } catch (error) {
        if (state.cancelled || error instanceof TelegramOperationCancelledError) {
          return false;
        }

        const retryAfterMs = getRetryAfterMs(error);
        if (retryAfterMs === null) {
          this.markStreamBroken(state, error, reason);
          return false;
        }

        const delayMs = Math.max(this.resolveThrottleMs(state.sessionId), retryAfterMs);
        logger.warn(
          `[ToolCallStreamer] Stream sync rate-limited, retrying in ${delayMs}ms: session=${state.sessionId}, reason=${reason}`,
          error,
        );
        await delay(delayMs);
      }
    }

    return false;
  }

  private markStreamBroken(state: StreamState, error: unknown, reason: string): void {
    state.isBroken = true;
    state.fatalErrorMessage = getErrorMessage(error);

    if (state.fatalErrorLogged) {
      return;
    }

    state.fatalErrorLogged = true;
    logger.error(
      `[ToolCallStreamer] Stream marked as broken: session=${state.sessionId}, reason=${reason}, error=${state.fatalErrorMessage}`,
      error,
    );
  }

  private enqueueTelegramOperation<T>(
    sessionId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const token = this.telegramOperationTokens.get(sessionId) ?? {};
    this.telegramOperationTokens.set(sessionId, token);
    const previousTask = this.telegramOperationTasks.get(sessionId) ?? Promise.resolve();
    const task = previousTask.catch(() => undefined).then(async () => {
      const throttleMs = this.resolveThrottleMs(sessionId);
      const lastOperationAt = this.lastTelegramOperationAt.get(sessionId);
      if (lastOperationAt !== undefined) {
        const remainingDelayMs = throttleMs - (Date.now() - lastOperationAt);
        if (remainingDelayMs > 0) {
          await delay(remainingDelayMs);
        }
      }

      if (this.telegramOperationTokens.get(sessionId) !== token) {
        throw new TelegramOperationCancelledError();
      }

      try {
        return await operation();
      } finally {
        this.lastTelegramOperationAt.set(sessionId, Date.now());
      }
    });

    this.telegramOperationTasks.set(
      sessionId,
      task.then(
        () => undefined,
        () => undefined,
      ),
    );
    const queueTail = this.telegramOperationTasks.get(sessionId)!;
    void queueTail.finally(() => {
      if (
        this.telegramOperationTasks.get(sessionId) === queueTail &&
        this.telegramOperationTokens.get(sessionId) === token
      ) {
        this.telegramOperationTasks.delete(sessionId);
        this.telegramOperationTokens.delete(sessionId);
      }
    });
    return task;
  }

  private cancelTelegramOperations(sessionId: string): void {
    const cancellationToken = {};
    this.telegramOperationTokens.set(sessionId, cancellationToken);
    const pendingTask = this.telegramOperationTasks.get(sessionId);
    if (!pendingTask) {
      this.telegramOperationTokens.delete(sessionId);
      this.lastTelegramOperationAt.delete(sessionId);
      return;
    }

    void pendingTask.finally(() => {
      if (this.telegramOperationTasks.get(sessionId) !== pendingTask) {
        return;
      }

      this.telegramOperationTasks.delete(sessionId);
      if (this.telegramOperationTokens.get(sessionId) === cancellationToken) {
        this.telegramOperationTokens.delete(sessionId);
      }
      this.lastTelegramOperationAt.delete(sessionId);
    });
  }

  private async syncMessages(state: StreamState, parts: string[]): Promise<void> {
    for (let index = 0; index < parts.length; index++) {
      if (state.cancelled) {
        return;
      }

      const text = parts[index];
      if (text === undefined) {
        continue;
      }
      const currentMessageId = state.telegramMessageIds[index];

      if (currentMessageId) {
        await this.enqueueTelegramOperation(state.sessionId, () =>
          this.editText(state.sessionId, currentMessageId, text),
        );
        state.lastSentParts[index] = text;
        continue;
      }

      const messageId = await this.enqueueTelegramOperation(state.sessionId, () =>
        this.sendText(state.sessionId, text),
      );
      state.telegramMessageIds[index] = messageId;
      state.lastSentParts[index] = text;
    }

    for (let index = state.telegramMessageIds.length - 1; index >= parts.length; index--) {
      if (state.cancelled) {
        return;
      }

      const messageId = state.telegramMessageIds[index];
      if (messageId) {
        await this.enqueueTelegramOperation(state.sessionId, () =>
          this.deleteText(state.sessionId, messageId),
        );
      }
      state.telegramMessageIds.pop();
      state.lastSentParts.pop();
    }
  }
}
