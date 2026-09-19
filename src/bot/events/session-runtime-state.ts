import type { SubagentInfo, ToolInfo } from "../../app/managers/summary-aggregation-manager.js";
import { TOOL_ELAPSED_THRESHOLD_MS } from "../../app/formatters/duration-formatter.js";
import { ToolMessageBatcher } from "../../app/formatters/tool-message-batcher.js";
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

export interface CompactActivity {
  callId: string;
  activity: string;
}

interface RunningToolHooks {
  onTick: (tick: RunningToolTick) => void;
  onHeartbeat: (sessionId: string) => void;
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
    });

    this.toolCallStreamer = new ToolCallStreamer({
      throttleMs: getSessionStreamThrottleMs,
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
    this.assistantStreamModes.delete(sessionKey(sessionId, messageId));
    return result;
  }

  clearAssistantResponse(sessionId: string, messageId: string, reason: string): void {
    this.assistantStreamModes.delete(sessionKey(sessionId, messageId));
    this.assistantEditStreamer.clearMessage(sessionId, messageId, reason);
    this.assistantDraftStreamer.clearMessage(sessionId, messageId, reason);
  }

  clearAssistantResponseSession(sessionId: string, reason: string): void {
    deleteSessionKeys(this.assistantStreamModes, sessionId);
    this.assistantEditStreamer.clearSession(sessionId, reason);
    this.assistantDraftStreamer.clearSession(sessionId, reason);
  }

  hasActiveAssistantResponse(sessionId: string): boolean {
    return (
      this.assistantEditStreamer.hasActiveStream(sessionId) ||
      this.assistantDraftStreamer.hasActiveStream(sessionId)
    );
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

  /** Stops tool timers and drops tool bookkeeping for one session. */
  clearToolTracking(sessionId: string, reason: string): void {
    this.runningToolTracker.clearSession(sessionId, reason);
    this.runningToolTracker.setHeartbeatActive(sessionId, false);
    this.compactActivityBySession.delete(sessionId);
    this.subagentSnapshots.delete(sessionId);
    deleteSessionKeys(this.runningToolInfos, sessionId);
    deleteSessionKeys(this.completedToolDurations, sessionId);
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
