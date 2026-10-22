import { Event, ToolState } from "@opencode-ai/sdk/v2";
import type { Bot } from "grammy";
import type { CodeFileData } from "../formatters/summary-formatter.js";
import {
  formatPatchFileLine,
  getPatchFileChanges,
  normalizePathForDisplay,
  prepareCodeFile,
} from "../formatters/summary-formatter.js";
import type { Question, QuestionSettledOutcome } from "../types/question.js";
import type { PermissionReply, PermissionRequest } from "../types/permission.js";
import type { FileChange } from "../types/summary.js";
import { logger } from "../../utils/logger.js";
import { extractErrorMessage } from "../../utils/opencode-error.js";
import { isRecord } from "../../utils/type-guards.js";
import { getCurrentProject } from "../stores/settings-store.js";

export interface SummaryInfo {
  sessionId: string;
  text: string;
  messageCount: number;
  lastUpdated: number;
}

export interface MessageCompletionInfo {
  agent?: string | undefined;
  providerID?: string | undefined;
  modelID?: string | undefined;
  createdAt?: number | undefined;
  completedAt?: number | undefined;
}

type MessageCompleteCallback = (
  sessionId: string,
  messageId: string,
  messageText: string,
  completionInfo: MessageCompletionInfo,
) => void;

type MessagePartialCallback = (sessionId: string, messageId: string, messageText: string) => void;

export interface ThinkingSection {
  id: string;
  title?: string | undefined;
  text: string;
}

export interface ThinkingUpdate {
  sessionId: string;
  messageId: string;
  sections: ThinkingSection[];
  isFirstUpdate: boolean;
}

type ExternalUserInputCallback = (
  sessionId: string,
  messageId: string,
  messageText: string,
) => void | Promise<void>;

interface MessagePartDeltaEventRaw {
  type: "message.part.delta";
  properties: {
    part?: {
      id?: string;
      sessionID?: string;
      messageID?: string;
      type?: string;
      text?: string;
      synthetic?: boolean;
    };
    sessionID?: string;
    messageID?: string;
    partID?: string;
    type?: string;
    delta?: string;
  };
}

function isMessagePartDeltaEvent(event: Event): event is Event & MessagePartDeltaEventRaw {
  return event.type === "message.part.delta" && isRecord(event.properties);
}

export interface ToolInfo {
  sessionId: string;
  messageId: string;
  callId: string;
  tool: string;
  state: ToolState;
  input?: { [key: string]: unknown } | undefined;
  title?: string | undefined;
  metadata?: { [key: string]: unknown } | undefined;
  hasFileAttachment?: boolean | undefined;
}

/** A file a finished call changed; one without a document stays a text line. */
export interface ToolFileEntry {
  fileData: CodeFileData | null;
  /** The file's own line, for a call that lists each file it changed. */
  line?: string;
}

export interface ToolFileInfo extends ToolInfo {
  hasFileAttachment: true;
  files: ToolFileEntry[];
}

type ToolCallback = (toolInfo: ToolInfo) => void;

type RootToolUpdateCallback = (toolInfo: ToolInfo) => void;

type ToolFileCallback = (fileInfo: ToolFileInfo) => void;

type QuestionCallback = (questions: Question[], requestID: string, sessionId: string) => void;

type QuestionErrorCallback = (sessionId: string) => void;

type QuestionSettledCallback = (
  sessionId: string,
  requestID: string,
  outcome: QuestionSettledOutcome,
) => void | Promise<void>;

type ThinkingCallback = (update: ThinkingUpdate) => void;

type ThinkingFinishedCallback = (sessionId: string, messageId: string) => void;

export interface TokensInfo {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
}

type TokensCallback = (sessionId: string, tokens: TokensInfo, isCompleted: boolean) => void;

type CostCallback = (sessionId: string, cost: number) => void;

export type SubagentStatus = "pending" | "running" | "completed" | "error" | "interrupted";

export interface SubagentInfo {
  cardId: string;
  sessionId: string | null;
  parentSessionId: string;
  agent: string;
  description: string;
  prompt: string;
  command?: string | undefined;
  status: SubagentStatus;
  providerID?: string | undefined;
  modelID?: string | undefined;
  variant?: string | undefined;
  tokens: TokensInfo;
  cost: number;
  currentTool?: string | undefined;
  currentToolInput?: { [key: string]: unknown } | undefined;
  currentToolTitle?: string | undefined;
  currentToolCallId?: string | undefined;
  currentToolStartedAt?: number | undefined;
  terminalMessage?: string | undefined;
  /** Launched in the background: the card outlives its parent's turn. */
  background?: boolean | undefined;
  /** When the newest of the nested subagents it launched, still running, started. */
  launchStartedAt?: number | undefined;
  /** The task of that newest launch, from its call's description. */
  launchDescription?: string | undefined;
  /** A nested subagent it launched in the background still runs: the card outlives its parent's turn. */
  waitsOnBackgroundLaunch?: boolean | undefined;
  createdAt: number;
  finishedAt?: number | undefined;
  updatedAt: number;
}

type SubagentCallback = (sessionId: string, subagents: SubagentInfo[]) => void | Promise<void>;

/** The card keeps updating after its parent's turn ends. */
export function outlivesParentTurn(subagent: SubagentInfo): boolean {
  return Boolean(subagent.background || subagent.waitsOnBackgroundLaunch);
}

type SessionCompactedCallback = (sessionId: string, directory: string) => void;

export interface SessionErrorInfo {
  /** The run was stopped (OpenCode V1 reports a stop as an abort error), not failed. */
  interrupted: boolean;
}

type SessionErrorCallback = (sessionId: string, message: string, errorInfo: SessionErrorInfo) => void;

export interface SessionRetryInfo {
  sessionId: string;
  attempt?: number;
  message: string;
  next?: number;
}

type SessionRetryCallback = (retryInfo: SessionRetryInfo) => void;

export interface SessionIdleInfo {
  /** OpenCode V2 stopped the execution instead of finishing it. */
  interrupted: boolean;
}

type SessionIdleCallback = (sessionId: string, idleInfo: SessionIdleInfo) => void | Promise<void>;

type PermissionCallback = (request: PermissionRequest) => void | Promise<void>;

type PermissionRepliedCallback = (
  sessionId: string,
  requestID: string,
  reply: PermissionReply | null,
) => void | Promise<void>;

/** The run of the followed session or of one of its subagents ended (idle or error). */
type SessionRunEndedCallback = (sessionId: string) => void | Promise<void>;

type SessionDiffCallback = (sessionId: string, diffs: FileChange[]) => void;

type FileChangeCallback = (sessionId: string, change: FileChange) => void;

type ClearedCallback = () => void;

interface PreparedToolFile extends ToolFileEntry {
  fileChange: FileChange | null;
}

interface TextMessageState {
  orderedPartIds: string[];
  partTexts: Map<string, string>;
  optimisticUpdateCount: number;
}

interface ThinkingMessageState {
  orderedPartIds: string[];
  sections: Map<string, ThinkingSection>;
}

/** A nested subagent the card's own subagent launched, from the launch call's first event to its end. */
interface SubagentLaunch {
  startedAt: number;
  background: boolean;
  /** The call carries its arguments, so the launch may be shown. */
  shown: boolean;
  /** The latest description its call reported. */
  description?: string | undefined;
}

type SubagentEndStatus = Extract<SubagentStatus, "completed" | "error" | "interrupted">;

interface SubagentState extends SubagentInfo {
  hasSubtaskMetadata: boolean;
  hasTaskToolMetadata: boolean;
  hasSessionTitleMetadata: boolean;
  launches: Map<string, SubagentLaunch>;
  /** Its own run ended while a background launch still runs; applied when that launch ends. */
  heldEnd?: { status: SubagentEndStatus; terminalMessage?: string | undefined; finishedAt: number };
}

// When a model returns a response without a text block, the upstream provider
// serializes the raw response object into a text part instead of leaving it
// empty. Such a part is internal noise and must never reach the user. The
// trailing quote is part of the marker: the dump is a Python repr, so the first
// key is always single-quoted, which prose does not do.
const UPSTREAM_EMPTY_RESPONSE_MARKER = "Empty response: {'";

// A key that only the serialized response object carries. The model can be
// asked to start a legitimate answer with the marker, so the marker alone is
// not enough to discard text for good.
const UPSTREAM_EMPTY_RESPONSE_KEY = "'stop_reason'";

// Suppression happens in two tiers, because the decision has to be made twice
// under different amounts of information.
//
// While the part is still streaming, the text arrives character by character
// and there is no way to tell the placeholder from an answer that merely opens
// the same way - so anything that still looks like the marker is held back.
// The text is only hidden, never lost, but the cost is not zero: such an answer
// shows no live preview and appears at once when the message completes.
//
// Once the message is complete the full text is known, and discarding it is
// final. At that point the marker alone is not enough: the serialized response
// object must also be there, otherwise the text is a legitimate answer and is
// released.
function isUpstreamEmptyResponseText(text: string, isFinal: boolean): boolean {
  const trimmed = text.trimStart();
  if (!trimmed) {
    return false;
  }

  if (trimmed.length < UPSTREAM_EMPTY_RESPONSE_MARKER.length) {
    return !isFinal && UPSTREAM_EMPTY_RESPONSE_MARKER.startsWith(trimmed);
  }

  if (!trimmed.startsWith(UPSTREAM_EMPTY_RESPONSE_MARKER)) {
    return false;
  }

  return isFinal ? trimmed.includes(UPSTREAM_EMPTY_RESPONSE_KEY) : true;
}

/** The V2 adapter marks the idle of an execution that was interrupted rather than finished. */
function isInterruptedIdle(properties: object): boolean {
  return "interrupted" in properties && properties.interrupted === true;
}

/** A `task` call launched in the background, flagged on its input or on its metadata. */
function isBackgroundTaskCall(state: ToolState): boolean {
  return (
    state.input?.background === true || ("metadata" in state && state.metadata?.background === true)
  );
}

/** OpenCode V1 reports a stopped run, or a stopped subagent, as this error. */
function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === "MessageAbortedError";
}

function extractFirstUpdatedFileFromTitle(title: string): string {
  for (const rawLine of title.split("\n")) {
    const line = rawLine.trim();
    const status = line[0];
    if (line.length >= 3 && line[1] === " " && status !== undefined && /[AMDURC]/.test(status)) {
      return line.slice(2).trim();
    }
  }
  return "";
}

function countDiffChangesFromText(text: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;

  for (const line of text.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      additions++;
      continue;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      deletions++;
    }
  }

  return { additions, deletions };
}

function normalizeSnapshotValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeSnapshotValue(item));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, normalizeSnapshotValue(entryValue)]),
    );
  }

  return value;
}

interface DeferredOutboundTask {
  key?: string;
  task: () => void | Promise<void>;
}

