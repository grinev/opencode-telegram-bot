import {
  outlivesParentTurn,
  type SubagentInfo,
  type ToolInfo,
} from "../../app/managers/summary-aggregation-manager.js";
import { TOOL_ELAPSED_THRESHOLD_MS } from "../../app/formatters/duration-formatter.js";
import { ToolMessageBatcher } from "../../app/formatters/tool-message-batcher.js";
import { logger } from "../../utils/logger.js";
import {
  getResponseStreamingMode,
  type ResponseStreamingMode,
} from "../../app/stores/settings-store.js";
import type { ThinkingSection } from "../messages/thinking-rendering.js";
import { ResponseStreamer, type StreamingMessagePayload } from "../streaming/response-streamer.js";
import { ToolCallStreamer } from "../streaming/tool-call-streamer.js";
import { RunningToolTracker, type RunningToolTick } from "../streaming/running-tool-tracker.js";
import { CompactProgressStreamer } from "../streaming/compact-progress-streamer.js";
import { getSessionStreamThrottleMs } from "../streaming/stream-throttle.js";
import { setResponseStreamerForReconciliation } from "../../app/services/busy-reconciliation-service.js";
import {
  TelegramEventDelivery,
  type SessionTargetPolicy,
  type TelegramDestination,
} from "./telegram-event-delivery.js";

const TOOL_ELAPSED_TICK_INTERVAL_MS = 5000;
export const TOOL_ELAPSED_MAX_TRACKING_HOURS = 24;
const TOOL_ELAPSED_MAX_TRACKING_MS = TOOL_ELAPSED_MAX_TRACKING_HOURS * 60 * 60 * 1000;

type ReplyKeyboard = NonNullable<
  NonNullable<Parameters<TelegramDestination["api"]["sendMessage"]>[2]>["reply_markup"]
>;

export interface SessionRuntimeStateOptions {
  policy: SessionTargetPolicy;
  getReplyKeyboard: () => ReplyKeyboard | undefined;
}

export interface UndeliveredAssistantDraft {
  messageId: string;
  text: string;
}

export interface CompactActivity {
  callId: string;
  activity: string;
}

/** What output that began after a reply's text waits for before it opens a new message. */
export type ReplyGate = () => Promise<void>;

interface RunningToolHooks {
  onTick: (tick: RunningToolTick) => void;
  onHeartbeat: (sessionId: string) => void;
}

function isRunningBackgroundSubagent(subagent: SubagentInfo): boolean {
  return Boolean(
    outlivesParentTurn(subagent) &&
      (subagent.status === "pending" || subagent.status === "running"),
  );
}

function sessionKey(sessionId: string, id: string): string {
  return `${sessionId}:${id}`;
}

function deleteSessionKeys(map: Map<string, unknown>, sessionId: string): void {
  const sessionPrefix = `${sessionId}:`;
  for (const key of Array.from(map.keys())) {
    if (key.startsWith(sessionPrefix)) {
      map.delete(key);
    }
  }
}

/**
 * Owns everything the bridge keeps while sessions run: the streamers, the
 * running-tool tracker and per-session bookkeeping. Every entry is keyed by
 * session, so one session can be cleared without touching another.
 */
export class SessionRuntimeState {
  readonly delivery = new TelegramEventDelivery();
  readonly assistantEditStreamer: ResponseStreamer;
  readonly assistantDraftStreamer: ResponseStreamer;
  readonly thinkingStreamer: ResponseStreamer;
  readonly toolCallStreamer: ToolCallStreamer;
  readonly toolMessageBatcher: ToolMessageBatcher;
  readonly compactProgressStreamer: CompactProgressStreamer;
  readonly runningToolTracker: RunningToolTracker;

