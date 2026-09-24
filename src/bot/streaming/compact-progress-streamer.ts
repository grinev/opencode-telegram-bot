import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import {
  resolveStreamThrottleMs,
  type StreamThrottleMs,
} from "./stream-throttle.js";

interface CompactProgressState {
  sessionId: string;
  messageId: number | null;
  latestText: string;
  toolCallIds: Set<string>;
  filePaths: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
  task: Promise<boolean>;
  cancelled: boolean;
  sendFailed: boolean;
}

interface HeldStretch {
  activity: string | null;
  toolCallIds: string[];
}

export interface CompactProgressStreamerOptions {
  throttleMs: StreamThrottleMs;
  sendText: (sessionId: string, text: string) => Promise<number>;
  editText: (sessionId: string, messageId: number, text: string) => Promise<void>;
  deleteText?: (sessionId: string, messageId: number) => Promise<void>;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createInitialState(sessionId: string): CompactProgressState {
  return {
    sessionId,
    messageId: null,
    latestText: "",
    toolCallIds: new Set(),
    filePaths: new Set(),
    timer: null,
    task: Promise.resolve(true),
    cancelled: false,
    sendFailed: false,
  };
}

export class CompactProgressStreamer {
  private readonly states = new Map<string, CompactProgressState>();
  private readonly heldBySession = new Map<string, HeldStretch>();
  private readonly finalizing = new Set<CompactProgressState>();
  private readonly throttleMs: StreamThrottleMs;
  private readonly sendText: CompactProgressStreamerOptions["sendText"];
  private readonly editText: CompactProgressStreamerOptions["editText"];
  private readonly deleteText: CompactProgressStreamerOptions["deleteText"];

  constructor({ throttleMs, sendText, editText, deleteText }: CompactProgressStreamerOptions) {
    this.throttleMs = throttleMs;
    this.sendText = sendText;
    this.editText = editText;
    this.deleteText = deleteText;
  }

  private resolveThrottleMs(sessionId: string): number {
    return resolveStreamThrottleMs(this.throttleMs, sessionId);
  }

  updateActivity(sessionId: string, activity: string): void {
    const normalizedActivity = activity.trim();
    if (!sessionId || !normalizedActivity) {
      return;
    }

    const held = this.heldBySession.get(sessionId);
    if (held) {
      held.activity = normalizedActivity;
      return;
    }

    this.updateActivityState(sessionId, normalizedActivity, true);
  }

  holdForClose(sessionId: string): void {
    if (!sessionId || this.heldBySession.has(sessionId)) {
      return;
    }

    this.heldBySession.set(sessionId, { activity: null, toolCallIds: [] });
  }

  isHolding(sessionId: string): boolean {
    return this.heldBySession.has(sessionId);
  }

  hasPendingSend(sessionId: string): boolean {
    const state = this.states.get(sessionId);
    return Boolean(state && state.messageId === null && !state.cancelled && state.latestText.trim());
  }

  async flushPending(sessionId: string): Promise<void> {
    const state = this.states.get(sessionId);
    if (!state || state.messageId !== null || state.cancelled) {
      return;
    }

    if (!state.timer) {
      await state.task;
      return;
    }

    this.clearTimer(state);
    await this.enqueueTask(state, () => this.syncState(state, "flush"));
  }

  releaseHold(sessionId: string): void {
    const held = this.heldBySession.get(sessionId);
    this.heldBySession.delete(sessionId);
    this.replayHeld(sessionId, held);
  }

  updateThinking(sessionId: string): void {
    this.updateActivity(sessionId, t("progress.compact.thinking"));
  }

  updateResponding(sessionId: string): void {
    this.updateActivity(sessionId, t("progress.compact.responding"));
  }

  addToolCall(sessionId: string, callId: string): void {
    if (!sessionId || !callId) {
      return;
    }

    const held = this.heldBySession.get(sessionId);
    if (held) {
      if (!held.toolCallIds.includes(callId)) {
        held.toolCallIds.push(callId);
      }
      return;
    }

    this.states.get(sessionId)?.toolCallIds.add(callId);
  }

  addFileChange(sessionId: string, filePath: string): void {
    const normalizedPath = filePath.trim();
    if (!sessionId || !normalizedPath) {
      return;
    }

    this.states.get(sessionId)?.filePaths.add(normalizedPath);
  }

  async finalize(sessionId: string, deleteOnFinish = false): Promise<void> {
    const state = this.states.get(sessionId);
    if (state) {
      this.clearTimer(state);
      this.states.delete(sessionId);
      this.finalizing.add(state);
    }

    const held = this.heldBySession.get(sessionId);
    this.heldBySession.delete(sessionId);
    this.replayHeld(sessionId, held);

    if (!state) {
      return;
    }

    try {
      await state.task.catch(() => false);

      if (state.cancelled || (state.messageId === null && state.sendFailed)) {
        return;
      }

      if (deleteOnFinish && this.deleteText) {
        await this.deleteProgressMessage(state);
        return;
      }

      state.latestText = t("progress.compact.done", {
        header: t("progress.compact.finished_header"),
        tools: state.toolCallIds.size,
        files: state.filePaths.size,
      });

      await this.syncState(state, "finalize");
    } finally {
      this.finalizing.delete(state);
      this.cancelState(state);
    }
  }

