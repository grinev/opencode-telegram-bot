import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import {
  getTelegramRetryAfterMs,
  isTransientTelegramNetworkError,
} from "../../utils/telegram-rate-limit-retry.js";
import type {
  TelegramDestination,
  TelegramEventDelivery,
} from "../events/telegram-event-delivery.js";

const DELETE_HEAD_START_MS = 500;
const TELEGRAM_DELETE_WINDOW_MS = 48 * 60 * 60 * 1_000;

interface Marker {
  destination: TelegramDestination;
  sent?: { messageId: number; at: number };
  closed?: Promise<void>;
}

interface Reply {
  marker: Marker | undefined;
  exposed: boolean;
  completed: boolean;
  nextWork?: { destination: TelegramDestination; messageId?: string } | undefined;
}

interface WorkState {
  marker?: Marker | undefined;
  replies: Map<string, Reply>;
  visibleReply?: string | undefined;
  completingReply?: string | undefined;
  seenCalls: Set<string>;
}

/** Minimal has one static message, no edits, and no card to keep for background work. */
export class MinimalProgress {
  private readonly sessions = new Map<string, WorkState>();

  constructor(private readonly delivery: Pick<TelegramEventDelivery, "sendText" | "deleteText">) {}

  activity(
    sessionId: string,
    destination: TelegramDestination,
    blockedByPrompt: boolean,
    { messageId, callId }: { messageId?: string; callId?: string } = {},
  ): void {
    const state = this.getState(sessionId);
    if (callId) {
      if (state.seenCalls.has(callId)) return;
      state.seenCalls.add(callId);
    }
    if (blockedByPrompt || (messageId && state.replies.get(messageId)?.exposed)) return;
    if (state.completingReply) {
      if (messageId !== state.completingReply) {
        const reply = state.replies.get(state.completingReply);
        if (reply) reply.nextWork ??= { destination, ...(messageId ? { messageId } : {}) };
      }
      return;
    }
    if (state.marker || state.visibleReply) return;

    this.openMarker(state, destination, sessionId);
  }

  trackReply(sessionId: string, messageId: string): void {
    const state = this.getState(sessionId);
    if (!state.replies.has(messageId)) {
      state.replies.set(messageId, { marker: state.marker, exposed: false, completed: false });
    }
  }

  beginReplyCompletion(sessionId: string, messageId: string): void {
    const state = this.sessions.get(sessionId);
    if (state?.replies.has(messageId)) state.completingReply = messageId;
  }

  beforeReply(sessionId: string, messageId: string): Promise<void> | undefined {
    const state = this.sessions.get(sessionId);
    const reply = state?.replies.get(messageId);
    if (!state || !reply || reply.exposed) return;

    reply.exposed = true;
    if (!reply.completed) state.visibleReply = messageId;
    return this.closeMarker(state, reply.marker);
  }

  completeReply(sessionId: string, messageId: string, canResume = true): void {
    const state = this.sessions.get(sessionId);
    const reply = state?.replies.get(messageId);
    if (!state || !reply) return;

    reply.completed = true;
    if (state.visibleReply === messageId) state.visibleReply = undefined;
    if (state.completingReply === messageId) state.completingReply = undefined;
    const nextWork = reply.nextWork;
    reply.nextWork = undefined;
    if (!canResume || !nextWork || state.marker || state.visibleReply) return;

    const nextReply = nextWork.messageId ? state.replies.get(nextWork.messageId) : undefined;
    if (nextReply?.exposed) return;

    // Fresh activity can arrive while the completed reply is still being delivered.
    this.openMarker(state, nextWork.destination, sessionId);
    if (nextReply) nextReply.marker = state.marker;
  }

  dropDeferredWork(sessionId: string): void {
    for (const reply of this.sessions.get(sessionId)?.replies.values() ?? []) {
      reply.nextWork = undefined;
    }
  }

  promptShown(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    state.visibleReply = undefined;
    this.dropDeferredWork(sessionId);
    void this.closeMarker(state, state.marker);
  }

  /** Capture before asynchronous termination checks, not when their result comes back. */
  captureEnd(sessionId: string): (() => Promise<void> | undefined) | undefined {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    const marker = state.marker;
    return () => {
      if (this.sessions.get(sessionId) === state && (!state.marker || state.marker === marker)) {
        this.sessions.delete(sessionId);
      }
      return this.closeMarker(state, marker);
    };
  }

  clear(sessionId?: string): void {
    if (sessionId !== undefined) {
      void this.captureEnd(sessionId)?.();
    } else {
      for (const id of this.sessions.keys()) void this.captureEnd(id)?.();
    }
  }

  private openMarker(state: WorkState, destination: TelegramDestination, sessionId: string): void {
    const marker: Marker = { destination };
    state.marker = marker;
    void this.delivery
      .sendText(destination, t("progress.compact.working_header"), { disable_notification: true })
      .then((messageId) => {
        marker.sent = { messageId, at: Date.now() };
        if (marker.closed) void this.deleteMarker(marker.destination, marker.sent);
      })
      .catch((error) => {
        logger.warn(`[MinimalProgress] Failed to send Working: session=${sessionId}`, error);
      });
  }

  private getState(sessionId: string): WorkState {
    let state = this.sessions.get(sessionId);
    if (!state) {
      state = { replies: new Map(), seenCalls: new Set() };
      this.sessions.set(sessionId, state);
    }
    return state;
  }

  private closeMarker(state: WorkState, marker: Marker | undefined): Promise<void> | undefined {
    if (!marker) return;
    if (state.marker === marker) state.marker = undefined;
    marker.closed ??=
      marker.sent === undefined
        ? Promise.resolve()
        : this.deleteMarker(marker.destination, marker.sent);
    return marker.closed;
  }

  private async deleteMarker(
    destination: TelegramDestination,
    sent: NonNullable<Marker["sent"]>,
  ): Promise<void> {
    // The Telegram API may retry a rate limit; give it a head start without holding up a reply.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deleted = this.delivery
      .deleteText(destination, sent.messageId)
      .catch((error) => this.retryStaleDeletion(destination, sent, error, 0));
    try {
      await Promise.race([
        deleted,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, DELETE_HEAD_START_MS);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private retryStaleDeletion(
    destination: TelegramDestination,
    sent: NonNullable<Marker["sent"]>,
    error: unknown,
    attempt: number,
  ): void {
    const retryAfter = getTelegramRetryAfterMs(error, 1_000, attempt);
    const backoff = Math.min(1_000 * 2 ** attempt, 60_000);
    const remaining = sent.at + TELEGRAM_DELETE_WINDOW_MS - Date.now();
    const delay = Math.max(retryAfter ?? 0, backoff);
    if ((retryAfter === null && !isTransientTelegramNetworkError(error)) || delay >= remaining) {
      logger.warn(
        `[MinimalProgress] Could not remove stale Working: message=${sent.messageId}`,
        error,
      );
      return;
    }

    setTimeout(() => {
      void this.delivery
        .deleteText(destination, sent.messageId)
        .catch((retryError) => this.retryStaleDeletion(destination, sent, retryError, attempt + 1));
    }, delay).unref();
  }
}