  private readonly policy: SessionTargetPolicy;
  private runningToolHooks: RunningToolHooks | null = null;
  private readonly assistantStreamModes = new Map<string, ResponseStreamingMode>();
  // Full text of each streamed reply, and how much of it was already sent
  // early, before a question or permission prompt. Both are prefixes of the
  // message's full text.
  private readonly assistantLatestTexts = new Map<string, string>();
  private readonly assistantDeliveredTexts = new Map<string, string>();
  private readonly assistantCompletionsStarted = new Set<string>();
  // `edit` replies whose text has begun: output that starts after it goes below the reply.
  private readonly begunReplies = new Set<string>();
  // Per session: settling the output that came before the latest reply's text, and the
  // compact-mode wait before a reply's first partial reaches its stream.
  private readonly replyCuts = new Map<string, Promise<void>>();
  private readonly replyEnqueueDeferrals = new Map<string, Promise<void>>();
  // Compact mode: the reply whose card still has to close before the next activity, and
  // the replies whose card was already closed that way.
  private readonly compactCloseDue = new Map<string, string>();
  private readonly compactClosedReplies = new Set<string>();
  private readonly thinkingSections = new Map<string, ThinkingSection[]>();
  private readonly completionTasks = new Map<string, Promise<void>>();
  private readonly runningToolInfos = new Map<string, ToolInfo>();
  private readonly completedToolDurations = new Map<string, number>();
  private readonly compactActivityBySession = new Map<string, CompactActivity>();
  private readonly subagentSnapshots = new Map<string, SubagentInfo[]>();

  constructor({ policy, getReplyKeyboard }: SessionRuntimeStateOptions) {
    this.policy = policy;

    this.runningToolTracker = new RunningToolTracker({
      thresholdMs: TOOL_ELAPSED_THRESHOLD_MS,
      tickIntervalMs: TOOL_ELAPSED_TICK_INTERVAL_MS,
      maxTrackingMs: TOOL_ELAPSED_MAX_TRACKING_MS,
      onTick: (tick) => this.runningToolHooks?.onTick(tick),
      onHeartbeat: (sessionId) => this.runningToolHooks?.onHeartbeat(sessionId),
    });

    this.toolMessageBatcher = new ToolMessageBatcher({
      takeTextGate: (sessionId) => this.takeReplyGate(sessionId),
      sendText: async (sessionId, text) => {
        const destination = this.getForegroundDestination(sessionId);
        if (!destination) {
          return;
        }

        const keyboard = getReplyKeyboard();
        await this.delivery.sendText(destination, text, {
          disable_notification: true,
          ...(keyboard ? { reply_markup: keyboard } : {}),
        });
      },
      sendFile: async (sessionId, fileData) => {
        const destination = this.getForegroundDestination(sessionId);
        if (!destination) {
          return;
        }

        const keyboard = getReplyKeyboard();
        await this.delivery.sendDocument(destination, fileData, {
          disable_notification: true,
          ...(keyboard ? { reply_markup: keyboard } : {}),
        });
      },
    });

    this.assistantEditStreamer = this.createEditResponseStreamer();
    this.assistantDraftStreamer = this.createDraftResponseStreamer();
    this.thinkingStreamer = this.createEditResponseStreamer();
    setResponseStreamerForReconciliation({
      hasActiveStream: (sessionId) => this.hasActiveAssistantResponse(sessionId),
    });

    this.compactProgressStreamer = new CompactProgressStreamer({
      throttleMs: getSessionStreamThrottleMs,
      sendText: (sessionId, text) =>
        this.delivery.sendText(
          this.requireForegroundDestination(sessionId, "Compact progress", "send"),
          text,
          {
            disable_notification: true,
          },
        ),
      editText: (sessionId, messageId, text) =>
        this.delivery.editText(
          this.requireForegroundDestination(sessionId, "Compact progress", "edit"),
          messageId,
          text,
        ),
      deleteText: (sessionId, messageId) =>
        this.delivery.deleteText(
          this.requireForegroundDestination(sessionId, "Compact progress", "delete"),
          messageId,
        ),
      // A parked card keeps its background operations; the next stretch no longer runs them.
      onPark: (sessionId, callIds) => {
        this.runningToolTracker.detach(callIds);
        const cached = this.compactActivityBySession.get(sessionId);
        if (cached && callIds.includes(cached.callId)) {
          this.compactActivityBySession.delete(sessionId);
        }
      },
    });

    this.toolCallStreamer = new ToolCallStreamer({
      throttleMs: getSessionStreamThrottleMs,
      takeGate: (sessionId) => this.takeReplyGate(sessionId),
      sendText: (sessionId, text) =>
        this.delivery.sendText(
          this.requireForegroundDestination(sessionId, "Tool stream", "send"),
          text,
          {
            disable_notification: true,
          },
        ),
      editText: (sessionId, messageId, text) =>
        this.delivery.editText(
          this.requireForegroundDestination(sessionId, "Tool stream", "edit"),
          messageId,
          text,
        ),
      deleteText: (sessionId, messageId) =>
        this.delivery.deleteText(
          this.requireForegroundDestination(sessionId, "Tool stream", "delete"),
          messageId,
        ),
    });
  }