  private async deleteProgressMessage(state: CompactProgressState): Promise<void> {
    if (state.messageId === null) {
      return;
    }

    try {
      await this.deleteText?.(state.sessionId, state.messageId);
    } catch (error) {
      logger.error(
        `[CompactProgress] Failed to delete progress message: session=${state.sessionId}, error=${getErrorMessage(error)}`,
        error,
      );
    }
  }

  clearSession(sessionId: string, reason: string): void {
    this.heldBySession.delete(sessionId);
    const state = this.states.get(sessionId);
    if (state) {
      this.clearTimer(state);
      this.cancelState(state);
      this.states.delete(sessionId);
    }

    const cancelledFinalizing = this.cancelFinalizing(sessionId);
    if (!state && !cancelledFinalizing) {
      return;
    }

    logger.debug(`[CompactProgress] Cleared session: session=${sessionId}, reason=${reason}`);
  }

  clearAll(reason: string): void {
    this.heldBySession.clear();
    for (const state of this.states.values()) {
      this.clearTimer(state);
      this.cancelState(state);
    }
    this.states.clear();
    this.cancelFinalizing();
    logger.debug(`[CompactProgress] Cleared all sessions: reason=${reason}`);
  }

  private replayHeld(sessionId: string, held: HeldStretch | undefined): void {
    if (!held) {
      return;
    }

    if (held.activity) {
      this.updateActivity(sessionId, held.activity);
    }

    for (const callId of held.toolCallIds) {
      this.addToolCall(sessionId, callId);
    }
  }

  private getOrCreateState(sessionId: string): CompactProgressState {
    const existing = this.states.get(sessionId);
    if (existing) {
      return existing;
    }

    const state = createInitialState(sessionId);
    this.states.set(sessionId, state);
    return state;
  }

  private updateActivityState(sessionId: string, activity: string, createIfMissing: boolean): void {
    const normalizedActivity = activity.trim();
    if (!sessionId || !normalizedActivity) {
      return;
    }

    const state = createIfMissing ? this.getOrCreateState(sessionId) : this.states.get(sessionId);
    if (!state) {
      return;
    }

    state.latestText = t("progress.compact.activity", {
      header: t("progress.compact.working_header"),
      activity: normalizedActivity,
    });
    this.ensureTimer(state);
  }

  private ensureTimer(state: CompactProgressState): void {
    if (state.cancelled || state.timer) {
      return;
    }

    const throttleMs = this.resolveThrottleMs(state.sessionId);
    if (throttleMs <= 0) {
      state.task = this.enqueueTask(state, () => this.syncState(state, "immediate"));
      return;
    }

    state.timer = setTimeout(() => {
      state.timer = null;
      state.task = this.enqueueTask(state, () => this.syncState(state, "throttle"));
    }, throttleMs);
  }

  private enqueueTask(
    state: CompactProgressState,
    task: () => Promise<boolean>,
  ): Promise<boolean> {
    const nextTask = state.task
      .catch(() => false)
      .then(async () => {
        if (state.cancelled) {
          return false;
        }
        return task();
      });
    state.task = nextTask;
    return nextTask;
  }

  private async syncState(state: CompactProgressState, reason: string): Promise<boolean> {
    const text = state.latestText.trim();
    if (!text || state.cancelled) {
      return false;
    }

    try {
      if (state.messageId === null) {
        state.messageId = await this.sendText(state.sessionId, text);
      } else {
        await this.editText(state.sessionId, state.messageId, text);
      }

      logger.debug(
        `[CompactProgress] Synced progress message: session=${state.sessionId}, reason=${reason}`,
      );
      return true;
    } catch (error) {
      logger.error(
        `[CompactProgress] Failed to sync progress message: session=${state.sessionId}, reason=${reason}, error=${getErrorMessage(error)}`,
        error,
      );
      if (state.messageId === null) {
        state.sendFailed = true;
      }
      return false;
    }
  }

  private clearTimer(state: CompactProgressState): void {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
  }

  private cancelState(state: CompactProgressState): void {
    state.cancelled = true;
  }

  private cancelFinalizing(sessionId?: string): boolean {
    let cancelled = false;
    for (const state of this.finalizing) {
      if (sessionId === undefined || state.sessionId === sessionId) {
        this.cancelState(state);
        cancelled = true;
      }
    }
    return cancelled;
  }
}