export class SummaryAggregator {
  private currentSessionId: string | null = null;
  private textMessageStates: Map<string, TextMessageState> = new Map();
  private thinkingMessageStates: Map<string, ThinkingMessageState> = new Map();
  private messages: Map<string, { role: string }> = new Map();
  private messageCount = 0;
  private onCompleteCallback: MessageCompleteCallback | null = null;
  private onPartialCallback: MessagePartialCallback | null = null;
  private onExternalUserInputCallback: ExternalUserInputCallback | null = null;
  private onToolCallback: ToolCallback | null = null;
  private onRootToolUpdateCallback: RootToolUpdateCallback | null = null;
  private onToolFileCallback: ToolFileCallback | null = null;
  private onQuestionCallback: QuestionCallback | null = null;
  private onQuestionErrorCallback: QuestionErrorCallback | null = null;
  private onQuestionSettledCallback: QuestionSettledCallback | null = null;
  private onThinkingCallback: ThinkingCallback | null = null;
  private onThinkingFinishedCallback: ThinkingFinishedCallback | null = null;
  private onTokensCallback: TokensCallback | null = null;
  private onCostCallback: CostCallback | null = null;
  private onSubagentCallback: SubagentCallback | null = null;
  private onSessionCompactedCallback: SessionCompactedCallback | null = null;
  private onSessionErrorCallback: SessionErrorCallback | null = null;
  private onSessionRetryCallback: SessionRetryCallback | null = null;
  private onSessionIdleCallback: SessionIdleCallback | null = null;
  private onPermissionCallback: PermissionCallback | null = null;
  private permissionQueue: Promise<void> = Promise.resolve();
  private onPermissionRepliedCallback: PermissionRepliedCallback | null = null;
  private onSessionRunEndedCallback: SessionRunEndedCallback | null = null;
  private onSessionDiffCallback: SessionDiffCallback | null = null;
  private onFileChangeCallback: FileChangeCallback | null = null;
  private onClearedCallback: ClearedCallback | null = null;
  // The hold and its queue outlive a session clear: they belong to the outbound-hold
  // lifecycle (session picks and lost-run endings), not to the session state. The array and
  // the coalescing map are only ever changed together.
  private outboundHeld = false;
  private outboundHoldGeneration = 0;
  private outboundIdleWaiters: Array<() => void> = [];
  private deferredOutbound: DeferredOutboundTask[] = [];
  // Coalescable tasks, last-wins: a held stream keeps one partial-text task per message
  // instead of one per delta.
  private deferredOutboundByKey = new Map<string, DeferredOutboundTask>();
  private drainPromise: Promise<void> | null = null;
  private processedToolStates: Set<string> = new Set();
  private thinkingFiredForMessages: Set<string> = new Set();
  private thinkingFinishedForMessages: Set<string> = new Set();
  private deliveredExternalUserMessageIds: Set<string> = new Set();
  private knownTextPartIds: Map<string, Set<string>> = new Map();
  // Parts OpenCode injected itself, tracked by id because `message.part.delta` events may
  // carry only the id and would otherwise stream their content past the synthetic filter.
  private syntheticPartIds: Map<string, Set<string>> = new Map();
  private bot: Bot | null = null;
  private chatId: number | null = null;
  private typingTimer: ReturnType<typeof setInterval> | null = null;
  private typingIndicatorEnabled = true;
  private partHashes: Map<string, Set<string>> = new Map();
  private trackedSessionParents: Map<string, string | null> = new Map();
  private subagentStates: Map<string, SubagentState> = new Map();
  private subagentOrder: string[] = [];
  private subagentCardIdBySessionId: Map<string, string> = new Map();
  // Child session ids whose task part announced a background launch, kept until
  // the card attaches so a task part that arrives before session.created is honored.
  private backgroundChildSessionIds = new Set<string>();
  private pendingSubagentCardIdsByParent: Map<string, string[]> = new Map();
  private pendingChildSessionIdsByParent: Map<string, string[]> = new Map();
  private fallbackSubagentCardIdsByParent: Map<string, string[]> = new Map();
  // Root task calls still open, each with the card it was matched to once that is known.
  private openTaskCalls: Map<string, { parentSessionId: string; cardId: string | null }> =
    new Map();
  private finishedSubagentSessionIds: Set<string> = new Set();
  // Ended sessions still tracked because a nested session hangs off them.
  private endedTrackedSessionIds: Set<string> = new Set();
  private acceptsSubagentEvents = false;
  private subagentRunStartedAt = 0;
  private lastSubagentSnapshot = "";
  // When the current session's running turn began, whoever started it; null between turns.
  private liveTurnStartedAt: number | null = null;
  /** Counts ends of the current session's turns, so a late status answer can tell one passed. */
  private turnEndCount = 0;

  setBotAndChatId(bot: Bot, chatId: number): void {
    this.bot = bot;
    this.chatId = chatId;
  }

  setOnComplete(callback: MessageCompleteCallback): void {
    this.onCompleteCallback = callback;
  }

  setOnPartial(callback: MessagePartialCallback): void {
    this.onPartialCallback = callback;
  }

  setOnExternalUserInput(callback: ExternalUserInputCallback): void {
    this.onExternalUserInputCallback = callback;
  }

  setOnTool(callback: ToolCallback): void {
    this.onToolCallback = callback;
  }

  setOnRootToolUpdate(callback: RootToolUpdateCallback): void {
    this.onRootToolUpdateCallback = callback;
  }

  setOnToolFile(callback: ToolFileCallback): void {
    this.onToolFileCallback = callback;
  }

  setOnQuestion(callback: QuestionCallback): void {
    this.onQuestionCallback = callback;
  }

  setOnQuestionError(callback: QuestionErrorCallback): void {
    this.onQuestionErrorCallback = callback;
  }

  setOnQuestionSettled(callback: QuestionSettledCallback): void {
    this.onQuestionSettledCallback = callback;
  }

  setOnThinking(callback: ThinkingCallback): void {
    this.onThinkingCallback = callback;
  }

  setOnThinkingFinished(callback: ThinkingFinishedCallback): void {
    this.onThinkingFinishedCallback = callback;
  }

  setOnTokens(callback: TokensCallback): void {
    this.onTokensCallback = callback;
  }

  setOnCost(callback: CostCallback): void {
    this.onCostCallback = callback;
  }

  setOnSubagent(callback: SubagentCallback): void {
    this.onSubagentCallback = callback;
  }

  setOnSessionCompacted(callback: SessionCompactedCallback): void {
    this.onSessionCompactedCallback = callback;
  }

  setOnSessionError(callback: SessionErrorCallback): void {
    this.onSessionErrorCallback = callback;
  }

  setOnSessionRetry(callback: SessionRetryCallback): void {
    this.onSessionRetryCallback = callback;
  }

  setOnSessionIdle(callback: SessionIdleCallback): void {
    this.onSessionIdleCallback = callback;
  }

  setOnPermission(callback: PermissionCallback): void {
    this.onPermissionCallback = callback;
  }

  setOnPermissionReplied(callback: PermissionRepliedCallback): void {
    this.onPermissionRepliedCallback = callback;
  }

  setOnSessionRunEnded(callback: SessionRunEndedCallback): void {
    this.onSessionRunEndedCallback = callback;
  }

  setOnSessionDiff(callback: SessionDiffCallback): void {
    this.onSessionDiffCallback = callback;
  }

  setOnFileChange(callback: FileChangeCallback): void {
    this.onFileChangeCallback = callback;
  }

  setOnCleared(callback: ClearedCallback): void {
    this.onClearedCallback = callback;
  }

  /** Start of the session's running turn, or null when it is not the current one or is idle. */
  getLiveTurnStartedAt(sessionId: string): number | null {
    return sessionId === this.currentSessionId ? this.liveTurnStartedAt : null;
  }

  /** Forgets the running turn: after a gap in the event stream its end may have been missed. */
  forgetLiveTurn(): void {
    this.liveTurnStartedAt = null;
  }

  /** A mark to pass to `startMissedLiveTurn`, taken before the session status is read. */
  getTurnEndMark(): number {
    return this.turnEndCount;
  }

  /**
   * Starts the current session's turn from now when a busy status the stream missed says it
   * runs, unless a turn already runs or one ended since the mark was taken.
   */
  startMissedLiveTurn(sessionId: string, mark: number): void {
    if (sessionId !== this.currentSessionId || mark !== this.turnEndCount) {
      return;
    }

    this.liveTurnStartedAt ??= Date.now();
  }

  holdOutbound(): number {
    this.outboundHeld = true;
    this.outboundHoldGeneration += 1;
    return this.outboundHoldGeneration;
  }

  hasDeferredOutbound(): boolean {
    return this.deferredOutbound.length > 0;
  }

  /**
   * Replays the held outbound queue for a hold generation. Only one drain runs at a time:
   * a concurrent caller awaits the running drain and then re-checks its own generation.
   * A drain stops when a newer hold starts, leaving the queue to that hold's own release.
   */
  async drainOutbound(gapMs: number, generation: number): Promise<void> {
    if (!this.outboundHeld || generation !== this.outboundHoldGeneration) {
      return;
    }

    if (this.drainPromise) {
      await this.drainPromise;
      await this.drainOutbound(gapMs, generation);
      return;
    }

    const drain = this.runDrain(generation, gapMs).finally(() => {
      if (this.drainPromise === drain) {
        this.drainPromise = null;
      }
    });
    this.drainPromise = drain;
    await drain;
  }