  setRunningToolHooks(hooks: RunningToolHooks): void {
    this.runningToolHooks = hooks;
  }

  // --- assistant response streams ---

  getAssistantStreamMode(sessionId: string, messageId: string): ResponseStreamingMode {
    return (
      this.assistantStreamModes.get(sessionKey(sessionId, messageId)) ?? getResponseStreamingMode()
    );
  }

  markAssistantCompletionStarted(sessionId: string, messageId: string): void {
    this.assistantCompletionsStarted.add(sessionKey(sessionId, messageId));
  }

  isAssistantCompletionStarted(sessionId: string, messageId: string): boolean {
    return this.assistantCompletionsStarted.has(sessionKey(sessionId, messageId));
  }

  enqueueAssistantResponse(
    sessionId: string,
    messageId: string,
    payload: StreamingMessagePayload,
  ): void {
    const mode = this.getAssistantStreamMode(sessionId, messageId);
    this.assistantStreamModes.set(sessionKey(sessionId, messageId), mode);
    this.getAssistantStreamer(mode).enqueue(sessionId, messageId, payload);
  }

  async completeAssistantResponse(
    sessionId: string,
    messageId: string,
    payload?: StreamingMessagePayload,
    options?: Parameters<ResponseStreamer["complete"]>[3],
  ) {
    const mode = this.getAssistantStreamMode(sessionId, messageId);
    const result = await this.getAssistantStreamer(mode).complete(
      sessionId,
      messageId,
      payload,
      options,
    );
    this.deleteAssistantResponseRecords(sessionId, messageId);
    return result;
  }

  /**
   * Turns a draft into real messages before the message itself completes.
   * The stream mode and the text records are kept: the rest of the message
   * streams in the mode it started in and completion skips what went out.
   */
  async completeAssistantDraftEarly(
    sessionId: string,
    messageId: string,
    payload?: StreamingMessagePayload,
    options?: Parameters<ResponseStreamer["complete"]>[3],
  ) {
    this.assistantStreamModes.set(sessionKey(sessionId, messageId), "draft");
    return this.assistantDraftStreamer.complete(sessionId, messageId, payload, options);
  }

  recordAssistantText(sessionId: string, messageId: string, text: string): void {
    this.assistantLatestTexts.set(sessionKey(sessionId, messageId), text);
  }

  /** Marks a reply's text as sent early; returns what was marked before. */
  markAssistantTextDelivered(
    sessionId: string,
    messageId: string,
    text: string | undefined,
  ): string | undefined {
    const key = sessionKey(sessionId, messageId);
    const previousText = this.assistantDeliveredTexts.get(key);
    if (text === undefined) {
      this.assistantDeliveredTexts.delete(key);
    } else {
      this.assistantDeliveredTexts.set(key, text);
    }
    return previousText;
  }

  /** Draft-mode replies of a session with text that has not been sent yet. */
  getUndeliveredAssistantDrafts(sessionId: string): UndeliveredAssistantDraft[] {
    const sessionPrefix = `${sessionId}:`;
    const drafts: UndeliveredAssistantDraft[] = [];
    for (const [key, text] of this.assistantLatestTexts) {
      if (!key.startsWith(sessionPrefix)) {
        continue;
      }

      const messageId = key.slice(sessionPrefix.length);
      if (this.getAssistantStreamMode(sessionId, messageId) !== "draft") {
        continue;
      }

      if (!this.stripDeliveredAssistantText(sessionId, messageId, text).trim()) {
        continue;
      }

      drafts.push({ messageId, text });
    }

    return drafts;
  }

  /** The part of a reply's full text that was not sent early. */
  stripDeliveredAssistantText(sessionId: string, messageId: string, text: string): string {
    const deliveredText = this.assistantDeliveredTexts.get(sessionKey(sessionId, messageId));
    if (!deliveredText) {
      return text;
    }

    if (!text.startsWith(deliveredText)) {
      logger.warn(
        `[Bot] Reply text no longer extends the part sent early, sending it whole: session=${sessionId}, message=${messageId}`,
      );
      return text;
    }

    const remainder = text.slice(deliveredText.length);
    return remainder.trim() ? remainder : "";
  }

