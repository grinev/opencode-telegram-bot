import { logger } from "../../utils/logger.js";

const TELEGRAM_MESSAGE_SAFE_LENGTH = 4000;
const DEFAULT_STREAM_KEY = "default";

export type ToolStreamKey = "default" | "subagent" | "todo" | "activity" | "status" | "reasoning";

interface ToolCallStreamerOptions {
  throttleMs: number;
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

  const seconds = Number.parseInt(retryMatch[1], 10);
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

function addMultipartMarkers(chunks: string[]): string[] {
  if (chunks.length <= 1) {
    return chunks;
  }

  return chunks.map((chunk, index) => `[${index + 1}/${chunks.length}]\n${chunk}`);
}

function splitLongText(text: string, limit: number): string[] {
  if (text.length <= limit) {
    return [text];
  }

  const markerReserve = 16;
  const safeLimit = Math.max(1, limit - markerReserve);
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > safeLimit) {
    let splitIndex = remaining.lastIndexOf("\n", safeLimit);
    if (splitIndex <= 0 || splitIndex < Math.floor(safeLimit * 0.5)) {
      splitIndex = safeLimit;
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).replace(/^\n+/, "");
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return addMultipartMarkers(chunks);
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
  private readonly throttleMs: number;
  private readonly sendText: ToolCallStreamerOptions["sendText"];
  private readonly editText: ToolCallStreamerOptions["editText"];
  private readonly deleteText: ToolCallStreamerOptions["deleteText"];
  private readonly states: Map<string, StreamState> = new Map();
  private readonly allStates: Set<StreamState> = new Set();

  constructor(options: ToolCallStreamerOptions) {
    this.throttleMs = Math.max(0, Math.floor(options.throttleMs));
    this.sendText = options.sendText;
    this.editText = options.editText;
    this.deleteText = options.deleteText;
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

    const state = this.getOrCreateState(sessionId, streamKey);
    const existingEntry = state.entries.find((entry) => entry.prefix === normalizedPrefix);
    if (existingEntry) {
      existingEntry.text = normalizedText;
    } else {
      state.entries.push({ prefix: normalizedPrefix, text: normalizedText });
    }

    state.latestParts = buildParts(state.entries);
    this.ensureTimer(state);
  }

  async flushSession(sessionId: string, reason: string): Promise<void> {
    const states = this.getStatesForSession(sessionId);
    await Promise.all(
      states.map(async (state) => {
        this.clearTimer(state);
        await this.enqueueTask(state, () => this.syncState(state, reason));
      }),
    );
  }

  async breakSession(sessionId: string, reason: string): Promise<void> {
    const states = this.getStatesForSession(sessionId);
    for (const state of states) {
      state.isBreaking = true;
      this.clearTimer(state);
      await this.enqueueTask(state, () => this.syncState(state, reason));
      this.cancelState(state);
      this.removeState(state);
    }
    logger.debug(`[ToolCallStreamer] Broke session stream: session=${sessionId}, reason=${reason}`);
  }

  clearSession(sessionId: string, reason: string): void {
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
    if (state.timer || state.isBroken || state.cancelled) {
      return;
    }

    if (this.throttleMs === 0) {
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
    }, this.throttleMs);
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

      if (parts.length === 0) {
        return state.telegramMessageIds.length > 0;
      }

      try {
        await this.syncMessages(state, parts);
        if (state.cancelled) {
          return false;
        }

        logger.debug(
          `[ToolCallStreamer] Stream synced: session=${state.sessionId}, reason=${reason}, parts=${parts.length}`,
        );
        return true;
      } catch (error) {
        const retryAfterMs = getRetryAfterMs(error);
        if (retryAfterMs === null) {
          this.markStreamBroken(state, error, reason);
          return false;
        }

        const delayMs = Math.max(this.throttleMs, retryAfterMs);
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

  private async syncMessages(state: StreamState, parts: string[]): Promise<void> {
    for (let index = 0; index < parts.length; index++) {
      if (state.cancelled) {
        return;
      }

      const text = parts[index];
      const currentMessageId = state.telegramMessageIds[index];

      if (currentMessageId) {
        await this.editText(state.sessionId, currentMessageId, text);
        state.lastSentParts[index] = text;
        continue;
      }

      const messageId = await this.sendText(state.sessionId, text);
      state.telegramMessageIds[index] = messageId;
      state.lastSentParts[index] = text;
    }

    for (let index = state.telegramMessageIds.length - 1; index >= parts.length; index--) {
      if (state.cancelled) {
        return;
      }

      const messageId = state.telegramMessageIds[index];
      if (messageId) {
        await this.deleteText(state.sessionId, messageId);
      }
      state.telegramMessageIds.pop();
      state.lastSentParts.pop();
    }
  }
}
