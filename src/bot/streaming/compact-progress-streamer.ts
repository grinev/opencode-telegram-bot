import {
  emptyToolCallCounts,
  formatCompactSummary,
  type ToolCallCounts,
} from "../../app/formatters/compact-summary-formatter.js";
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
  activityCallId?: string | undefined;
  startedTools: Map<string, boolean>;
  // Counted calls by id, so a call reported finished twice counts once.
  toolCalls: Map<string, ToolCallCounts>;
  filePaths: Set<string>;
  backgroundActivities: Map<string, { direct?: string; nested?: string }>;
  timer: ReturnType<typeof setTimeout> | null;
  task: Promise<boolean>;
  cancelled: boolean;
  sendFailed: boolean;
}

export interface CompactProgressStreamerOptions {
  throttleMs: StreamThrottleMs;
  sendText: (sessionId: string, text: string) => Promise<number>;
  editText: (sessionId: string, messageId: number, text: string) => Promise<void>;
  deleteText?: (sessionId: string, messageId: number) => Promise<void>;
  /** A card kept open past its close for the background operations it still shows. */
  onPark?: (sessionId: string, callIds: string[]) => void;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createInitialState(sessionId: string): CompactProgressState {
  return {
    sessionId,
    messageId: null,
    latestText: "",
    startedTools: new Map(),
    toolCalls: new Map(),
    filePaths: new Set(),
    backgroundActivities: new Map(),
    timer: null,
    task: Promise.resolve(true),
    cancelled: false,
    sendFailed: false,
  };
}

export class CompactProgressStreamer {
  private readonly states = new Map<string, CompactProgressState>();
  private readonly heldBySession = new Map<string, CompactProgressState>();
  private readonly finalizing = new Set<CompactProgressState>();
  // Cards closed for their stretch that still show a running background operation.
  private readonly parked = new Set<CompactProgressState>();
  private readonly throttleMs: StreamThrottleMs;
  private readonly sendText: CompactProgressStreamerOptions["sendText"];
  private readonly editText: CompactProgressStreamerOptions["editText"];
  private readonly deleteText: CompactProgressStreamerOptions["deleteText"];
  private readonly onPark: CompactProgressStreamerOptions["onPark"];

  constructor({
    throttleMs,
    sendText,
    editText,
    deleteText,
    onPark,
  }: CompactProgressStreamerOptions) {
    this.throttleMs = throttleMs;
    this.sendText = sendText;
    this.editText = editText;
    this.deleteText = deleteText;
    this.onPark = onPark;
  }

  private resolveThrottleMs(sessionId: string): number {
    return resolveStreamThrottleMs(this.throttleMs, sessionId);
  }

  updateActivity(sessionId: string, activity: string, callId?: string): void {
    const normalizedActivity = activity.trim();
    if (!sessionId || !normalizedActivity) {
      return;
    }

    const state = (callId && this.findToolCard(sessionId, callId)) || this.getActivityCard(sessionId);
    if (this.parked.has(state)) return;
    const nested = callId ? state.backgroundActivities.get(callId)?.nested : undefined;
    this.updateActivityState(state, nested ?? normalizedActivity, callId);
  }

  registerToolCall(sessionId: string, callId: string, isTask: boolean): void {
    if (!this.findToolCard(sessionId, callId)) {
      this.getActivityCard(sessionId).startedTools.set(callId, isTask);
    }
  }

  holdForClose(sessionId: string): void {
    if (!sessionId || this.heldBySession.has(sessionId)) {
      return;
    }

    this.heldBySession.set(sessionId, createInitialState(sessionId));
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
    if (!held) return;
    const open = this.states.get(sessionId);
    if (!open) {
      this.openHeld(held);
      return;
    }
    for (const [callId, task] of held.startedTools) open.startedTools.set(callId, task);
    for (const [callId, counts] of held.toolCalls) open.toolCalls.set(callId, counts);
    for (const [callId, activity] of held.backgroundActivities) {
      open.backgroundActivities.set(callId, activity);
    }
    if (held.latestText) {
      open.latestText = held.latestText;
      open.activityCallId = held.activityCallId;
      this.ensureTimer(open);
    }
  }

  updateThinking(sessionId: string): void {
    this.updateActivity(sessionId, t("progress.compact.thinking"));
  }

  updateResponding(sessionId: string): void {
    this.updateActivity(sessionId, t("progress.compact.responding"));
  }

  addToolCall(sessionId: string, callId: string, counts: ToolCallCounts): void {
    if (!sessionId || !callId) {
      return;
    }

    const state =
      this.findToolCard(sessionId, callId) ??
      this.heldBySession.get(sessionId) ??
      this.states.get(sessionId);
    state?.toolCalls.set(callId, counts);
  }

  addFileChange(sessionId: string, filePath: string): void {
    const normalizedPath = filePath.trim();
    if (!sessionId || !normalizedPath) {
      return;
    }

    this.states.get(sessionId)?.filePaths.add(normalizedPath);
  }