  clearAssistantResponse(sessionId: string, messageId: string, reason: string): void {
    this.deleteAssistantResponseRecords(sessionId, messageId);
    this.assistantEditStreamer.clearMessage(sessionId, messageId, reason);
    this.assistantDraftStreamer.clearMessage(sessionId, messageId, reason);
  }

  clearAssistantResponseSession(sessionId: string, reason: string): void {
    deleteSessionKeys(this.assistantStreamModes, sessionId);
    deleteSessionKeys(this.assistantLatestTexts, sessionId);
    deleteSessionKeys(this.assistantDeliveredTexts, sessionId);
    for (const keys of [
      this.assistantCompletionsStarted,
      this.begunReplies,
      this.compactClosedReplies,
    ]) {
      for (const key of Array.from(keys)) {
        if (key.startsWith(`${sessionId}:`)) {
          keys.delete(key);
        }
      }
    }
    this.replyCuts.delete(sessionId);
    this.replyEnqueueDeferrals.delete(sessionId);
    this.compactCloseDue.delete(sessionId);
    this.assistantEditStreamer.clearSession(sessionId, reason);
    this.assistantDraftStreamer.clearSession(sessionId, reason);
  }

  hasActiveAssistantResponse(sessionId: string): boolean {
    return (
      this.assistantEditStreamer.hasActiveStream(sessionId) ||
      this.assistantDraftStreamer.hasActiveStream(sessionId)
    );
  }

  // --- order of a reply and what follows it ---

  isReplyBegun(sessionId: string, messageId: string): boolean {
    return this.begunReplies.has(sessionKey(sessionId, messageId));
  }

  markReplyBegun(sessionId: string, messageId: string): void {
    this.begunReplies.add(sessionKey(sessionId, messageId));
  }

  /**
   * Settles the output that came before a reply's text where it is: queued tool
   * messages finish, and the tool stream breaks so later tools open a new message.
   */
  startReplyCut(sessionId: string): void {
    const previousCut = this.replyCuts.get(sessionId);
    const cut = Promise.all([
      previousCut,
      this.toolMessageBatcher.flushSession(sessionId, "assistant_reply_started"),
      this.toolCallStreamer.breakSession(sessionId, "assistant_reply_started"),
    ])
      .then(() => undefined)
      .catch((error) => {
        logger.error(`[Bot] Failed to settle output before a reply: session=${sessionId}`, error);
      });
    this.replyCuts.set(sessionId, cut);
    void cut.finally(() => {
      if (this.replyCuts.get(sessionId) === cut) {
        this.replyCuts.delete(sessionId);
      }
    });
  }

  setReplyEnqueueDeferral(sessionId: string, deferral: Promise<void>): void {
    this.replyEnqueueDeferrals.set(sessionId, deferral);
    void deferral.finally(() => {
      if (this.replyEnqueueDeferrals.get(sessionId) === deferral) {
        this.replyEnqueueDeferrals.delete(sessionId);
      }
    });
  }

  /**
   * Taken when output enters its queue: letting it out sends the replies begun by
   * then that are not on screen yet, after the output that came before them.
   */
  takeReplyGate(sessionId: string): ReplyGate | undefined {
    const sessionPrefix = `${sessionId}:`;
    const messageIds = Array.from(this.begunReplies)
      .filter((key) => key.startsWith(sessionPrefix))
      .map((key) => key.slice(sessionPrefix.length));
    if (messageIds.length === 0) {
      return undefined;
    }

    const deferral = this.replyEnqueueDeferrals.get(sessionId);
    const cut = this.replyCuts.get(sessionId);
    return async () => {
      await deferral?.catch(() => undefined);
      await cut;
      for (const messageId of messageIds) {
        await this.assistantEditStreamer.flushPending(sessionId, messageId);
      }
    };
  }

  async letOutReplies(sessionId: string): Promise<void> {
    await this.takeReplyGate(sessionId)?.();
  }

