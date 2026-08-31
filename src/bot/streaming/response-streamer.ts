import type { Api, RawApi } from "grammy";
import { logger } from "../../utils/logger.js";
import { chunkPlainText } from "../render/chunker.js";
import { getTelegramRenderedPartSignature } from "../render/part-signature.js";
import type { TelegramRenderedPart } from "../render/types.js";
import {
  resolveStreamThrottleMs,
  type StreamThrottleMs,
} from "./stream-throttle.js";

type SendMessageApi = Pick<Api<RawApi>, "sendMessage">;
type EditMessageApi = Pick<Api<RawApi>, "editMessageText">;

type TelegramSendMessageOptions = Parameters<SendMessageApi["sendMessage"]>[2];
type TelegramEditMessageOptions = Parameters<EditMessageApi["editMessageText"]>[3];

export interface StreamingMessagePayload {
  parts: TelegramRenderedPart[];
  sendOptions?: TelegramSendMessageOptions;
  editOptions?: TelegramEditMessageOptions;
}

export interface StreamCompleteResult {
  streamed: boolean;
  telegramMessageIds: number[];
}

interface ResponseStreamerCompleteOptions {
  flushFinal?: boolean;
  notifyFirstCompletePart?: boolean;
}

interface ResponseStreamerOptions {
  throttleMs: StreamThrottleMs;
  sendPart: (
    part: TelegramRenderedPart,
    options?: TelegramSendMessageOptions,
  ) => Promise<{ messageId: number; deliveredSignature: string; degradedToPlain?: boolean }>;
  editPart: (
    messageId: number,
    part: TelegramRenderedPart,
    options?: TelegramEditMessageOptions,
  ) => Promise<{ deliveredSignature: string; degradedToPlain?: boolean }>;
  deleteText: (messageId: number) => Promise<void>;
  completePart?: (
    part: TelegramRenderedPart,
    options?: TelegramSendMessageOptions,
  ) => Promise<{ messageId: number; deliveredSignature: string }>;
}

interface StreamState {
  key: string;
  sessionId: string;
  messageId: string;
  latestPayload: StreamingMessagePayload | null;
  lastSentSignatures: string[];
  telegramMessageIds: number[];
  timer: ReturnType<typeof setTimeout> | null;
  task: Promise<boolean>;
  cancelled: boolean;
  isBroken: boolean;
  plainOnly: boolean;
  fatalErrorMessage: string | null;
  fatalErrorLogged: boolean;
}

function buildStateKey(sessionId: string, messageId: string): string {
  return `${sessionId}:${messageId}`;
}

function clonePart(part: TelegramRenderedPart): TelegramRenderedPart {
  return {
    blocks: [...part.blocks],
    fallbackText: part.fallbackText,
    source: part.source,
    ...(part.entities ? { entities: [...part.entities] } : {}),
  };
}

function isEmptyPart(part: TelegramRenderedPart): boolean {
  return part.blocks.length === 0 && part.fallbackText.length === 0;
}

/**
 * Rebuilds a payload as plain text. Native parts may hold far more than a text
 * message can carry, so the whole representation is re-chunked rather than
 * swapped part by part; the resulting part count may differ.
 */
function toPlainPayload(payload: StreamingMessagePayload): StreamingMessagePayload {
  // Nothing native to degrade: re-chunking here would only invalidate the
  // entity offsets a plain part carries.
  if (payload.parts.every((part) => part.blocks.length === 0)) {
    return payload;
  }

  const text = payload.parts
    .map((part) => part.fallbackText)
    .filter(Boolean)
    .join("\n\n");

  return {
    ...payload,
    parts: chunkPlainText(text),
  };
}