  /** Promotes a launch on the card where its call first appeared, even during a close. */
  addBackgroundOperation(sessionId: string, callId: string, activity: string): void {
    if (!sessionId || !callId || !activity.trim()) {
      return;
    }

    const state = this.findToolCard(sessionId, callId) ?? this.getActivityCard(sessionId);
    if (!state.startedTools.has(callId)) state.startedTools.set(callId, false);
    this.setBackgroundActivity(state, callId, "direct", activity.trim());
  }

  updateBackgroundOperation(sessionId: string, callId: string, activity: string): void {
    const state = this.findToolCard(sessionId, callId);
    if (state?.backgroundActivities.get(callId)?.direct !== undefined && activity.trim()) {
      this.setBackgroundActivity(state, callId, "direct", activity);
    }
  }

  hasToolCall(sessionId: string, callId: string): boolean {
    return this.findToolCard(sessionId, callId) !== undefined;
  }

  isToolCallParked(sessionId: string, callId: string): boolean {
    const state = this.findToolCard(sessionId, callId);
    return state !== undefined && this.parked.has(state);
  }

  updateNestedBackgroundOperation(sessionId: string, callId: string, activity: string): void {
    const state = this.findToolCard(sessionId, callId);
    if (state) this.setBackgroundActivity(state, callId, "nested", activity);
  }

  private setBackgroundActivity(
    state: CompactProgressState,
    callId: string,
    kind: "direct" | "nested",
    activity: string,
  ): void {
    const current = state.backgroundActivities.get(callId) ?? {};
    if (current[kind] === activity) return;
    current[kind] = activity;
    state.backgroundActivities.set(callId, current);
    if (this.parked.has(state)) {
      this.showNewestBackgroundOperation(state);
    } else if (state.activityCallId === callId) {
      this.updateActivityState(state, current.nested ?? activity, callId);
    }
  }

  /** Counts the ended operation on its own card and closes a parked card left with none. */
  async endBackgroundOperation(
    sessionId: string,
    callId: string,
    counts: ToolCallCounts,
    deleteOnFinish = false,
  ): Promise<void> {
    await this.endBackgroundActivity(sessionId, callId, "direct", counts, deleteOnFinish);
  }

  async endNestedBackgroundOperation(
    sessionId: string,
    callId: string,
    counts: ToolCallCounts | undefined,
    deleteOnFinish: boolean,
  ): Promise<void> {
    await this.endBackgroundActivity(sessionId, callId, "nested", counts, deleteOnFinish);
  }

  private async endBackgroundActivity(
    sessionId: string,
    callId: string,
    kind: "direct" | "nested",
    counts: ToolCallCounts | undefined,
    deleteOnFinish: boolean,
  ): Promise<void> {
    const state = this.findToolCard(sessionId, callId);
    const activity = state?.backgroundActivities.get(callId);
    if (!state || activity?.[kind] === undefined) return;
    if (counts) state.toolCalls.set(callId, counts);
    delete activity[kind];
    if (!activity.direct && !activity.nested) state.backgroundActivities.delete(callId);
    if (this.parked.has(state)) {
      if (state.backgroundActivities.size > 0) this.showNewestBackgroundOperation(state);
      else await this.closeParked(state, deleteOnFinish);
    } else if (state.activityCallId === callId && activity.direct) {
      this.updateActivityState(state, activity.direct, callId);
    }
  }

  /** A confirmed server loss ends task-bearing progress; command-only cards still freeze. */
  endBackgroundTasks(
    sessionId: string,
    countEndedCall: (callId: string, isTask: boolean) => ToolCallCounts,
    deleteOnFinish: boolean,
  ): { hadOpenTask: boolean; parkedClosed: Promise<void> } {
    let hadOpenTask = false;
    const closing: Promise<void>[] = [];
    const open = this.states.get(sessionId);
    const held = this.heldBySession.get(sessionId);
    for (const state of [open, held, ...this.parked]) {
      if (state?.sessionId !== sessionId) continue;
      const calls = [...state.backgroundActivities.keys()];
      if (!calls.some((id) => state.startedTools.get(id))) continue;
      for (const id of calls) {
        state.toolCalls.set(id, countEndedCall(id, state.startedTools.get(id) === true));
      }
      state.backgroundActivities.clear();
      if (this.parked.has(state)) closing.push(this.closeParked(state, deleteOnFinish));
      else hadOpenTask = true;
    }
    return { hadOpenTask, parkedClosed: Promise.all(closing).then(() => undefined) };
  }

  private async closeParked(state: CompactProgressState, deleteOnFinish: boolean): Promise<void> {
    this.parked.delete(state);
    this.clearTimer(state);
    this.finalizing.add(state);
    await this.closeState(state, deleteOnFinish);
  }

  /** Forgets background operations of a session (or all); their cards stay as they are. */
  dropBackgroundOperations(sessionId?: string): void {
    for (const state of [...this.states.values(), ...this.heldBySession.values()]) {
      if (sessionId === undefined || state.sessionId === sessionId) {
        state.backgroundActivities.clear();
      }
    }
    this.cancelParked(sessionId);
  }