  /**
   * A document opens its boundary only once no cut it has not waited for is running,
   * so it never joins a boundary a cut is waiting on.
   */
  async letOutRepliesBeforeDocument(sessionId: string): Promise<void> {
    let cut: Promise<void> | undefined;
    do {
      cut = this.replyCuts.get(sessionId);
      await this.letOutReplies(sessionId);
    } while (this.replyCuts.get(sessionId) !== cut);
  }

  markCompactCloseDue(sessionId: string, messageId: string): void {
    this.compactCloseDue.set(sessionId, messageId);
  }

  /** Takes the reply whose card closes now, remembering it was closed that way. */
  takeCompactCloseDue(sessionId: string): string | undefined {
    const messageId = this.compactCloseDue.get(sessionId);
    if (messageId === undefined) {
      return undefined;
    }

    this.compactCloseDue.delete(sessionId);
    this.compactClosedReplies.add(sessionKey(sessionId, messageId));
    return messageId;
  }

  /** At a reply's completion: whether its card already closed, dropping its marks. */
  takeCompactClosedForReply(sessionId: string, messageId: string): boolean {
    if (this.compactCloseDue.get(sessionId) === messageId) {
      this.compactCloseDue.delete(sessionId);
    }
    return this.compactClosedReplies.delete(sessionKey(sessionId, messageId));
  }

  // --- thinking ---

  setThinkingSections(sessionId: string, messageId: string, sections: ThinkingSection[]): void {
    this.thinkingSections.set(sessionKey(sessionId, messageId), sections);
  }

  getThinkingSections(sessionId: string, messageId: string): ThinkingSection[] | undefined {
    return this.thinkingSections.get(sessionKey(sessionId, messageId));
  }

  deleteThinkingSections(sessionId: string, messageId: string): void {
    this.thinkingSections.delete(sessionKey(sessionId, messageId));
  }

  clearThinking(sessionId: string, messageId: string, reason: string): void {
    this.thinkingStreamer.clearMessage(sessionId, getThinkingStreamId(messageId), reason);
    this.thinkingSections.delete(sessionKey(sessionId, messageId));
  }

  // --- completion ordering ---

  enqueueCompletionTask(sessionId: string, task: () => Promise<void>): Promise<void> {
    const previousTask = this.completionTasks.get(sessionId) ?? Promise.resolve();
    const nextTask = previousTask
      .catch(() => undefined)
      .then(task)
      .finally(() => {
        if (this.completionTasks.get(sessionId) === nextTask) {
          this.completionTasks.delete(sessionId);
        }
      });

    this.completionTasks.set(sessionId, nextTask);
    return nextTask;
  }

  getCompletionTask(sessionId: string): Promise<void> | undefined {
    return this.completionTasks.get(sessionId);
  }

  // --- tool tracking ---

  getRunningToolInfo(sessionId: string, callId: string): ToolInfo | undefined {
    return this.runningToolInfos.get(sessionKey(sessionId, callId));
  }

  getRunningToolInfos(sessionId: string): ToolInfo[] {
    return Array.from(this.runningToolInfos.values()).filter(
      (info) => info.sessionId === sessionId,
    );
  }

  setRunningToolInfo(toolInfo: ToolInfo): void {
    this.runningToolInfos.set(sessionKey(toolInfo.sessionId, toolInfo.callId), toolInfo);
  }

  deleteRunningToolInfo(sessionId: string, callId: string): void {
    this.runningToolInfos.delete(sessionKey(sessionId, callId));
  }

  setCompletedToolDuration(sessionId: string, callId: string, durationMs: number): void {
    this.completedToolDurations.set(sessionKey(sessionId, callId), durationMs);
  }

  takeCompletedToolDuration(sessionId: string, callId: string): number | undefined {
    const key = sessionKey(sessionId, callId);
    const durationMs = this.completedToolDurations.get(key);
    this.completedToolDurations.delete(key);
    return durationMs;
  }

  getCompactActivity(sessionId: string): CompactActivity | undefined {
    return this.compactActivityBySession.get(sessionId);
  }

  setCompactActivity(sessionId: string, activity: CompactActivity): void {
    this.compactActivityBySession.set(sessionId, activity);
  }

  getSubagentSnapshot(sessionId: string): SubagentInfo[] | undefined {
    return this.subagentSnapshots.get(sessionId);
  }

