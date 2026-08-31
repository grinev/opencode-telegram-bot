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
}

export interface CompactProgressStreamerOptions {
  throttleMs: StreamThrottleMs;
  sendText: (sessionId: string, text: string) => Promise<number>;
  editText: (sessionId: string, messageId: number, text: string) => Promise<void>;
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
  };
}

export class CompactProgressStreamer {
  private readonly states = new Map<string, CompactProgressState>();
  private readonly throttleMs: StreamThrottleMs;
  private readonly sendText: CompactProgressStreamerOptions["sendText"];
  private readonly editText: CompactProgressStreamerOptions["editText"];

  constructor({ throttleMs, sendText, editText }: CompactProgressStreamerOptions) {
    this.throttleMs = throttleMs;
    this.sendText = sendText;
    this.editText = editText;
  }

  private resolveThrottleMs(sessionId: string): number {
    return resolveStreamThrottleMs(this.throttleMs, sessionId);
  }

  updateActivity(sessionId: string, activity: string): void {
    this.updateActivityState(sessionId, activity, true);
  }

  updateThinking(sessionId: string): void {
    this.updateActivityState(sessionId, t("progress.compact.thinking"), false);
  }

  updateResponding(sessionId: string): void {
    this.updateActivity(sessionId, t("progress.compact.responding"));
  }

  updateWaitingForQuestion(sessionId: string): void {
    this.updateActivity(sessionId, t("progress.compact.waiting_question"));
  }

  updateWaitingForPermission(sessionId: string): void {
    this.updateActivity(sessionId, t("progress.compact.waiting_permission"));
  }

  addToolCall(sessionId: string, callId: string): void {
    if (!sessionId || !callId) {
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

  async finalize(sessionId: string): Promise<void> {
    const state = this.states.get(sessionId);
    if (!state) {
      return;
    }

    state.latestText = t("progress.compact.done", {
      header: t("progress.compact.finished_header"),
      tools: state.toolCallIds.size,
      files: state.filePaths.size,
    });

    this.clearTimer(state);
    await state.task.catch(() => false);
    await this.syncState(state, "finalize");
    this.cancelState(state);
    this.states.delete(sessionId);
  }

  clearSession(sessionId: string, reason: string): void {
    const state = this.states.get(sessionId);
    if (!state) {
      return;
    }

    this.clearTimer(state);
    this.cancelState(state);
    this.states.delete(sessionId);
    logger.debug(`[CompactProgress] Cleared session: session=${sessionId}, reason=${reason}`);
  }

  clearAll(reason: string): void {
    for (const state of this.states.values()) {
      this.clearTimer(state);
      this.cancelState(state);
    }
    this.states.clear();
    logger.debug(`[CompactProgress] Cleared all sessions: reason=${reason}`);
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
}