function normalizePayload(payload: StreamingMessagePayload): StreamingMessagePayload | null {
  const normalizedParts = payload.parts.map(clonePart).filter((part) => !isEmptyPart(part));
  if (normalizedParts.length === 0) {
    logger.debug("[ResponseStreamer] Dropped empty streaming payload after normalization");
    return null;
  }

  return {
    parts: normalizedParts,
    sendOptions: payload.sendOptions,
    editOptions: payload.editOptions,
  };
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

function enableNotificationForOptions(
  options: TelegramSendMessageOptions | undefined,
): TelegramSendMessageOptions | undefined {
  if (!options) {
    return options;
  }

  const nextOptions = {
    ...options,
  } as NonNullable<TelegramSendMessageOptions> & { disable_notification?: unknown };
  delete nextOptions.disable_notification;

  return nextOptions as TelegramSendMessageOptions;
}

export class ResponseStreamer {
  private readonly throttleMs: StreamThrottleMs;
  private readonly sendPart: ResponseStreamerOptions["sendPart"];
  private readonly editPart: ResponseStreamerOptions["editPart"];
  private readonly deleteText: ResponseStreamerOptions["deleteText"];
  private readonly completePart: ResponseStreamerOptions["completePart"];
  private readonly states: Map<string, StreamState> = new Map();

  constructor(options: ResponseStreamerOptions) {
    this.throttleMs = options.throttleMs;
    this.sendPart = options.sendPart;
    this.editPart = options.editPart;
    this.deleteText = options.deleteText;
    this.completePart = options.completePart;
  }

  private resolveThrottleMs(sessionId: string): number {
    return resolveStreamThrottleMs(this.throttleMs, sessionId);
  }

  enqueue(sessionId: string, messageId: string, payload: StreamingMessagePayload): void {
    const normalizedPayload = normalizePayload(payload);
    if (!normalizedPayload) {
      return;
    }

    const state = this.getOrCreateState(sessionId, messageId);
    state.latestPayload = normalizedPayload;
    if (state.isBroken) {
      return;
    }

    this.ensureTimer(state);
  }

  async complete(
    sessionId: string,
    messageId: string,
    payload?: StreamingMessagePayload,
    options?: ResponseStreamerCompleteOptions,
  ): Promise<StreamCompleteResult> {
    const notStreamed: StreamCompleteResult = { streamed: false, telegramMessageIds: [] };

    const state = this.states.get(buildStateKey(sessionId, messageId));
    if (!state) {
      logger.debug(
        `[ResponseStreamer] Complete skipped, no active stream state: session=${sessionId}, message=${messageId}`,
      );
      return notStreamed;
    }

    if (payload) {
      const normalizedPayload = normalizePayload(payload);
      if (normalizedPayload) {
        state.latestPayload = normalizedPayload;
      }
    }

    this.clearTimer(state);

    await state.task.catch(() => false);

    if (state.isBroken) {
      await this.cleanupBrokenStream(state, "complete_broken_stream");
      this.cancelState(state);
      this.states.delete(state.key);
      return notStreamed;
    }

    if (state.telegramMessageIds.length === 0) {
      logger.debug(
        `[ResponseStreamer] Complete returned not streamed: session=${sessionId}, message=${messageId}, reason=no_visible_partials`,
      );
      this.cancelState(state);
      this.states.delete(state.key);
      return notStreamed;
    }

    let synced = true;
    if (options?.flushFinal !== false) {
      synced = await this.enqueueTask(state, () => this.flushState(state, "complete"));
    }

    if (synced && this.completePart && state.latestPayload) {
      try {
        // The message this persists is the end of the same answer, so it
        // inherits the plain-text degradation the stream already fell back to.
        const completionPayload = state.plainOnly
          ? toPlainPayload(state.latestPayload)
          : state.latestPayload;
        const realMessageIds: number[] = [];
        let notifyNextCompletePart = options?.notifyFirstCompletePart === true;
        for (const part of completionPayload.parts) {
          if (isEmptyPart(part)) {
            continue;
          }
          const completeOptions = notifyNextCompletePart
            ? enableNotificationForOptions(completionPayload.sendOptions)
            : completionPayload.sendOptions;
          notifyNextCompletePart = false;
          const result = await this.completePart(part, completeOptions);
          realMessageIds.push(result.messageId);
        }
        state.telegramMessageIds = realMessageIds;
      } catch (error) {
        logger.error(
          `[ResponseStreamer] Failed to persist draft message: session=${sessionId}, message=${messageId}`,
          error,
        );
        synced = false;
      }
    }

    const messageIds = [...state.telegramMessageIds];
    this.cancelState(state);
    this.states.delete(state.key);
    return { streamed: synced, telegramMessageIds: messageIds };
  }

  clearMessage(sessionId: string, messageId: string, reason: string): void {
    const key = buildStateKey(sessionId, messageId);
    const state = this.states.get(key);
    if (!state) {
      return;
    }

    this.cancelState(state);
    this.states.delete(key);
    logger.debug(
      `[ResponseStreamer] Cleared message stream: session=${sessionId}, message=${messageId}, reason=${reason}`,
    );
  }

  clearSession(sessionId: string, reason: string): void {
    for (const state of Array.from(this.states.values())) {
      if (state.sessionId !== sessionId) {
        continue;
      }

      this.cancelState(state);
      this.states.delete(state.key);
    }

    logger.debug(
      `[ResponseStreamer] Cleared session streams: session=${sessionId}, reason=${reason}`,
    );
  }

  clearAll(reason: string): void {
    for (const state of this.states.values()) {
      this.cancelState(state);
    }

    const count = this.states.size;
    this.states.clear();

    if (count > 0) {
      logger.debug(`[ResponseStreamer] Cleared all streams: count=${count}, reason=${reason}`);
    }
  }

  hasActiveStream(sessionId: string): boolean {
    for (const state of this.states.values()) {
      if (state.sessionId === sessionId && !state.cancelled) {
        return true;
      }
    }
    return false;
  }

  private getOrCreateState(sessionId: string, messageId: string): StreamState {
    const key = buildStateKey(sessionId, messageId);
    const existing = this.states.get(key);
    if (existing) {
      return existing;
    }

    const state: StreamState = {
      key,
      sessionId,
      messageId,
      latestPayload: null,
      lastSentSignatures: [],
      telegramMessageIds: [],
      timer: null,
      task: Promise.resolve(true),
      cancelled: false,
      isBroken: false,
      plainOnly: false,
      fatalErrorMessage: null,
      fatalErrorLogged: false,
    };

    this.states.set(key, state);
    return state;
  }

  private ensureTimer(state: StreamState): void {
    if (state.timer || state.cancelled) {
      return;
    }

    const throttleMs = this.resolveThrottleMs(state.sessionId);
    if (throttleMs === 0) {
      void this.enqueueTask(state, () => this.flushState(state, "immediate")).catch((error) => {
        logger.error(
          `[ResponseStreamer] Immediate stream sync failed: session=${state.sessionId}, message=${state.messageId}`,
          error,
        );
      });
      return;
    }

    state.timer = setTimeout(() => {
      state.timer = null;
      void this.enqueueTask(state, () => this.flushState(state, "throttle_elapsed")).catch(
        (error) => {
          logger.error(
            `[ResponseStreamer] Throttled stream sync failed: session=${state.sessionId}, message=${state.messageId}`,
            error,
          );
        },
      );
    }, throttleMs);
  }

  private clearTimer(state: StreamState): void {
    if (!state.timer) {
      return;
    }

    clearTimeout(state.timer);
    state.timer = null;
  }

  private cancelState(state: StreamState): void {
    state.cancelled = true;
    this.clearTimer(state);
  }

  private enqueueTask(state: StreamState, task: () => Promise<boolean>): Promise<boolean> {
    const nextTask = state.task.catch(() => false).then(task);
    state.task = nextTask;
    return nextTask;
  }

  private async flushState(state: StreamState, reason: string): Promise<boolean> {
    if (state.cancelled) {
      return false;
    }

    if (state.isBroken) {
      return false;
    }

    while (!state.cancelled) {
      const latestPayload = state.latestPayload;
      if (!latestPayload) {
        return state.telegramMessageIds.length > 0;
      }

      // Signatures must describe what actually goes out, otherwise the
      // "unchanged" checks below compare two different representations.
      const payload = state.plainOnly ? toPlainPayload(latestPayload) : latestPayload;
      const targetSignatures = payload.parts.map((part) =>
        getTelegramRenderedPartSignature(part),
      );
      const unchanged =
        targetSignatures.length === state.lastSentSignatures.length &&
        targetSignatures.every((signature, index) => signature === state.lastSentSignatures[index]);

      if (unchanged) {
        logger.debug(
          `[ResponseStreamer] Skipped unchanged payload: session=${state.sessionId}, message=${state.messageId}, parts=${payload.parts.length}`,
        );
        return state.telegramMessageIds.length > 0;
      }

      try {
        await this.syncMessages(state, payload, targetSignatures);
        logger.debug(
          `[ResponseStreamer] Stream synced: session=${state.sessionId}, message=${state.messageId}, reason=${reason}, parts=${payload.parts.length}`,
        );
        return true;
      } catch (error) {
        const retryAfterMs = getRetryAfterMs(error);
        if (retryAfterMs !== null) {
          const delayMs = Math.max(this.resolveThrottleMs(state.sessionId), retryAfterMs);
          logger.warn(
            `[ResponseStreamer] Stream sync rate-limited, retrying in ${delayMs}ms: session=${state.sessionId}, message=${state.messageId}, reason=${reason}`,
            error,
          );
          await delay(delayMs);
          continue;
        }

        // First native failure: fall back to plain text for the rest of this
        // message instead of tearing the stream down. A payload that is already
        // plain has nothing left to degrade to, so it breaks straight away.
        if (!state.plainOnly && payload.parts.some((part) => part.blocks.length > 0)) {
          this.markStreamPlainOnly(state, error, reason);
          continue;
        }

        this.markStreamBroken(state, error, reason);
        return false;
      }
    }

    return false;
  }

  private markStreamPlainOnly(state: StreamState, error: unknown, reason: string): void {
    if (state.plainOnly) {
      return;
    }

    state.plainOnly = true;
    logger.warn(
      `[ResponseStreamer] Native rendering failed, continuing this message as plain text: session=${state.sessionId}, message=${state.messageId}, reason=${reason}`,
      error,
    );
  }

  private markStreamBroken(state: StreamState, error: unknown, reason: string): void {
    state.isBroken = true;
    state.fatalErrorMessage = getErrorMessage(error);

    if (state.fatalErrorLogged) {
      return;
    }

    state.fatalErrorLogged = true;
    logger.error(
      `[ResponseStreamer] Stream marked as broken: session=${state.sessionId}, message=${state.messageId}, reason=${reason}, error=${state.fatalErrorMessage}`,
      error,
    );
  }

  private async cleanupBrokenStream(state: StreamState, reason: string): Promise<void> {
    if (state.telegramMessageIds.length === 0) {
      return;
    }

    for (let index = state.telegramMessageIds.length - 1; index >= 0; index--) {
      const messageId = state.telegramMessageIds[index];
      if (!messageId) {
        continue;
      }

      try {
        await this.deleteText(messageId);
      } catch (error) {
        logger.warn(
          `[ResponseStreamer] Failed to delete broken stream message: session=${state.sessionId}, message=${state.messageId}, telegramMessageId=${messageId}, reason=${reason}`,
          error,
        );
      }
    }

    state.telegramMessageIds = [];
    state.lastSentSignatures = [];
    logger.debug(
      `[ResponseStreamer] Cleaned up broken stream messages: session=${state.sessionId}, message=${state.messageId}, reason=${reason}`,
    );
  }

  private async syncMessages(
    state: StreamState,
    payload: StreamingMessagePayload,
    targetSignatures: string[],
  ): Promise<void> {
    for (let index = 0; index < payload.parts.length; index++) {
      const part = payload.parts[index];
      if (!part) {
        continue;
      }
      const nextSignature = targetSignatures[index];
      const currentMessageId = state.telegramMessageIds[index];

      if (currentMessageId) {
        if (state.lastSentSignatures[index] === nextSignature) {
          continue;
        }

        const result = await this.editPart(currentMessageId, part, payload.editOptions);
        state.lastSentSignatures[index] = result.deliveredSignature;
        if (result.degradedToPlain) {
          this.markStreamPlainOnly(state, null, "transport_degraded_to_plain");
        }
        continue;
      }

      const result = await this.sendPart(part, payload.sendOptions);
      state.telegramMessageIds[index] = result.messageId;
      state.lastSentSignatures[index] = result.deliveredSignature;
      if (result.degradedToPlain) {
        this.markStreamPlainOnly(state, null, "transport_degraded_to_plain");
      }
    }

    for (let index = state.telegramMessageIds.length - 1; index >= payload.parts.length; index--) {
      const messageId = state.telegramMessageIds[index];
      if (messageId) {
        await this.deleteText(messageId);
      }
      state.telegramMessageIds.pop();
      state.lastSentSignatures.pop();
    }
  }
}