  setSubagentSnapshot(sessionId: string, subagents: SubagentInfo[]): void {
    this.subagentSnapshots.set(sessionId, subagents);
  }

  /**
   * Stops tool timers and drops tool bookkeeping for one session. A turn boundary of the
   * foreground session passes `keepBackground`: background operations outlive the turn.
   */
  clearToolTracking(sessionId: string, reason: string, keepBackground = false): void {
    const keptCallIds = new Set(
      keepBackground ? this.runningToolTracker.backgroundCallIds(sessionId) : [],
    );
    this.runningToolTracker.clearSession(sessionId, reason, keepBackground);
    this.compactActivityBySession.delete(sessionId);
    const keptSubagents = keepBackground
      ? (this.subagentSnapshots.get(sessionId) ?? []).filter(isRunningBackgroundSubagent)
      : [];
    this.setKeptSubagents(sessionId, keptSubagents);
    for (const key of Array.from(this.runningToolInfos.keys())) {
      const callId = key.slice(sessionId.length + 1);
      if (key.startsWith(`${sessionId}:`) && !keptCallIds.has(callId)) {
        this.runningToolInfos.delete(key);
      }
    }
    deleteSessionKeys(this.completedToolDurations, sessionId);
  }

  /**
   * Stops following background operations of one session, or of all: their lines and
   * cards stay as they are and a later completion no longer changes them.
   */
  stopBackgroundOperations(reason: string, sessionId?: string): void {
    this.stopBackgroundCommands(reason, sessionId);
    this.stopBackgroundSubagents(sessionId);
  }

  /** The command half of `stopBackgroundOperations`: subagent cards keep being followed. */
  stopBackgroundCommands(reason: string, sessionId?: string): void {
    const callIds = this.runningToolTracker.backgroundCallIds(sessionId);
    for (const callId of callIds) {
      this.runningToolTracker.release(callId);
    }
    for (const [key, info] of Array.from(this.runningToolInfos)) {
      if (callIds.includes(info.callId)) {
        this.runningToolInfos.delete(key);
      }
    }

    this.toolCallStreamer.freezePinnedEntries(sessionId, false);
    this.compactProgressStreamer.dropBackgroundOperations(sessionId);

    if (callIds.length > 0) {
      logger.debug(
        `[Bot] Stopped background operations: session=${sessionId ?? "all"}, count=${callIds.length}, reason=${reason}`,
      );
    }
  }

  /** Background command calls of a session still followed; subagents count by their cards. */
  countBackgroundCommands(sessionId: string): number {
    return this.runningToolTracker
      .backgroundCallIds(sessionId)
      .filter((callId) => this.getRunningToolInfo(sessionId, callId)?.tool !== "task").length;
  }

  /** The subagent-card half of `stopBackgroundOperations`. */
  private stopBackgroundSubagents(sessionId?: string): void {
    this.toolCallStreamer.freezePinnedEntries(sessionId, true);
    for (const [snapshotSessionId, subagents] of Array.from(this.subagentSnapshots)) {
      if (sessionId === undefined || snapshotSessionId === sessionId) {
        this.setKeptSubagents(
          snapshotSessionId,
          subagents.filter((subagent) => !outlivesParentTurn(subagent)),
        );
      }
    }
  }

  private setKeptSubagents(sessionId: string, subagents: SubagentInfo[]): void {
    if (subagents.length === 0) {
      this.subagentSnapshots.delete(sessionId);
      this.runningToolTracker.setHeartbeatActive(sessionId, false);
      return;
    }

    this.subagentSnapshots.set(sessionId, subagents);
    this.runningToolTracker.setHeartbeatActive(
      sessionId,
      subagents.some((subagent) => subagent.status === "pending" || subagent.status === "running"),
    );
  }

  // --- clearing ---

  /** Drops everything one session holds; other sessions keep running. */
  clearSession(sessionId: string, reason: string): void {
    this.clearAssistantResponseSession(sessionId, reason);
    this.thinkingStreamer.clearSession(sessionId, reason);
    deleteSessionKeys(this.thinkingSections, sessionId);
    this.toolCallStreamer.clearSession(sessionId, reason);
    this.toolMessageBatcher.clearSession(sessionId, reason);
    this.compactProgressStreamer.clearSession(sessionId, reason);
    this.completionTasks.delete(sessionId);
    this.clearToolTracking(sessionId, reason);
  }