  /**
   * Resolves once the held queue is empty, whoever drains it: a superseded caller can wait
   * for its output without taking over a newer hold.
   */
  whenOutboundIdle(): Promise<void> {
    if (!this.outboundHeld) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.outboundIdleWaiters.push(resolve);
    });
  }

  private markOutboundIdle(): void {
    this.outboundHeld = false;
    const waiters = this.outboundIdleWaiters;
    this.outboundIdleWaiters = [];
    for (const resolve of waiters) {
      resolve();
    }
  }

  private async runDrain(generation: number, gapMs: number): Promise<void> {
    let first = true;
    for (;;) {
      if (this.outboundHoldGeneration !== generation) {
        return;
      }

      const next = this.deferredOutbound[0];
      if (!next) {
        this.markOutboundIdle();
        return;
      }

      if (!first) {
        await new Promise((resolve) => setTimeout(resolve, gapMs));
      }

      // A newer hold can start during the gap: leave the queue to it.
      if (this.outboundHoldGeneration !== generation) {
        return;
      }

      const entry = this.deferredOutbound.shift();
      if (!entry) {
        this.markOutboundIdle();
        return;
      }

      if (entry.key) {
        this.deferredOutboundByKey.delete(entry.key);
      }
      first = false;

      try {
        await entry.task();
      } catch (err) {
        logger.error("[Aggregator] Error in deferred outbound callback:", err);
      }
    }
  }

  /**
   * Runs a task through the outbound queue: now, or after the hold is drained while it is on.
   */
  runOutbound(task: () => void | Promise<void>): Promise<void> {
    if (this.outboundHeld) {
      this.deferOutbound(task);
      return Promise.resolve();
    }

    return Promise.resolve(task());
  }

  private scheduleOutbound(
    task: () => void | Promise<void>,
    immediate: boolean,
    coalesceKey?: string,
  ): void {
    if (this.outboundHeld) {
      this.deferOutbound(task, coalesceKey);
      return;
    }

    this.deliverOutbound(task, immediate);
  }

  /**
   * Defers a task for the hold. A coalescable key keeps only the latest task in the slot
   * the key first took, so a long stream cannot grow the queue by its delta count.
   */
  private deferOutbound(task: () => void | Promise<void>, coalesceKey?: string): void {
    if (coalesceKey) {
      const existing = this.deferredOutboundByKey.get(coalesceKey);
      if (existing) {
        existing.task = task;
        return;
      }
    }

    const entry: DeferredOutboundTask = coalesceKey ? { key: coalesceKey, task } : { task };
    if (coalesceKey) {
      this.deferredOutboundByKey.set(coalesceKey, entry);
    }
    this.deferredOutbound.push(entry);
  }

  /**
   * Delivers past the hold: the dashboard's values (tokens, cost, files) are never held, only
   * the redraws and messages that show them.
   */
  private deliverOutbound(task: () => void | Promise<void>, immediate: boolean): void {
    if (immediate) {
      setImmediate(() => {
        void Promise.resolve(task()).catch((err) => {
          logger.error("[Aggregator] Error in outbound callback:", err);
        });
      });
      return;
    }

    void task();
  }

  setTypingIndicatorEnabled(enabled: boolean): void {
    this.typingIndicatorEnabled = enabled;

    if (!enabled) {
      this.stopTypingIndicator();
    }
  }

  private startTypingIndicator(): void {
    if (!this.typingIndicatorEnabled) {
      return;
    }

    if (this.typingTimer) {
      return;
    }

    const sendTyping = () => {
      if (this.bot && this.chatId) {
        this.bot.api.sendChatAction(this.chatId, "typing").catch((err) => {
          logger.error("Failed to send typing action:", err);
        });
      }
    };

    sendTyping();
    this.typingTimer = setInterval(sendTyping, 4000);
  }

  stopTypingIndicator(): void {
    if (this.typingTimer) {
      clearInterval(this.typingTimer);
      this.typingTimer = null;
    }
  }

  processEvent(event: Event): void {
    const eventType: string = event.type;

    if (eventType === "server.heartbeat") {
      logger.debug("[Aggregator] Heartbeat received");
      return;
    }

    // Log all question-related events for debugging
    if (event.type.startsWith("question.")) {
      logger.info(
        `[Aggregator] Question event: ${event.type}`,
        JSON.stringify(event.properties, null, 2),
      );
    }

    // Log all session-related events for debugging
    if (event.type.startsWith("session.")) {
      logger.debug(
        `[Aggregator] Session event: ${event.type}`,
        JSON.stringify(event.properties, null, 2),
      );
    }

    switch (event.type) {
      case "message.part.delta":
        if (!isMessagePartDeltaEvent(event)) {
          logger.warn(`[Aggregator] message.part.delta with unexpected shape, ignoring`);
          break;
        }
        this.handleMessagePartDelta(event);
        break;
      case "session.created":
      case "session.updated":
        this.handleSessionCreatedOrUpdated(event);
        break;
      case "message.updated":
        this.handleMessageUpdated(event);
        break;
      case "message.part.updated":
        this.handleMessagePartUpdated(event);
        break;
      case "session.status":
        this.handleSessionStatus(event);
        break;
      case "session.idle":
        this.handleSessionIdle(event);
        break;
      case "session.compacted":
        this.handleSessionCompacted(event);
        break;
      case "session.error":
        this.handleSessionError(event);
        break;
      case "question.asked":
        this.handleQuestionAsked(event);
        break;
      case "question.replied":
        this.handleQuestionSettled(event.properties, "answered");
        break;
      case "question.rejected":
        this.handleQuestionSettled(event.properties, "cancelled");
        break;
      case "session.diff":
        this.handleSessionDiff(event);
        break;
      case "permission.asked":
        this.handlePermissionAsked(event);
        break;
      case "permission.replied":
        this.handlePermissionReplied(event);
        break;
      default:
        logger.debug(`[Aggregator] Unhandled event type: ${event.type}`);
        break;
    }
  }

  setSession(sessionId: string): void {
    if (this.currentSessionId !== sessionId) {
      this.clear();
      this.currentSessionId = sessionId;
      this.trackedSessionParents.set(sessionId, null);
      this.acceptsSubagentEvents = true;
    }
  }

  clear(): void {
    this.stopTypingIndicator();
    this.currentSessionId = null;
    this.textMessageStates.clear();
    this.thinkingMessageStates.clear();
    this.messages.clear();
    this.partHashes.clear();
    this.knownTextPartIds.clear();
    this.syntheticPartIds.clear();
    this.processedToolStates.clear();
    this.thinkingFiredForMessages.clear();
    this.thinkingFinishedForMessages.clear();
    this.deliveredExternalUserMessageIds.clear();
    this.trackedSessionParents.clear();
    this.subagentStates.clear();
    this.subagentOrder = [];
    this.subagentCardIdBySessionId.clear();
    this.backgroundChildSessionIds.clear();
    this.pendingSubagentCardIdsByParent.clear();
    this.pendingChildSessionIdsByParent.clear();
    this.fallbackSubagentCardIdsByParent.clear();
    this.openTaskCalls.clear();
    this.finishedSubagentSessionIds.clear();
    this.endedTrackedSessionIds.clear();
    this.acceptsSubagentEvents = false;
    this.subagentRunStartedAt = 0;
    this.lastSubagentSnapshot = "";
    this.liveTurnStartedAt = null;
    this.turnEndCount++;
    this.permissionQueue = Promise.resolve();
    this.messageCount = 0;

    if (this.onClearedCallback) {
      try {
        this.scheduleOutbound(() => {
          this.onClearedCallback?.();
        }, false);
      } catch (err) {
        logger.error("[Aggregator] Error in clear callback:", err);
      }
    }
  }

  private isTrackedChildSession(sessionId: string): boolean {
    return this.trackedSessionParents.has(sessionId) && sessionId !== this.currentSessionId;
  }

  /** A subagent launched by another subagent: followed for its prompts, never given a card. */
  private isNestedSubagentSession(sessionId: string): boolean {
    const parentSessionId = this.trackedSessionParents.get(sessionId);
    return Boolean(parentSessionId) && parentSessionId !== this.currentSessionId;
  }

  private hasTrackedChildren(sessionId: string): boolean {
    for (const parentSessionId of this.trackedSessionParents.values()) {
      if (parentSessionId === sessionId) {
        return true;
      }
    }
    return false;
  }

  /**
   * Stops tracking an ended session. One a nested session still hangs off stays tracked, so
   * that session's prompts still find the root, and goes with the last of them.
   */
  private untrackEndedSession(sessionId: string): void {
    this.endedTrackedSessionIds.add(sessionId);
    let current: string | null | undefined = sessionId;
    while (current && this.endedTrackedSessionIds.has(current) && !this.hasTrackedChildren(current)) {
      const parentSessionId = this.trackedSessionParents.get(current);
      this.trackedSessionParents.delete(current);
      this.endedTrackedSessionIds.delete(current);
      current = parentSessionId;
    }
  }

  /**
   * Public check: is this session a tracked subagent (child) of the current root session?
   */
  isSubagentSession(sessionId: string): boolean {
    return this.isTrackedChildSession(sessionId);
  }

  registerRestoredPermissionChild(child: string, parent: string): void {
    if (this.trackedSessionParents.has(parent) && child !== this.currentSessionId) {
      this.trackedSessionParents.set(child, parent);
    }
  }

  /**
   * The root session a tracked session belongs to, found by walking its parents;
   * an untracked session is its own root.
   */
  getRootSessionId(sessionId: string): string {
    const visited = new Set<string>();
    let rootSessionId = sessionId;
    let parentSessionId = this.trackedSessionParents.get(rootSessionId);
    while (parentSessionId && !visited.has(parentSessionId)) {
      visited.add(rootSessionId);
      rootSessionId = parentSessionId;
      parentSessionId = this.trackedSessionParents.get(rootSessionId);
    }

    return rootSessionId;
  }

  private getQueue(map: Map<string, string[]>, parentSessionId: string): string[] {
    const existing = map.get(parentSessionId);
    if (existing) {
      return existing;
    }

    const queue: string[] = [];
    map.set(parentSessionId, queue);
    return queue;
  }

  private dequeue(map: Map<string, string[]>, parentSessionId: string): string | undefined {
    const queue = map.get(parentSessionId);
    if (!queue || queue.length === 0) {
      return undefined;
    }

    const value = queue.shift();
    if (queue.length === 0) {
      map.delete(parentSessionId);
    }

    return value;
  }

  private removeFromQueue(
    map: Map<string, string[]>,
    parentSessionId: string,
    value: string,
  ): void {
    const queue = map.get(parentSessionId);
    if (!queue) {
      return;
    }

    const index = queue.indexOf(value);
    if (index >= 0) {
      queue.splice(index, 1);
    }

    if (queue.length === 0) {
      map.delete(parentSessionId);
    }
  }

  /**
   * Drops a card. A resumable one leaves its child known, so a later event of that child
   * opens a new card instead of being ignored.
   */
  private retireSubagent(cardId: string, resumable = false): void {
    const state = this.subagentStates.get(cardId);
    if (!state) {
      return;
    }

    this.subagentStates.delete(cardId);
    this.subagentOrder = this.subagentOrder.filter((currentCardId) => currentCardId !== cardId);
    this.removeFromQueue(this.pendingSubagentCardIdsByParent, state.parentSessionId, cardId);
    this.removeFromQueue(this.fallbackSubagentCardIdsByParent, state.parentSessionId, cardId);

    if (state.sessionId) {
      this.subagentCardIdBySessionId.delete(state.sessionId);
    }

    if (state.sessionId && !resumable) {
      this.backgroundChildSessionIds.delete(state.sessionId);
      this.untrackEndedSession(state.sessionId);
      this.removeFromQueue(
        this.pendingChildSessionIdsByParent,
        state.parentSessionId,
        state.sessionId,
      );
      this.finishedSubagentSessionIds.add(state.sessionId);
    }

    this.lastSubagentSnapshot = "";
  }

  private hasBackgroundLaunch(state: SubagentState): boolean {
    return [...state.launches.values()].some((launch) => launch.background);
  }

  private getNewestLaunch(state: SubagentState): SubagentLaunch | undefined {
    let newest: SubagentLaunch | undefined;
    for (const launch of state.launches.values()) {
      if (launch.shown && (newest === undefined || launch.startedAt >= newest.startedAt)) {
        newest = launch;
      }
    }
    return newest;
  }

  /**
   * A card whose end is still to come past its parent's turn: a background one running, or
   * one waiting on a nested subagent it launched in the background.
   */
  private isFollowedBackgroundSubagent(cardId: string): boolean {
    const state = this.subagentStates.get(cardId);
    if (!state) {
      return false;
    }

    return (
      (state.status === "pending" || state.status === "running") &&
      Boolean(state.background || this.hasBackgroundLaunch(state))
    );
  }

  /** A turn boundary: a background subagent still running keeps its card and its events. */
  private retireForegroundSubagents(): void {
    for (const cardId of [...this.subagentOrder]) {
      if (!this.isFollowedBackgroundSubagent(cardId)) {
        this.retireSubagent(cardId);
      }
    }

    // A call that never reported its end must not keep a later turn's pairing ambiguous.
    for (const [callId, call] of this.openTaskCalls) {
      if (!call.cardId || !this.subagentStates.has(call.cardId)) {
        this.openTaskCalls.delete(callId);
      }
    }
  }

  /** The cards still running past the turn, for the `/abort` reply. */
  countFollowedBackgroundSubagents(): number {
    return this.subagentOrder.filter((cardId) => this.isFollowedBackgroundSubagent(cardId)).length;
  }

  /** Stops following background subagents; their cards stay as they were. */
  retireBackgroundSubagents(): void {
    for (const cardId of [...this.subagentOrder]) {
      if (this.isFollowedBackgroundSubagent(cardId)) {
        this.retireSubagent(cardId);
      }
    }
  }

  /**
   * Ends every foreground card still running as interrupted, timed to now. A background card
   * keeps running: the interrupt may not reach it, so only its child's own report ends it.
   * A card waiting on a nested subagent it launched in the background holds the interruption
   * until that launch ends. After a server restart every card ends and is dropped, its child
   * left resumable.
   */
  interruptSubagents(serverRestarted = false): void {
    const now = Date.now();
    let changed = false;
    for (const cardId of this.subagentOrder) {
      const state = this.subagentStates.get(cardId);
      if (!state || (state.status !== "pending" && state.status !== "running")) {
        continue;
      }

      if (!serverRestarted && (state.background || state.heldEnd)) {
        continue;
      }

      if (!serverRestarted && this.hasBackgroundLaunch(state)) {
        this.holdSubagentEnd(state, "interrupted", undefined);
        changed = true;
        continue;
      }

      state.status = "interrupted";
      this.clearSubagentActivity(state);
      state.launches.clear();
      state.terminalMessage = undefined;
      state.finishedAt = now;
      state.updatedAt = now;
      changed = true;
    }

    if (changed) {
      this.emitSubagentState();
    }

    for (const cardId of [...this.subagentOrder]) {
      if (serverRestarted) {
        this.retireSubagent(cardId, true);
      } else if (!this.isFollowedBackgroundSubagent(cardId)) {
        this.retireSubagent(cardId);
      }
    }
  }

  private clearSubagentActivity(state: SubagentState): void {
    state.currentTool = undefined;
    state.currentToolInput = undefined;
    state.currentToolTitle = undefined;
    state.currentToolCallId = undefined;
    state.currentToolStartedAt = undefined;
  }

  /** A card whose own run ended waits only for its background launches to end. */
  private hasHeldEnd(sessionId: string): boolean {
    const cardId = this.subagentCardIdBySessionId.get(sessionId);
    return Boolean(cardId && this.subagentStates.get(cardId)?.heldEnd);
  }

  private markBackgroundSubagent(childSessionId: string): void {
    const cardId = this.subagentCardIdBySessionId.get(childSessionId);
    const state = cardId ? this.subagentStates.get(cardId) : undefined;
    if (!state || state.background) {
      return;
    }

    state.background = true;
    this.emitSubagentState();
  }

  /** Applies a background intent recorded before the child's card attached. */
  private applyPendingBackgroundIntent(sessionId: string, state: SubagentState): void {
    if (!this.backgroundChildSessionIds.has(sessionId) || state.background) {
      return;
    }

    state.background = true;
    this.emitSubagentState();
  }

  private emitSubagentState(): void {
    if (!this.currentSessionId || !this.onSubagentCallback || this.subagentOrder.length === 0) {
      return;
    }

    const subagents = this.subagentOrder
      .map((cardId) => this.subagentStates.get(cardId))
      .filter((state): state is SubagentState => Boolean(state))
      .map((state) => ({
        cardId: state.cardId,
        sessionId: state.sessionId,
        parentSessionId: state.parentSessionId,
        agent: state.agent,
        description: state.description,
        prompt: state.prompt,
        command: state.command,
        status: state.status,
        providerID: state.providerID,
        modelID: state.modelID,
        variant: state.variant,
        tokens: { ...state.tokens },
        cost: state.cost,
        currentTool: state.currentTool,
        currentToolInput: state.currentToolInput ? { ...state.currentToolInput } : undefined,
        currentToolTitle: state.currentToolTitle,
        currentToolCallId: state.currentToolCallId,
        currentToolStartedAt: state.currentToolStartedAt,
        terminalMessage: state.terminalMessage,
        background: state.background,
        launchStartedAt: this.getNewestLaunch(state)?.startedAt,
        launchDescription: this.getNewestLaunch(state)?.description,
        waitsOnBackgroundLaunch: this.hasBackgroundLaunch(state),
        createdAt: state.createdAt,
        finishedAt: state.finishedAt,
        updatedAt: state.updatedAt,
      }));

    const snapshot = JSON.stringify(
      subagents.map((subagent) => ({
        cardId: subagent.cardId,
        sessionId: subagent.sessionId,
        parentSessionId: subagent.parentSessionId,
        agent: subagent.agent,
        description: subagent.description,
        prompt: subagent.prompt,
        command: subagent.command,
        status: subagent.status,
        providerID: subagent.providerID,
        modelID: subagent.modelID,
        variant: subagent.variant,
        tokens: subagent.tokens,
        cost: subagent.cost,
        currentTool: subagent.currentTool,
        currentToolInput: normalizeSnapshotValue(subagent.currentToolInput),
        currentToolTitle: subagent.currentToolTitle,
        currentToolCallId: subagent.currentToolCallId,
        currentToolStartedAt: subagent.currentToolStartedAt,
        terminalMessage: subagent.terminalMessage,
        background: subagent.background,
        launchStartedAt: subagent.launchStartedAt,
        launchDescription: subagent.launchDescription,
        waitsOnBackgroundLaunch: subagent.waitsOnBackgroundLaunch,
        finishedAt: subagent.finishedAt,
      })),
    );

    if (snapshot === this.lastSubagentSnapshot) {
      return;
    }

    this.lastSubagentSnapshot = snapshot;

    const sessionId = this.currentSessionId;
    // Returned, so a drain of held work waits for the cards to be drawn.
    this.scheduleOutbound(() => this.onSubagentCallback?.(sessionId, subagents), false);
  }

  private createSubagentState(
    parentSessionId: string,
    sessionId: string | null,
    cardId: string = `subagent-${parentSessionId}-${Date.now()}-${this.subagentOrder.length}`,
  ): SubagentState {
    const state: SubagentState = {
      cardId,
      sessionId,
      parentSessionId,
      agent: "",
      description: "",
      prompt: "",
      status: "pending",
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
      cost: 0,
      terminalMessage: undefined,
      updatedAt: Date.now(),
      hasSubtaskMetadata: false,
      hasTaskToolMetadata: false,
      hasSessionTitleMetadata: false,
      launches: new Map(),
      createdAt: Date.now(),
    };

    this.subagentStates.set(cardId, state);
    this.subagentOrder.push(cardId);
    if (sessionId) {
      this.subagentCardIdBySessionId.set(sessionId, cardId);
      this.applyPendingBackgroundIntent(sessionId, state);
    }
    return state;
  }

  private enrichSubagentFromSubtask(
    state: SubagentState,
    details: {
      agent: string;
      description: string;
      prompt: string;
      command?: string | undefined;
    },
  ): void {
    state.agent = details.agent || state.agent;
    state.description = details.description || details.prompt || state.description;
    state.prompt = details.prompt;
    state.command = details.command;
    state.hasSubtaskMetadata = true;
    state.updatedAt = Date.now();
  }

  private enrichSubagentFromTaskTool(
    state: SubagentState,
    details: {
      agent?: string | undefined;
      description?: string | undefined;
      prompt?: string | undefined;
      command?: string | undefined;
    },
  ): void {
    const nextDescription = details.description?.trim() || details.prompt?.trim();
    if (details.agent?.trim()) {
      state.agent = details.agent.trim();
    }
    if (nextDescription) {
      state.description = nextDescription;
    }
    if (details.prompt?.trim()) {
      state.prompt = details.prompt.trim();
    }
    if (details.command?.trim()) {
      state.command = details.command.trim();
    }
    state.hasTaskToolMetadata = true;
    state.updatedAt = Date.now();
  }

  private enrichSubagentFromSessionTitle(state: SubagentState, title?: string): void {
    const trimmedTitle = title?.trim();
    if (!trimmedTitle) {
      return;
    }

    const match = trimmedTitle.match(/^(.*?)(?:\s+\(@([^\s)]+)\s+subagent\))?$/i);
    const rawDescription = match?.[1]?.trim() || trimmedTitle;
    const rawAgent = match?.[2]?.trim();

    if (rawDescription) {
      state.description = rawDescription;
    }

    if (rawAgent) {
      state.agent = rawAgent.replace(/^@/, "");
    }

    state.hasSessionTitleMetadata = true;
    state.updatedAt = Date.now();
  }

  private attachSessionToSubagent(cardId: string, sessionId: string): void {
    const state = this.subagentStates.get(cardId);
    if (!state) {
      return;
    }

    state.sessionId = sessionId;
    state.updatedAt = Date.now();
    this.subagentCardIdBySessionId.set(sessionId, cardId);
    this.removeFromQueue(this.pendingSubagentCardIdsByParent, state.parentSessionId, cardId);
    this.applyPendingBackgroundIntent(sessionId, state);
  }

  /**
   * The card a root task call belongs to: the card of the child session the call names,
   * or - while it names none - the only card still waiting for its call, when this is
   * the only call still waiting for a card. Any other guess could put one subagent's
   * task on another subagent's card. An ended card is retired at once, so it never waits.
   */
  private findSubagentForTaskCall(
    callId: string,
    childSessionId: string | undefined,
  ): SubagentState | null {
    const call = this.openTaskCalls.get(callId);
    if (!call) {
      return null;
    }

    if (call.cardId) {
      return this.subagentStates.get(call.cardId) ?? null;
    }

    let cardId: string | undefined;
    if (childSessionId) {
      cardId = this.subagentCardIdBySessionId.get(childSessionId);
    } else {
      const openCalls = [...this.openTaskCalls.values()];
      const linkedCardIds = new Set(openCalls.map((openCall) => openCall.cardId));
      const waitingCalls = openCalls.filter(
        (openCall) => openCall.parentSessionId === call.parentSessionId && !openCall.cardId,
      );
      const waitingCards = this.subagentOrder
        .map((orderedCardId) => this.subagentStates.get(orderedCardId))
        .filter(
          (state): state is SubagentState =>
            state !== undefined &&
            state.parentSessionId === call.parentSessionId &&
            !state.hasTaskToolMetadata &&
            !linkedCardIds.has(state.cardId),
        );
      if (waitingCalls.length === 1 && waitingCards.length === 1) {
        cardId = waitingCards[0]!.cardId;
      }
    }

    if (!cardId) {
      return null;
    }

    call.cardId = cardId;
    return this.subagentStates.get(cardId) ?? null;
  }

  private updateSubagentFromTaskTool(
    parentSessionId: string,
    callId: string,
    state: ToolState,
  ): void {
    const status = "status" in state ? state.status : undefined;
    const hasEnded = status === "completed" || status === "error";
    if (!this.openTaskCalls.has(callId)) {
      if (hasEnded) {
        return;
      }
      this.openTaskCalls.set(callId, { parentSessionId, cardId: null });
    }

    const childSessionId =
      "metadata" in state && typeof state.metadata?.sessionId === "string"
        ? state.metadata.sessionId
        : undefined;
    const subagent = this.findSubagentForTaskCall(callId, childSessionId);
    if (hasEnded) {
      this.openTaskCalls.delete(callId);
    }

    const input = state.input;
    if (!subagent || !input) {
      return;
    }

    const description = typeof input.description === "string" ? input.description : undefined;
    const prompt = typeof input.prompt === "string" ? input.prompt : undefined;
    const agent = typeof input.subagent_type === "string" ? input.subagent_type : undefined;
    const command = typeof input.command === "string" ? input.command : undefined;

    if (!description && !prompt && !agent && !command) {
      return;
    }

    this.enrichSubagentFromTaskTool(subagent, { agent, description, prompt, command });
    this.emitSubagentState();
  }

  private getOrCreateSubagentForSession(sessionId: string): SubagentState {
    const existingCardId = this.subagentCardIdBySessionId.get(sessionId);
    if (existingCardId) {
      return this.subagentStates.get(existingCardId)!;
    }

    const parentSessionId =
      this.trackedSessionParents.get(sessionId) ?? this.currentSessionId ?? sessionId;
    this.removeFromQueue(this.pendingChildSessionIdsByParent, parentSessionId, sessionId);
    const state = this.createSubagentState(parentSessionId, sessionId);
    this.getQueue(this.fallbackSubagentCardIdsByParent, parentSessionId).push(state.cardId);
    return state;
  }

  private registerSubtaskPart(
    parentSessionId: string,
    partId: string,
    agent: string,
    description: string,
    prompt: string,
    command?: string,
  ): void {
    if (!this.acceptsSubagentEvents) {
      return;
    }

    const fallbackCardId = this.dequeue(this.fallbackSubagentCardIdsByParent, parentSessionId);
    if (fallbackCardId) {
      const fallbackState = this.subagentStates.get(fallbackCardId);
      if (fallbackState) {
        this.enrichSubagentFromSubtask(fallbackState, { agent, description, prompt, command });
        this.emitSubagentState();
        return;
      }
    }

    const state = this.createSubagentState(
      parentSessionId,
      null,
      `subtask-${parentSessionId}-${partId}`,
    );
    this.enrichSubagentFromSubtask(state, { agent, description, prompt, command });

    const pendingChildSessionId = this.dequeue(
      this.pendingChildSessionIdsByParent,
      parentSessionId,
    );
    if (pendingChildSessionId) {
      this.attachSessionToSubagent(state.cardId, pendingChildSessionId);
    } else {
      this.getQueue(this.pendingSubagentCardIdsByParent, parentSessionId).push(state.cardId);
    }

    this.emitSubagentState();
  }

  private trackChildSession(sessionId: string, parentSessionId: string): void {
    this.trackedSessionParents.set(sessionId, parentSessionId);

    const pendingCardId = this.dequeue(this.pendingSubagentCardIdsByParent, parentSessionId);
    if (pendingCardId) {
      this.attachSessionToSubagent(pendingCardId, sessionId);
      this.emitSubagentState();
      return;
    }

    this.getQueue(this.pendingChildSessionIdsByParent, parentSessionId).push(sessionId);
  }

  private handleSessionCreatedOrUpdated(
    event: Event & {
      type: "session.created" | "session.updated";
    },
  ): void {
    if (!this.currentSessionId) {
      return;
    }

    const { info } = event.properties;
    if (!info.parentID) {
      return;
    }

    if (this.finishedSubagentSessionIds.has(info.id)) {
      return;
    }

    // Launched by a tracked subagent, it belongs to the live tree whenever it arrives: it is
    // followed for its prompts and never gets a card.
    if (info.parentID !== this.currentSessionId && this.isTrackedChildSession(info.parentID)) {
      if (!this.trackedSessionParents.has(info.id)) {
        this.trackedSessionParents.set(info.id, info.parentID);
      }
      return;
    }

    // A background subagent's card outlives the run that started it, so an update of
    // its session arriving in a later run is not a stale discovery.
    const createdAt = info.time?.created;
    if (
      !this.subagentCardIdBySessionId.has(info.id) &&
      (!this.acceptsSubagentEvents ||
        (this.subagentRunStartedAt > 0 &&
          typeof createdAt === "number" &&
          createdAt < this.subagentRunStartedAt))
    ) {
      this.finishedSubagentSessionIds.add(info.id);
      return;
    }

    if (!this.trackedSessionParents.has(info.parentID)) {
      return;
    }

    if (info.id === this.currentSessionId) {
      return;
    }

    if (!this.trackedSessionParents.has(info.id)) {
      this.trackChildSession(info.id, info.parentID);
    }

    const subagent = this.getOrCreateSubagentForSession(info.id);
    this.enrichSubagentFromSessionTitle(subagent, info.title);
    this.emitSubagentState();
  }

  private updateSubagentFromAssistantMessage(info: {
    sessionID: string;
    providerID?: string;
    modelID?: string;
    variant?: string;
    agent?: string;
    tokens?: {
      input: number;
      output: number;
      reasoning: number;
      cache?: { read: number; write: number };
    };
    cost?: number;
  }): void {
    if (this.finishedSubagentSessionIds.has(info.sessionID) || this.hasHeldEnd(info.sessionID)) {
      return;
    }

    const subagent = this.getOrCreateSubagentForSession(info.sessionID);
    if (info.agent) {
      subagent.agent = info.agent;
    }
    if (info.providerID) {
      subagent.providerID = info.providerID;
    }
    if (info.modelID) {
      subagent.modelID = info.modelID;
    }
    if (info.variant) {
      subagent.variant = info.variant;
    }
    if (info.tokens) {
      subagent.tokens = {
        input: info.tokens.input,
        output: info.tokens.output,
        reasoning: info.tokens.reasoning,
        cacheRead: info.tokens.cache?.read || 0,
        cacheWrite: info.tokens.cache?.write || 0,
      };
    }
    if (typeof info.cost === "number") {
      subagent.cost = info.cost;
    }
    subagent.updatedAt = Date.now();
    this.emitSubagentState();
  }

  private updateSubagentToolState(
    sessionId: string,
    state: ToolState,
    tool: string,
    callId: string,
    input?: { [key: string]: unknown },
    title?: string,
  ): void {
    if (this.finishedSubagentSessionIds.has(sessionId)) {
      return;
    }

    const subagent = this.getOrCreateSubagentForSession(sessionId);
    const status = "status" in state ? state.status : undefined;

    if (tool === "task" && !this.updateSubagentLaunch(subagent, callId, state)) {
      return;
    }

    if (subagent.heldEnd) {
      return;
    }

    if (status === "running") {
      subagent.status = "running";
      subagent.terminalMessage = undefined;
    }

    if (status === "pending" && subagent.status === "pending") {
      subagent.status = "pending";
      subagent.terminalMessage = undefined;
    }

    if (callId && subagent.currentToolCallId !== callId) {
      subagent.currentToolCallId = callId;
      subagent.currentToolStartedAt = subagent.launches.get(callId)?.startedAt ?? Date.now();
    }

    subagent.currentTool = tool;
    subagent.currentToolInput = input ? { ...input } : undefined;
    subagent.currentToolTitle = title;
    subagent.updatedAt = Date.now();
    this.emitSubagentState();
  }

  /**
   * Records a `task` call of the card's own subagent - a nested subagent launch. Only its
   * first event takes the line, and its end leaves the line to whatever runs next. Returns
   * whether the event still goes on to the card's line.
   */
  private updateSubagentLaunch(subagent: SubagentState, callId: string, state: ToolState): boolean {
    const status = "status" in state ? state.status : undefined;
    const launch = subagent.launches.get(callId);

    if (status === "completed" || status === "error") {
      if (!launch) {
        return false;
      }

      subagent.launches.delete(callId);
      if (subagent.heldEnd && !this.hasBackgroundLaunch(subagent)) {
        const { status: endStatus, terminalMessage, finishedAt } = subagent.heldEnd;
        this.endSubagent(subagent, endStatus, terminalMessage, finishedAt);
        return false;
      }

      if (subagent.currentToolCallId === callId) {
        this.clearSubagentActivity(subagent);
      }
      subagent.updatedAt = Date.now();
      this.emitSubagentState();
      return false;
    }

    if (subagent.heldEnd) {
      return false;
    }

    const shown = Object.keys(state.input ?? {}).length > 0;
    const background = isBackgroundTaskCall(state);
    const description =
      typeof state.input?.description === "string" ? state.input.description : undefined;
    if (!launch) {
      subagent.launches.set(callId, { startedAt: Date.now(), background, shown, description });
      return true;
    }

    launch.background ||= background;
    launch.shown ||= shown;
    launch.description = description ?? launch.description;
    if (subagent.currentToolCallId === callId) {
      return true;
    }

    // An older launch reporting again: the line stays on what started after it.
    this.emitSubagentState();
    return false;
  }

  private updateSubagentStepStart(sessionId: string, snapshot?: string): void {
    if (this.finishedSubagentSessionIds.has(sessionId) || this.hasHeldEnd(sessionId)) {
      return;
    }

    const subagent = this.getOrCreateSubagentForSession(sessionId);
    subagent.status = "running";
    subagent.terminalMessage = undefined;
    subagent.currentTool = undefined;
    subagent.currentToolInput = undefined;
    subagent.currentToolTitle = snapshot?.trim() || subagent.currentToolTitle;
    subagent.updatedAt = Date.now();
    this.emitSubagentState();
  }

  private updateSubagentStepFinish(
    sessionId: string,
    tokens: {
      input: number;
      output: number;
      reasoning: number;
      cache: { read: number; write: number };
    },
    cost: number,
    snapshot?: string,
  ): void {
    if (this.finishedSubagentSessionIds.has(sessionId) || this.hasHeldEnd(sessionId)) {
      return;
    }

    const subagent = this.getOrCreateSubagentForSession(sessionId);
    subagent.status = "running";
    subagent.terminalMessage = undefined;
    subagent.tokens = {
      input: tokens.input,
      output: tokens.output,
      reasoning: tokens.reasoning,
      cacheRead: tokens.cache.read,
      cacheWrite: tokens.cache.write,
    };
    subagent.cost += cost;
    if (snapshot?.trim()) {
      subagent.currentToolTitle = snapshot.trim();
    }
    subagent.updatedAt = Date.now();
    this.emitSubagentState();
  }

  private setSubagentTerminalStatus(
    sessionId: string,
    status: SubagentEndStatus,
    terminalMessage?: string,
  ): void {
    const cardId = this.subagentCardIdBySessionId.get(sessionId);
    if (!cardId) {
      return;
    }

    const subagent = this.subagentStates.get(cardId);
    if (!subagent || subagent.heldEnd) {
      return;
    }

    if (this.hasBackgroundLaunch(subagent)) {
      this.holdSubagentEnd(subagent, status, terminalMessage);
      this.emitSubagentState();
      return;
    }

    // Frozen on purpose: the card is re-rendered on a heartbeat, so a duration
    // derived from the current time would keep growing after the run ended.
    this.endSubagent(subagent, status, terminalMessage, Date.now());
  }

  /**
   * A nested subagent it launched in the background still runs: the card keeps that
   * launch's line and shows its own end once the launch ends.
   */
  private holdSubagentEnd(
    subagent: SubagentState,
    status: SubagentEndStatus,
    terminalMessage: string | undefined,
  ): void {
    for (const [callId, launch] of subagent.launches) {
      if (!launch.background) {
        subagent.launches.delete(callId);
      }
    }
    subagent.heldEnd = {
      status,
      terminalMessage: terminalMessage?.trim() || undefined,
      finishedAt: Date.now(),
    };
    this.clearSubagentActivity(subagent);
    subagent.updatedAt = Date.now();
  }

  private endSubagent(
    subagent: SubagentState,
    status: SubagentEndStatus,
    terminalMessage: string | undefined,
    finishedAt: number,
  ): void {
    subagent.status = status;
    this.clearSubagentActivity(subagent);
    subagent.launches.clear();
    subagent.terminalMessage = terminalMessage?.trim() || undefined;
    subagent.finishedAt = finishedAt;
    subagent.updatedAt = Date.now();
    this.emitSubagentState();
    this.retireSubagent(subagent.cardId);
  }

  private handleMessageUpdated(
    event: Event & {
      type: "message.updated";
    },
  ): void {
    const { info } = event.properties;

    if (info.sessionID === this.currentSessionId && info.role === "user") {
      this.acceptsSubagentEvents = true;
      this.subagentRunStartedAt =
        typeof info.time?.created === "number" ? info.time.created : Date.now();
    }

    if (this.isTrackedChildSession(info.sessionID)) {
      if (info.role === "assistant" && !this.isNestedSubagentSession(info.sessionID)) {
        this.updateSubagentFromAssistantMessage(info);
      }
      return;
    }

    if (info.sessionID !== this.currentSessionId) {
      return;
    }

    const messageID = info.id;

    this.messages.set(messageID, { role: info.role });

    if (info.role === "user") {
      this.emitExternalUserInputIfReady(info.sessionID, messageID);
      return;
    }

    if (info.role === "assistant") {
      if (!this.textMessageStates.has(messageID)) {
        this.textMessageStates.set(messageID, {
          orderedPartIds: [],
          partTexts: new Map(),
          optimisticUpdateCount: 0,
        });
        this.messageCount++;
        this.startTypingIndicator();
      }

      const textState = this.getOrCreateTextMessageState(messageID);

      const time = info.time;
      const isCompleted = Boolean(time?.completed);
      const messageText = this.getCombinedMessageText(messageID, isCompleted);

      if (!isCompleted && textState.optimisticUpdateCount === 1) {
        this.emitPartialText(info.sessionID, messageID, messageText);
      }

      // Extract and report tokens for EVERY message.updated with token data
      // (both intermediate and completed). This keeps keyboard context in sync.
      const assistantInfo = info;


      if (this.onTokensCallback && assistantInfo.tokens) {
        const tokens: TokensInfo = {
          input: assistantInfo.tokens.input,
          output: assistantInfo.tokens.output,
          reasoning: assistantInfo.tokens.reasoning,
          cacheRead: assistantInfo.tokens.cache?.read || 0,
          cacheWrite: assistantInfo.tokens.cache?.write || 0,
        };
        logger.debug(
          `[Aggregator] Tokens: input=${tokens.input}, output=${tokens.output}, reasoning=${tokens.reasoning}, cacheRead=${tokens.cacheRead}, cacheWrite=${tokens.cacheWrite}, completed=${isCompleted}`,
        );
        // Call synchronously so keyboardManager is updated before onComplete sends the reply
        this.deliverOutbound(
          () => this.onTokensCallback?.(info.sessionID, tokens, isCompleted),
          false,
        );
      }

      if (isCompleted) {
        const finalText = messageText;

        logger.debug(
          `[Aggregator] Message part completed: messageId=${messageID}, textLength=${finalText.length}, totalParts=${textState.orderedPartIds.length}, session=${this.currentSessionId}`,
        );

        // This is the only trace left once the placeholder is filtered out, so
        // an upstream regression stays visible in the logs.
        const droppedParts = textState.orderedPartIds.filter((partID) =>
          isUpstreamEmptyResponseText(textState.partTexts.get(partID) || "", true),
        );
        if (droppedParts.length > 0) {
          logger.warn(
            `[Aggregator] Dropped upstream empty-response placeholder: messageId=${messageID}, parts=${droppedParts.length}, session=${this.currentSessionId}`,
          );
        }

        // Extract and report cost
        if (this.onCostCallback && assistantInfo.cost !== undefined) {
          logger.debug(`[Aggregator] Cost: $${assistantInfo.cost.toFixed(2)}`);
          this.deliverOutbound(
            () => this.onCostCallback?.(info.sessionID, assistantInfo.cost),
            false,
          );
        }

        if (this.onCompleteCallback && finalText.length > 0) {
          const sessionId = this.currentSessionId;
          this.scheduleOutbound(() => {
            if (!sessionId) {
              return;
            }
            this.onCompleteCallback?.(sessionId, messageID, finalText, {
              agent: info.agent,
              providerID: info.providerID,
              modelID: info.modelID,
              createdAt: time?.created,
              completedAt: time?.completed,
            });
          }, false);
        }

          this.cleanupCompletedMessage(messageID);

          logger.debug(
            `[Aggregator] Message completed cleanup: remaining messages=${this.textMessageStates.size}`,
          );
        }

    }
  }

  private handleMessagePartUpdated(
    event: Event & {
      type: "message.part.updated";
    },
  ): void {
    const { part } = event.properties;

    const isCurrentRootSession = part.sessionID === this.currentSessionId;
    const isTrackedChildSession = this.isTrackedChildSession(part.sessionID);

    if (!isCurrentRootSession && !isTrackedChildSession) {
      return;
    }

    if (this.isNestedSubagentSession(part.sessionID)) {
      return;
    }

    if (part.type === "subtask") {
      // A subtask of a subagent would be a nested subagent, which gets no card.
      if (!isCurrentRootSession) {
        return;
      }
      this.registerSubtaskPart(
        part.sessionID,
        part.id,
        part.agent,
        part.description,
        part.prompt,
        part.command,
      );
      return;
    }

    if (isTrackedChildSession) {
      if (part.type === "tool") {
        const state = part.state;
        const input = state.input;
        const title = "title" in state ? state.title : undefined;
        this.updateSubagentToolState(part.sessionID, state, part.tool, part.callID, input, title);
      }

      if (part.type === "step-start") {
        this.updateSubagentStepStart(part.sessionID, part.snapshot);
      }

      if (part.type === "step-finish") {
        this.updateSubagentStepFinish(part.sessionID, part.tokens, part.cost, part.snapshot);
      }

      return;
    }

    const messageID = part.messageID;
    const messageInfo = this.messages.get(messageID);

    // OpenCode injects synthetic text parts of its own: expanded file attachments,
    // MCP resource dumps, plan-mode hints. They are context for the model, never content
    // for the user - rendering them would echo a whole attached file back into the chat.
    if (part.type === "text" && "synthetic" in part && part.synthetic === true) {
      this.registerSyntheticPart(messageID, part.id);
      return;
    }

    if (part.type === "text") {
      this.registerKnownTextPart(messageID, part.id);
      this.registerTextPart(messageID, part.id);
    }

    if (part.type === "reasoning") {
      this.registerThinkingPart(
        messageID,
        part.id,
        this.extractReasoningTitle(part),
      );
    }

    const deltaFromUpdated = "delta" in event.properties ? event.properties.delta : undefined;
    if (
      part.type === "text" &&
      typeof deltaFromUpdated === "string" &&
      deltaFromUpdated.length > 0
    ) {
      this.emitThinkingFinishedOnce(part.sessionID, messageID);
      this.applyTextDelta(part.sessionID, messageID, part.id, deltaFromUpdated, part.text);
      return;
    }

    if (
      part.type === "reasoning" &&
      typeof deltaFromUpdated === "string" &&
      deltaFromUpdated.length > 0
    ) {
      const partText = "text" in part && typeof part.text === "string" ? part.text : undefined;
      this.applyThinkingDelta(
        part.sessionID,
        messageID,
        part.id,
        deltaFromUpdated,
        partText,
        this.extractReasoningTitle(part),
      );
      return;
    }

    if (part.type === "reasoning") {
      // Fire the thinking callback on every reasoning update. The first update
      // preserves the old lightweight indicator behavior for callers that do
      // not display full reasoning content.
      const isFirstUpdate = !this.thinkingFiredForMessages.has(messageID);
      if (isFirstUpdate) {
        this.thinkingFiredForMessages.add(messageID);
      }

      const partText = "text" in part && typeof part.text === "string" ? part.text : "";
      const wasUpdated = this.setThinkingPartSnapshot(
        messageID,
        part.id,
        partText,
        this.extractReasoningTitle(part),
      );
      if (isFirstUpdate || wasUpdated) {
        this.emitThinkingUpdate(part.sessionID, messageID, isFirstUpdate);
      }
    } else if (part.type === "text" && "text" in part && part.text) {
      const wasUpdated =
        messageInfo && messageInfo.role === "assistant"
          ? this.setTextPartSnapshot(messageID, part.id, part.text)
          : this.setOptimisticTextSnapshot(messageID, part.id, part.text);
      if (!wasUpdated) {
        return;
      }

      this.emitThinkingFinishedOnce(part.sessionID, messageID);

      const fullText = this.getCombinedMessageText(messageID);

      if (messageInfo && messageInfo.role === "assistant") {
        this.startTypingIndicator();
        this.emitPartialText(part.sessionID, messageID, fullText);
      } else if (messageInfo && messageInfo.role === "user") {
        this.emitExternalUserInputIfReady(part.sessionID, messageID);
      } else {
        const state = this.getOrCreateTextMessageState(messageID);
        state.optimisticUpdateCount++;

        if (state.optimisticUpdateCount >= 2) {
          this.emitPartialText(part.sessionID, messageID, fullText);
        }
      }
    } else if (part.type === "tool") {
      const state = part.state;
      const input = state.input;
      const title = "title" in state ? state.title : undefined;

      if (part.tool === "task") {
        this.updateSubagentFromTaskTool(part.sessionID, part.callID, state);

        const childSessionId =
          "metadata" in state && state.metadata ? state.metadata.sessionId : undefined;
        // The running state is transient and the task part can land before the
        // child card exists, so accept a completed state and a background flag
        // carried on the metadata (a promoted foreground task) as well.
        if (
          "status" in state &&
          (state.status === "running" || state.status === "completed") &&
          isBackgroundTaskCall(state) &&
          typeof childSessionId === "string"
        ) {
          this.backgroundChildSessionIds.add(childSessionId);
          this.markBackgroundSubagent(childSessionId);
        }
      }

      logger.debug(
        `[Aggregator] Tool event: callID=${part.callID}, tool=${part.tool}, status=${"status" in state ? state.status : "unknown"}`,
      );

      if (this.onRootToolUpdateCallback) {
        const callback = this.onRootToolUpdateCallback;
        this.scheduleOutbound(() => callback({
          sessionId: part.sessionID,
          messageId: messageID,
          callId: part.callID,
          tool: part.tool,
          state: part.state,
          input,
          title,
          metadata: "metadata" in state ? state.metadata : undefined,
          hasFileAttachment: false,
        }), false);
      }

      if (part.tool === "question") {
        logger.debug(`[Aggregator] Question tool part update:`, JSON.stringify(part, null, 2));

        // If the question tool fails, clear the active poll
        // so the agent can recreate it with corrected data
        if ("status" in state && state.status === "error") {
          logger.info(
            `[Aggregator] Question tool failed with error, clearing active poll. callID=${part.callID}`,
          );
          if (this.onQuestionErrorCallback) {
            const sessionId = part.sessionID;
            this.scheduleOutbound(() => {
              this.onQuestionErrorCallback?.(sessionId);
            }, true);
          }
          return;
        }

        // NOTE: Questions are now handled via "question.asked" event, not via tool part updates.
        // This ensures we have access to the requestID needed for question.reply().
      }

      if ("status" in state && state.status === "completed") {
        logger.debug(
          `[Aggregator] Tool completed: callID=${part.callID}, tool=${part.tool}`,
          JSON.stringify(state, null, 2),
        );

        const completedKey = `completed-${part.callID}`;

        if (!this.processedToolStates.has(completedKey)) {
          this.processedToolStates.add(completedKey);

          const preparedFiles = this.prepareToolFiles(part.tool, input, title, state.metadata);
          const hasFileAttachment = preparedFiles.some((file) => file.fileData);

          const toolData: ToolInfo = {
            sessionId: part.sessionID,
            messageId: messageID,
            callId: part.callID,
            tool: part.tool,
            state: part.state,
            input,
            title,
            metadata: state.metadata,
            hasFileAttachment,
          };

          logger.debug(
            `[Aggregator] Sending tool notification to Telegram: tool=${part.tool}, title=${title || "N/A"}`,
          );

          if (this.onToolCallback) {
            const callback = this.onToolCallback;
            this.scheduleOutbound(() => callback(toolData), false);
          }

          if (hasFileAttachment && this.onToolFileCallback) {
            logger.debug(
              `[Aggregator] Sending ${part.tool} files: ${preparedFiles
                .map(({ fileData }) =>
                  fileData ? `${fileData.filename} (${fileData.buffer.length} bytes)` : "text line",
                )
                .join(", ")}`,
            );
            const callback = this.onToolFileCallback;
            const files = preparedFiles.map(({ fileData, line }): ToolFileEntry => ({
              fileData,
              ...(line !== undefined ? { line } : {}),
            }));
            this.scheduleOutbound(
              () =>
                callback({
                  ...toolData,
                  hasFileAttachment: true,
                  files,
                }),
              false,
            );
          }

          if (this.onFileChangeCallback) {
            const callback = this.onFileChangeCallback;
            for (const { fileChange } of preparedFiles) {
              if (fileChange) {
                this.deliverOutbound(() => callback(part.sessionID, fileChange), false);
              }
            }
          }
        }
      }
    }
  }

  private handleMessagePartDelta(event: MessagePartDeltaEventRaw): void {
    const part = event.properties.part;
    const sessionID = part?.sessionID || event.properties.sessionID;
    const messageID = part?.messageID || event.properties.messageID;
    const partID = part?.id || event.properties.partID || "text";
    const partType = part?.type || event.properties.type;
    const delta = event.properties.delta;

    if (!sessionID || !messageID || typeof delta !== "string" || delta.length === 0) {
      return;
    }

    // Same filter as in handleMessagePartUpdated, applied to the streaming path: a delta
    // event often carries only the part id, so the flag is looked up in the registry too.
    const isSynthetic =
      part?.synthetic === true ||
      (this.syntheticPartIds.get(messageID)?.has(partID) ?? false);
    if (isSynthetic) {
      this.registerSyntheticPart(messageID, partID);
      return;
    }

    if (partType === "reasoning" || (!partType && this.isKnownThinkingPart(messageID, partID))) {
      const title = part ? this.extractReasoningTitle(part) : undefined;
      this.applyThinkingDelta(sessionID, messageID, partID, delta, part?.text, title);
      return;
    }

    if (partType && partType !== "text") {
      return;
    }

    if (partType === "text") {
      this.registerKnownTextPart(messageID, partID);
      this.registerTextPart(messageID, partID);
    } else {
      const knownTextIds = this.knownTextPartIds.get(messageID);
      const isKnownTextPart = knownTextIds?.has(partID) ?? false;
      const thinkingFired = this.thinkingFiredForMessages.has(messageID);

      if (thinkingFired && !isKnownTextPart) {
        return;
      }

      if (!thinkingFired && !isKnownTextPart) {
        this.registerKnownTextPart(messageID, partID);
        this.registerTextPart(messageID, partID);
      }
    }

    this.emitThinkingFinishedOnce(sessionID, messageID);
    this.applyTextDelta(sessionID, messageID, partID, delta, part?.text);
  }

  private applyTextDelta(
    sessionID: string,
    messageID: string,
    partID: string,
    delta: string,
    fullTextHint?: string,
  ): void {
    if (sessionID !== this.currentSessionId) {
      return;
    }

    this.registerTextPart(messageID, partID);

    const state = this.getOrCreateTextMessageState(messageID);
    const previous = state.partTexts.get(partID) || "";
    let accumulated = `${previous}${delta}`;

    if (typeof fullTextHint === "string" && fullTextHint.length > accumulated.length) {
      accumulated = fullTextHint;
    }

    state.partTexts.set(partID, accumulated);

    const combined = this.getCombinedMessageText(messageID);
    if (!combined.trim()) {
      return;
    }

    const messageInfo = this.messages.get(messageID);
    if (messageInfo?.role === "user") {
      this.emitExternalUserInputIfReady(sessionID, messageID);
      return;
    }

    this.startTypingIndicator();
    this.emitPartialText(sessionID, messageID, combined);
  }

  private extractReasoningTitle(part: unknown): string | undefined {
    if (!isRecord(part)) {
      return undefined;
    }

    for (const key of ["title", "heading", "summary", "name"]) {
      const value = part[key];
      if (typeof value === "string" && value.trim()) {
        return value;
      }
    }

    const metadata = part.metadata;
    if (isRecord(metadata)) {
      for (const key of ["title", "heading", "summary", "name"]) {
        const value = metadata[key];
        if (typeof value === "string" && value.trim()) {
          return value;
        }
      }
    }

    return undefined;
  }

  private getOrCreateThinkingMessageState(messageID: string): ThinkingMessageState {
    let state = this.thinkingMessageStates.get(messageID);
    if (!state) {
      state = {
        orderedPartIds: [],
        sections: new Map(),
      };
      this.thinkingMessageStates.set(messageID, state);
    }
    return state;
  }

  private isKnownThinkingPart(messageID: string, partID: string): boolean {
    return this.thinkingMessageStates.get(messageID)?.sections.has(partID) ?? false;
  }

  private registerThinkingPart(messageID: string, partID: string, title?: string): void {
    const state = this.getOrCreateThinkingMessageState(messageID);
    if (!state.orderedPartIds.includes(partID)) {
      state.orderedPartIds.push(partID);
    }

    const existing = state.sections.get(partID);
    if (!existing) {
      const section: ThinkingSection = { id: partID, text: "" };
      if (title) {
        section.title = title;
      }
      state.sections.set(partID, section);
      return;
    }

    if (title && existing.title !== title) {
      existing.title = title;
    }
  }

  private setThinkingPartSnapshot(
    messageID: string,
    partID: string,
    text: string,
    title?: string,
  ): boolean {
    this.registerThinkingPart(messageID, partID, title);

    const state = this.getOrCreateThinkingMessageState(messageID);
    const existing = state.sections.get(partID);
    const nextTitle = title ?? existing?.title;

    if (existing && existing.text === text && existing.title === nextTitle) {
      return false;
    }

    const next: ThinkingSection = { id: partID, text };
    if (nextTitle) {
      next.title = nextTitle;
    }
    state.sections.set(partID, next);
    return true;
  }

  private applyThinkingDelta(
    sessionID: string,
    messageID: string,
    partID: string,
    delta: string,
    fullTextHint?: string,
    title?: string,
  ): void {
    if (sessionID !== this.currentSessionId) {
      return;
    }

    this.registerThinkingPart(messageID, partID, title);

    const state = this.getOrCreateThinkingMessageState(messageID);
    const existing = state.sections.get(partID);
    const previous = existing?.text ?? "";
    let accumulated = `${previous}${delta}`;

    if (typeof fullTextHint === "string" && fullTextHint.length > accumulated.length) {
      accumulated = fullTextHint;
    }

    this.setThinkingPartSnapshot(messageID, partID, accumulated, title ?? existing?.title);
    this.emitThinkingUpdate(sessionID, messageID, false);
  }

  private getThinkingSections(messageID: string): ThinkingSection[] {
    const state = this.thinkingMessageStates.get(messageID);
    if (!state) {
      return [];
    }

    return state.orderedPartIds
      .map((partID) => state.sections.get(partID))
      .filter((section): section is ThinkingSection => Boolean(section))
      .map((section) => ({ ...section }));
  }

  private emitThinkingUpdate(
    sessionId: string,
    messageId: string,
    isFirstUpdate: boolean,
  ): void {
    if (!this.onThinkingCallback) {
      return;
    }

    const sections = this.getThinkingSections(messageId);
    if (sections.length === 0) {
      return;
    }

    const callback = this.onThinkingCallback;
    this.scheduleOutbound(
      () => {
        callback({ sessionId, messageId, sections, isFirstUpdate });
      },
      true,
      `thinking:${sessionId}:${messageId}:${isFirstUpdate ? "first" : "next"}`,
    );
  }

  private emitThinkingFinishedOnce(sessionId: string, messageId: string): void {
    if (
      !this.onThinkingFinishedCallback ||
      !this.thinkingFiredForMessages.has(messageId) ||
      this.thinkingFinishedForMessages.has(messageId)
    ) {
      return;
    }

    this.thinkingFinishedForMessages.add(messageId);
    const callback = this.onThinkingFinishedCallback;
    this.scheduleOutbound(() => {
      callback(sessionId, messageId);
    }, true);
  }

  private emitExternalUserInputIfReady(sessionId: string, messageId: string): void {
    if (sessionId !== this.currentSessionId || this.deliveredExternalUserMessageIds.has(messageId)) {
      return;
    }

    const messageInfo = this.messages.get(messageId);
    if (!messageInfo || messageInfo.role !== "user") {
      return;
    }

    const messageText = this.getCombinedMessageText(messageId).trim();
    if (!messageText) {
      return;
    }

    this.deliveredExternalUserMessageIds.add(messageId);
    this.cleanupCompletedMessage(messageId);

    if (!this.onExternalUserInputCallback) {
      return;
    }

    const callback = this.onExternalUserInputCallback;
    this.scheduleOutbound(() => {
      return Promise.resolve(callback(sessionId, messageId, messageText)).catch((err) => {
        logger.error("[Aggregator] Error in external user input callback:", err);
      });
    }, true);
  }

  private cleanupCompletedMessage(messageId: string): void {
    this.textMessageStates.delete(messageId);
    this.thinkingMessageStates.delete(messageId);
    this.messages.delete(messageId);
    this.partHashes.delete(messageId);
    this.knownTextPartIds.delete(messageId);
    this.syntheticPartIds.delete(messageId);
    this.thinkingFiredForMessages.delete(messageId);
    this.thinkingFinishedForMessages.delete(messageId);

    if (this.textMessageStates.size === 0) {
      logger.debug("[Aggregator] No more active messages, stopping typing indicator");
      this.stopTypingIndicator();
    }
  }

  private emitPartialText(sessionId: string, messageId: string, messageText: string): void {
    if (!this.onPartialCallback || !messageText.trim()) {
      return;
    }

    const callback = this.onPartialCallback;
    this.scheduleOutbound(
      () => {
        try {
          callback(sessionId, messageId, messageText);
        } catch (err) {
          logger.error("[Aggregator] Error in partial callback:", err);
        }
      },
      false,
      `partial:${sessionId}:${messageId}`,
    );
  }

  private getOrCreateTextMessageState(messageID: string): TextMessageState {
    const existing = this.textMessageStates.get(messageID);
    if (existing) {
      return existing;
    }

    const state: TextMessageState = {
      orderedPartIds: [],
      partTexts: new Map(),
      optimisticUpdateCount: 0,
    };
    this.textMessageStates.set(messageID, state);
    return state;
  }

  private registerKnownTextPart(messageID: string, partID: string): void {
    if (!this.knownTextPartIds.has(messageID)) {
      this.knownTextPartIds.set(messageID, new Set());
    }

    this.knownTextPartIds.get(messageID)!.add(partID);
  }

  private registerSyntheticPart(messageID: string, partID: string): void {
    if (!this.syntheticPartIds.has(messageID)) {
      this.syntheticPartIds.set(messageID, new Set());
    }

    this.syntheticPartIds.get(messageID)!.add(partID);
  }

  private registerTextPart(messageID: string, partID: string): void {
    const state = this.getOrCreateTextMessageState(messageID);
    if (!state.orderedPartIds.includes(partID)) {
      state.orderedPartIds.push(partID);
    }
  }

  private setTextPartSnapshot(messageID: string, partID: string, text: string): boolean {
    const normalized = text;
    const partHash = this.hashString(`${partID}\n${normalized}`);

    if (!this.partHashes.has(messageID)) {
      this.partHashes.set(messageID, new Set());
    }

    const hashes = this.partHashes.get(messageID)!;
    if (hashes.has(partHash)) {
      return false;
    }

    hashes.add(partHash);

    this.registerTextPart(messageID, partID);
    const state = this.getOrCreateTextMessageState(messageID);
    state.partTexts.set(partID, normalized);
    return true;
  }

  private setOptimisticTextSnapshot(messageID: string, partID: string, text: string): boolean {
    const wasUpdated = this.setTextPartSnapshot(messageID, partID, text);
    if (!wasUpdated) {
      return false;
    }

    const state = this.getOrCreateTextMessageState(messageID);
    state.orderedPartIds = [partID];
    state.partTexts = new Map([[partID, text]]);
    return true;
  }

  private getCombinedMessageText(messageID: string, isFinal = false): string {
    const state = this.textMessageStates.get(messageID);
    if (!state) {
      return "";
    }

    const texts = state.orderedPartIds.map((partID) => state.partTexts.get(partID) || "");

    // The placeholder is produced for model responses only, so user text is
    // never filtered - it must reach the bot verbatim.
    if (this.messages.get(messageID)?.role === "user") {
      return texts.join("");
    }

    return texts.filter((text) => !isUpstreamEmptyResponseText(text, isFinal)).join("");
  }

  private prepareToolFiles(
    tool: string,
    input: { [key: string]: unknown } | undefined,
    title: string | undefined,
    metadata: { [key: string]: unknown } | undefined,
  ): PreparedToolFile[] {
    if (tool === "write" && input) {
      const filePath =
        typeof input.filePath === "string" ? normalizePathForDisplay(input.filePath) : "";
      const content = typeof input.content === "string" ? input.content : "";
      const hasContent = typeof input.content === "string";

      if (!filePath || !hasContent) {
        return [];
      }

      return [
        {
          fileData: prepareCodeFile(content, filePath, "write"),
          fileChange: {
            file: filePath,
            additions: content.split("\n").length,
            deletions: 0,
          },
        },
      ];
    }

    if (tool === "edit" && metadata) {
      const filediff = isRecord(metadata.filediff) ? metadata.filediff : undefined;
      const filePath =
        typeof filediff?.file === "string" && filediff.file
          ? normalizePathForDisplay(filediff.file)
          : "";
      const diffText = typeof metadata.diff === "string" ? metadata.diff : "";

      if (!filePath || !diffText) {
        return [];
      }

      return [
        {
          fileData: prepareCodeFile(diffText, filePath, "edit"),
          fileChange: {
            file: filePath,
            additions: typeof filediff?.additions === "number" ? filediff.additions : 0,
            deletions: typeof filediff?.deletions === "number" ? filediff.deletions : 0,
          },
        },
      ];
    }

    if (tool === "apply_patch") {
      const changes = getPatchFileChanges(metadata);
      if (changes.length > 0) {
        return changes.map((change) => ({
          fileData: change.diff ? prepareCodeFile(change.diff, change.path, "edit") : null,
          fileChange: {
            file: change.path,
            additions: change.additions,
            deletions: change.deletions,
          },
          line: formatPatchFileLine(change),
        }));
      }

      const filediff = isRecord(metadata?.filediff) ? metadata.filediff : undefined;

      const filePathFromInput =
        input && typeof input.filePath === "string"
          ? normalizePathForDisplay(input.filePath)
          : input && typeof input.path === "string"
            ? normalizePathForDisplay(input.path)
            : "";
      const filePathFromTitle = title ? extractFirstUpdatedFileFromTitle(title) : "";

      const filePath =
        (typeof filediff?.file === "string" && filediff.file && normalizePathForDisplay(filediff.file)) ||
        filePathFromInput ||
        normalizePathForDisplay(filePathFromTitle);
      const diffText =
        typeof metadata?.diff === "string"
          ? metadata.diff
          : input && typeof input.patchText === "string"
            ? input.patchText
            : "";

      if (!filePath) {
        return [];
      }

      const fileChange = filediff
        ? {
            file: filePath,
            additions: typeof filediff.additions === "number" ? filediff.additions : 0,
            deletions: typeof filediff.deletions === "number" ? filediff.deletions : 0,
          }
        : diffText
          ? (() => {
              const changes = countDiffChangesFromText(diffText);
              return {
                file: filePath,
                additions: changes.additions,
                deletions: changes.deletions,
              };
            })()
          : null;

      const fileData = diffText ? prepareCodeFile(diffText, filePath, "edit") : null;
      return fileData || fileChange ? [{ fileData, fileChange }] : [];
    }

    return [];
  }

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  private handleSessionStatus(
    event: Event & {
      type: "session.status";
    },
  ): void {
    const { sessionID, status } = event.properties;

    if (sessionID !== this.currentSessionId) {
      return;
    }

    if (status?.type === "busy") {
      this.liveTurnStartedAt ??= Date.now();
      return;
    }

    if (status?.type !== "retry" || !this.onSessionRetryCallback) {
      return;
    }

    const callback = this.onSessionRetryCallback;
    const message = status.message?.trim() || "Unknown retry error";

    logger.warn(
      `[Aggregator] Session retry: session=${sessionID}, attempt=${status.attempt ?? "n/a"}, message=${message}`,
    );

    this.scheduleOutbound(() => {
      callback({
        sessionId: sessionID,
        attempt: status.attempt,
        message,
        next: status.next,
      });
    }, true);
  }

  private handleSessionIdle(
    event: Event & {
      type: "session.idle";
    },
  ): void {
    const { sessionID } = event.properties;
    const interrupted = isInterruptedIdle(event.properties);

    if (this.isTrackedChildSession(sessionID)) {
      logger.info(
        `[Aggregator] Subagent session became idle: ${sessionID}, interrupted=${interrupted}`,
      );
      if (this.isNestedSubagentSession(sessionID)) {
        this.endNestedSubagentSession(sessionID);
      } else {
        this.setSubagentTerminalStatus(sessionID, interrupted ? "interrupted" : "completed");
      }
      this.emitSessionRunEnded(sessionID);
      return;
    }

    if (sessionID !== this.currentSessionId) {
      return;
    }

    logger.info(`[Aggregator] Session became idle: ${sessionID}`);
    this.emitSessionRunEnded(sessionID);
    this.liveTurnStartedAt = null;
    this.turnEndCount++;
    this.acceptsSubagentEvents = false;
    if (interrupted) {
      this.interruptSubagents();
    }
    this.retireForegroundSubagents();

    // Stop typing indicator when session goes idle
    this.stopTypingIndicator();

    if (this.onSessionIdleCallback) {
      const callback = this.onSessionIdleCallback;
      const idleInfo: SessionIdleInfo = { interrupted };
      // Returned, so a drain of held work waits for the run to be closed in the chat.
      this.scheduleOutbound(() => callback(sessionID, idleInfo), true);
    }
  }

  /** A nested subagent has no card to end: it only stops being tracked. */
  private endNestedSubagentSession(sessionId: string): void {
    this.finishedSubagentSessionIds.add(sessionId);
    this.untrackEndedSession(sessionId);
  }

  private handleSessionCompacted(
    event: Event & {
      type: "session.compacted";
    },
  ): void {
    const properties = event.properties;
    const { sessionID } = properties;

    if (sessionID !== this.currentSessionId) {
      return;
    }

    logger.info(`[Aggregator] Session compacted: ${sessionID}`);

    // Reload context from history after compaction
    if (this.onSessionCompactedCallback) {
      const callback = this.onSessionCompactedCallback;
      this.scheduleOutbound(() => {
        const project = getCurrentProject();
        if (project && callback) {
          callback(sessionID, project.worktree);
        }
      }, true);
    }
  }

  private handleSessionError(
    event: Event & {
      type: "session.error";
    },
  ): void {
    const { sessionID, error } = event.properties;

    const message = extractErrorMessage(error) ?? "Unknown session error";
    if (error !== undefined && !isRecord(error)) {
      logger.warn(`[Aggregator] session.error with unexpected error shape`, error);
    }

    const interrupted = isAbortError(error);

    if (sessionID && this.isTrackedChildSession(sessionID)) {
      logger.warn(`[Aggregator] Subagent session error: ${sessionID}: ${message}`);
      if (this.isNestedSubagentSession(sessionID)) {
        this.endNestedSubagentSession(sessionID);
      } else if (interrupted) {
        this.setSubagentTerminalStatus(sessionID, "interrupted");
      } else {
        this.setSubagentTerminalStatus(sessionID, "error", message);
      }
      this.emitSessionRunEnded(sessionID);
      return;
    }

    if (!sessionID || sessionID !== this.currentSessionId) {
      return;
    }

    logger.warn(`[Aggregator] Session error: ${sessionID}: ${message}`);
    this.emitSessionRunEnded(sessionID);
    this.liveTurnStartedAt = null;
    this.turnEndCount++;
    this.acceptsSubagentEvents = false;
    if (interrupted) {
      this.interruptSubagents();
    }
    this.retireForegroundSubagents();
    this.stopTypingIndicator();

    if (this.onSessionErrorCallback) {
      const callback = this.onSessionErrorCallback;
      this.scheduleOutbound(() => {
        callback(sessionID, message, { interrupted });
      }, true);
    }
  }

  private handleQuestionAsked(
    event: Event & {
      type: "question.asked";
    },
  ): void {
    const { id, sessionID, questions } = event.properties;
    const isTrackedChild = this.isTrackedChildSession(sessionID);

    if (sessionID !== this.currentSessionId && !isTrackedChild) {
      logger.debug(
        `[Aggregator] Ignoring question.asked for different session: ${sessionID} (current: ${this.currentSessionId})`,
      );
      return;
    }

    logger.info(
      `[Aggregator] Question asked: requestID=${id}, questions=${questions.length}, subagent=${isTrackedChild}`,
    );

    if (this.onQuestionCallback) {
      const callback = this.onQuestionCallback;
      this.scheduleOutbound(async () => {
        try {
          await callback(questions, id, sessionID);
        } catch (err) {
          logger.error("[Aggregator] Error in question callback:", err);
        }
      }, true);
    }
  }

  private handleQuestionSettled(
    properties: { sessionID: string; requestID: string },
    outcome: QuestionSettledOutcome,
  ): void {
    const { sessionID, requestID } = properties;
    if (sessionID !== this.currentSessionId && !this.isTrackedChildSession(sessionID)) {
      logger.debug(
        `[Aggregator] Ignoring settled question for different session: ${sessionID} (current: ${this.currentSessionId})`,
      );
      return;
    }

    logger.info(`[Aggregator] Question settled: requestID=${requestID}, outcome=${outcome}`);

    if (this.onQuestionSettledCallback) {
      const callback = this.onQuestionSettledCallback;
      this.scheduleOutbound(async () => {
        try {
          await callback(sessionID, requestID, outcome);
        } catch (err) {
          logger.error("[Aggregator] Error in question settled callback:", err);
        }
      }, true);
    }
  }

  private emitSessionRunEnded(sessionID: string): void {
    if (!this.onSessionRunEndedCallback) {
      return;
    }

    const callback = this.onSessionRunEndedCallback;
    this.scheduleOutbound(async () => {
      try {
        await callback(sessionID);
      } catch (err) {
        logger.error("[Aggregator] Error in session run ended callback:", err);
      }
    }, true);
  }

  private handleSessionDiff(
    event: Event & {
      type: "session.diff";
    },
  ): void {
    const properties = event.properties;

    if (properties.sessionID !== this.currentSessionId) {
      return;
    }

    logger.debug(`[Aggregator] Session diff: ${properties.diff.length} files changed`);

    if (this.onSessionDiffCallback) {
      const diffs: FileChange[] = properties.diff.map((d) => ({
        file: d.file ?? "",
        additions: d.additions,
        deletions: d.deletions,
      }));

      const callback = this.onSessionDiffCallback;
      this.deliverOutbound(() => {
        callback(properties.sessionID, diffs);
      }, true);
    }
  }

  private handlePermissionAsked(
    event: Event & {
      type: "permission.asked";
    },
  ): void {
    const request = event.properties;

    const isCurrent = request.sessionID === this.currentSessionId;
    const isTrackedChild = this.isTrackedChildSession(request.sessionID);

    if (!isCurrent && !isTrackedChild) {
      logger.debug(
        `[Aggregator] Ignoring permission.asked for different session: ${request.sessionID} (current: ${this.currentSessionId})`,
      );
      return;
    }

    logger.info(
      `[Aggregator] Permission asked: requestID=${request.id}, type=${request.permission}, patterns=${request.patterns.length}, subagent=${isTrackedChild}`,
    );

    if (this.onPermissionCallback) {
      const callback = this.onPermissionCallback;
      const run = (): Promise<void> => {
        this.permissionQueue = this.permissionQueue.then(() => callback(request)).catch((err) => {
          logger.error("[Aggregator] Error in permission callback:", err);
        });
        return this.permissionQueue;
      };
      this.scheduleOutbound(run, false);
    }
  }

  private handlePermissionReplied(
    event: Event & {
      type: "permission.replied";
    },
  ): void {
    const { sessionID, requestID } = event.properties;
    // An older server may leave the decision out; the prompt then ends without naming it.
    const reply: PermissionReply | null = event.properties.reply ?? null;
    const isCurrent = sessionID === this.currentSessionId;
    const isTrackedChild = this.isTrackedChildSession(sessionID);

    if (!isCurrent && !isTrackedChild) {
      logger.debug(
        `[Aggregator] Ignoring permission.replied for different session: ${sessionID} (current: ${this.currentSessionId})`,
      );
      return;
    }

    logger.info(
      `[Aggregator] Permission replied: requestID=${requestID}, reply=${reply ?? "unknown"}`,
    );

    if (this.onPermissionRepliedCallback) {
      const callback = this.onPermissionRepliedCallback;
      this.scheduleOutbound(async () => {
        try {
          await callback(sessionID, requestID, reply);
        } catch (err) {
          logger.error("[Aggregator] Error in permission replied callback:", err);
        }
      }, true);
    }
  }
}