  async finalize(sessionId: string, deleteOnFinish = false): Promise<void> {
    const state = this.states.get(sessionId);
    if (state) {
      this.clearTimer(state);
      this.states.delete(sessionId);
      if (state.backgroundActivities.size > 0) {
        this.parked.add(state);
      } else {
        this.finalizing.add(state);
      }
    }

    const held = this.heldBySession.get(sessionId);
    this.heldBySession.delete(sessionId);
    const parked = state && this.parked.has(state) ? state : undefined;
    if (parked) {
      this.onPark?.(sessionId, Array.from(parked.backgroundActivities.keys()));
    }
    if (held) this.openHeld(held);

    if (!state) {
      return;
    }

    if (parked) {
      this.showNewestBackgroundOperation(parked);
      return;
    }

    await this.closeState(state, deleteOnFinish);
  }

  private async closeState(state: CompactProgressState, deleteOnFinish: boolean): Promise<void> {
    try {
      await state.task.catch(() => false);

      if (state.cancelled || (state.messageId === null && state.sendFailed)) {
        return;
      }

      // A card with nothing to count goes the way "Delete progress on finish" takes it.
      const summary = this.formatSummary(state);
      if ((deleteOnFinish || !summary) && this.deleteText) {
        await this.deleteProgressMessage(state);
        return;
      }

      if (!summary) {
        return;
      }

      state.latestText = summary;
      await this.syncState(state, "finalize");
    } finally {
      this.finalizing.delete(state);
      this.cancelState(state);
    }
  }

  private formatSummary(state: CompactProgressState): string {
    const totals = emptyToolCallCounts();
    for (const counts of state.toolCalls.values()) {
      totals.commands += counts.commands;
      totals.edits += counts.edits;
      totals.reads += counts.reads;
      totals.tools += counts.tools;
    }

    return formatCompactSummary(totals, state.filePaths.size);
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
    const cancelledParked = this.cancelParked(sessionId);
    const cleared = this.clearOpenCard(sessionId);
    if (!cleared && !cancelledParked) {
      return;
    }

    logger.debug(`[CompactProgress] Cleared session: session=${sessionId}, reason=${reason}`);
  }

  /** Drops the open card only; parked cards keep showing their background operations. */
  discardOpenCard(sessionId: string, reason: string): void {
    if (this.clearOpenCard(sessionId)) {
      logger.debug(`[CompactProgress] Discarded open card: session=${sessionId}, reason=${reason}`);
    }
  }

  private clearOpenCard(sessionId: string): boolean {
    this.heldBySession.delete(sessionId);
    const state = this.states.get(sessionId);
    if (state) {
      this.clearTimer(state);
      this.cancelState(state);
      this.states.delete(sessionId);
    }

    const cancelledFinalizing = this.cancelFinalizing(sessionId);
    return Boolean(state) || cancelledFinalizing;
  }

  clearAll(reason: string): void {
    this.heldBySession.clear();
    for (const state of this.states.values()) {
      this.clearTimer(state);
      this.cancelState(state);
    }
    this.states.clear();
    this.cancelFinalizing();
    this.cancelParked();
    logger.debug(`[CompactProgress] Cleared all sessions: reason=${reason}`);
  }

  private findToolCard(sessionId: string, callId: string): CompactProgressState | undefined {
    const open = this.states.get(sessionId);
    if (open?.startedTools.has(callId)) return open;
    const held = this.heldBySession.get(sessionId);
    if (held?.startedTools.has(callId)) return held;

    for (const state of this.parked) {
      if (state.sessionId === sessionId && state.startedTools.has(callId)) {
        return state;
      }
    }

    return undefined;
  }

  /** A parked card shows the most recently started background operation still running. */
  private showNewestBackgroundOperation(state: CompactProgressState): void {
    for (const callId of [...state.startedTools.keys()].reverse()) {
      const operation = state.backgroundActivities.get(callId);
      const activity = operation?.nested ?? operation?.direct;
      if (!activity) continue;
      this.updateActivityState(state, activity, callId);
      return;
    }
  }

  private cancelParked(sessionId?: string): boolean {
    let cancelled = false;
    for (const state of Array.from(this.parked)) {
      if (sessionId === undefined || state.sessionId === sessionId) {
        this.clearTimer(state);
        this.cancelState(state);
        this.parked.delete(state);
        cancelled = true;
      }
    }
    return cancelled;
  }

  private openHeld(held: CompactProgressState): void {
    if (!held.latestText && !held.startedTools.size) return;
    this.states.set(held.sessionId, held);
    if (held.latestText) this.ensureTimer(held);
  }

  private getActivityCard(sessionId: string): CompactProgressState {
    const held = this.heldBySession.get(sessionId);
    if (held) return held;
    const existing = this.states.get(sessionId);
    if (existing) {
      return existing;
    }

    const state = createInitialState(sessionId);
    this.states.set(sessionId, state);
    return state;
  }

  private updateActivityState(state: CompactProgressState, activity: string, callId?: string): void {
    state.activityCallId = callId;
    state.latestText = t("progress.compact.activity", {
      header: t("progress.compact.working_header"),
      activity,
    });
    if (this.heldBySession.get(state.sessionId) !== state) this.ensureTimer(state);
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