  /** Drops all output of all sessions; queued completion work is kept. */
  clearAllOutput(reason: string): void {
    this.toolMessageBatcher.clearAll(reason);
    this.toolCallStreamer.clearAll(reason);
    this.assistantStreamModes.clear();
    this.assistantLatestTexts.clear();
    this.assistantDeliveredTexts.clear();
    this.begunReplies.clear();
    this.replyCuts.clear();
    this.replyEnqueueDeferrals.clear();
    this.compactCloseDue.clear();
    this.compactClosedReplies.clear();
    this.assistantEditStreamer.clearAll(reason);
    this.assistantDraftStreamer.clearAll(reason);
    this.thinkingStreamer.clearAll(reason);
    this.compactProgressStreamer.clearAll(reason);
    this.thinkingSections.clear();
    this.runningToolTracker.clearAll(reason);
    this.runningToolInfos.clear();
    this.completedToolDurations.clear();
    this.compactActivityBySession.clear();
    this.subagentSnapshots.clear();
  }

  /** Full reset: all output, queued completion work and draft numbering. */
  reset(reason: string): void {
    this.delivery.resetDraftIds();
    this.clearAllOutput(reason);
    this.completionTasks.clear();
  }

  private deleteAssistantResponseRecords(sessionId: string, messageId: string): void {
    const key = sessionKey(sessionId, messageId);
    this.assistantStreamModes.delete(key);
    this.assistantLatestTexts.delete(key);
    this.assistantDeliveredTexts.delete(key);
    this.begunReplies.delete(key);
  }

  private getAssistantStreamer(mode: ResponseStreamingMode): ResponseStreamer {
    return mode === "draft" ? this.assistantDraftStreamer : this.assistantEditStreamer;
  }

  private getForegroundDestination(sessionId: string): TelegramDestination | null {
    const destination = this.policy.getDestination(sessionId);
    if (!destination || !this.policy.isForegroundSession(sessionId)) {
      return null;
    }

    return destination;
  }

  private requireDestination(sessionId: string, operation: string): TelegramDestination {
    const destination = this.policy.getDestination(sessionId);
    if (!destination || destination.chatId <= 0) {
      throw new Error(`Bot context missing for ${operation}`);
    }

    return destination;
  }

  private requireForegroundDestination(
    sessionId: string,
    stream: string,
    action: string,
  ): TelegramDestination {
    const destination = this.requireDestination(sessionId, `${stream.toLowerCase()} ${action}`);
    if (!this.policy.isForegroundSession(sessionId)) {
      throw new Error(`${stream} session mismatch for ${action}: ${sessionId}`);
    }

    return destination;
  }

  private createEditResponseStreamer(): ResponseStreamer {
    return new ResponseStreamer({
      throttleMs: getSessionStreamThrottleMs,
      sendPart: (part, options, sessionId) =>
        this.delivery.sendRenderedPart(
          this.requireDestination(sessionId, "streamed send"),
          part,
          options,
          false,
        ),
      editPart: (messageId, part, options, sessionId) =>
        this.delivery.editRenderedPart(
          this.requireDestination(sessionId, "streamed edit"),
          messageId,
          part,
          options,
        ),
      deleteText: (messageId, sessionId) =>
        this.delivery.deleteText(this.requireDestination(sessionId, "streamed delete"), messageId),
    });
  }

  private createDraftResponseStreamer(): ResponseStreamer {
    return new ResponseStreamer({
      throttleMs: getSessionStreamThrottleMs,
      sendPart: (part, _options, sessionId) =>
        this.delivery.sendDraftPart(this.requireDestination(sessionId, "draft send"), part),
      editPart: (messageId, part, _options, sessionId) =>
        this.delivery.editDraftPart(
          this.requireDestination(sessionId, "draft edit"),
          messageId,
          part,
        ),
      deleteText: async () => {},
      completePart: (part, options, sessionId) =>
        this.delivery.completeDraftPart(
          this.requireDestination(sessionId, "draft complete"),
          part,
          options,
        ),
    });
  }
}

export function getThinkingStreamId(messageId: string): string {
  return `thinking:${messageId}`;
}
