import { Event, ToolState } from "@opencode-ai/sdk/v2";
import type { CodeFileData } from "./formatter.js";
import { normalizePathForDisplay, prepareCodeFile } from "./formatter.js";
import type { Question } from "../question/types.js";
import type { PermissionRequest } from "../permission/types.js";
import type { FileChange } from "../pinned/types.js";
import { logger } from "../utils/logger.js";
import { getSessionById } from "../session/manager.js";

export interface SummaryInfo {
  sessionId: string;
  text: string;
  messageCount: number;
  lastUpdated: number;
}

type MessageCompleteCallback = (sessionId: string, messageText: string) => void;

export interface ToolInfo {
  sessionId: string;
  messageId: string;
  callId: string;
  tool: string;
  state: ToolState;
  input?: { [key: string]: unknown };
  title?: string;
  metadata?: { [key: string]: unknown };
  hasFileAttachment?: boolean;
}

export interface ToolFileInfo extends ToolInfo {
  hasFileAttachment: true;
  fileData: CodeFileData;
}

type ToolCallback = (toolInfo: ToolInfo) => void;

type ToolFileCallback = (fileInfo: ToolFileInfo) => void;

type QuestionCallback = (sessionId: string, questions: Question[], requestID: string) => void;

type QuestionErrorCallback = () => void;

type ThinkingCallback = (sessionId: string) => void;

type TypingIndicatorCallback = (sessionId: string) => void;

export interface TokensInfo {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
}

type TokensCallback = (sessionId: string, tokens: TokensInfo) => void;

type SessionCompactedCallback = (sessionId: string, directory: string) => void;

type SessionErrorCallback = (sessionId: string, message: string) => void;

export interface SessionRetryInfo {
  sessionId: string;
  attempt?: number;
  message: string;
  next?: number;
}

type SessionRetryCallback = (retryInfo: SessionRetryInfo) => void;

type PermissionCallback = (request: PermissionRequest) => void;

type SessionDiffCallback = (sessionId: string, diffs: FileChange[]) => void;

type FileChangeCallback = (change: FileChange, sessionId: string) => void;

type ClearedCallback = () => void;

interface PreparedToolFileContext {
  fileData: CodeFileData | null;
  fileChange: FileChange | null;
}

function extractFirstUpdatedFileFromTitle(title: string): string {
  for (const rawLine of title.split("\n")) {
    const line = rawLine.trim();
    if (line.length >= 3 && line[1] === " " && /[AMDURC]/.test(line[0])) {
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

function extractEventSessionId(event: Event): string | null {
  const eventWithProperties = event as Event & {
    properties?: {
      info?: { sessionID?: unknown };
      part?: { sessionID?: unknown };
      request?: { sessionID?: unknown };
      session?: { id?: unknown };
    };
  };

  if (typeof eventWithProperties.properties?.info?.sessionID === "string") {
    return eventWithProperties.properties.info.sessionID;
  }

  if (typeof eventWithProperties.properties?.part?.sessionID === "string") {
    return eventWithProperties.properties.part.sessionID;
  }

  if (typeof eventWithProperties.properties?.request?.sessionID === "string") {
    return eventWithProperties.properties.request.sessionID;
  }

  if (typeof eventWithProperties.properties?.session?.id === "string") {
    return eventWithProperties.properties.session.id;
  }

  return null;
}

class SummaryAggregator {
  private trackedSessionIds: Set<string> = new Set();
  private currentMessageParts: Map<string, string[]> = new Map();
  private pendingParts: Map<string, string[]> = new Map();
  private messages: Map<string, { role: string; sessionId: string }> = new Map();
  private messageCount = 0;
  private lastUpdated = 0;
  private onCompleteCallback: MessageCompleteCallback | null = null;
  private onToolCallback: ToolCallback | null = null;
  private onToolFileCallback: ToolFileCallback | null = null;
  private onQuestionCallback: QuestionCallback | null = null;
  private onQuestionErrorCallback: QuestionErrorCallback | null = null;
  private onThinkingCallback: ThinkingCallback | null = null;
  private onTypingIndicatorCallback: TypingIndicatorCallback | null = null;
  private onTokensCallback: TokensCallback | null = null;
  private onSessionCompactedCallback: SessionCompactedCallback | null = null;
  private onSessionErrorCallback: SessionErrorCallback | null = null;
  private onSessionRetryCallback: SessionRetryCallback | null = null;
  private onPermissionCallback: PermissionCallback | null = null;
  private onSessionDiffCallback: SessionDiffCallback | null = null;
  private onFileChangeCallback: FileChangeCallback | null = null;
  private onClearedCallback: ClearedCallback | null = null;
  private processedToolStates: Set<string> = new Set();
  private thinkingFiredForMessages: Set<string> = new Set();
  private typingTimer: ReturnType<typeof setInterval> | null = null;
  private activeTypingSessions: Set<string> = new Set();
  private partHashes: Map<string, Set<string>> = new Map();

  private getMessageKey(sessionId: string, messageId: string): string {
    return `${sessionId}:${messageId}`;
  }

  private isTrackedSession(sessionId: string): boolean {
    return this.trackedSessionIds.has(sessionId);
  }

  setOnComplete(callback: MessageCompleteCallback): void {
    this.onCompleteCallback = callback;
  }

  setOnTool(callback: ToolCallback): void {
    this.onToolCallback = callback;
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

  setOnThinking(callback: ThinkingCallback): void {
    this.onThinkingCallback = callback;
  }

  setOnTypingIndicator(callback: TypingIndicatorCallback): void {
    this.onTypingIndicatorCallback = callback;
  }

  setOnTokens(callback: TokensCallback): void {
    this.onTokensCallback = callback;
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

  setOnPermission(callback: PermissionCallback): void {
    this.onPermissionCallback = callback;
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

  private hasActiveMessageForSession(sessionId: string): boolean {
    for (const value of this.messages.values()) {
      if (value.sessionId === sessionId && value.role === "assistant") {
        return true;
      }
    }

    return false;
  }

  private emitTypingIndicators(): void {
    const callback = this.onTypingIndicatorCallback;
    if (!callback) {
      return;
    }

    for (const sessionId of this.activeTypingSessions) {
      try {
        callback(sessionId);
      } catch (error) {
        logger.error("[Aggregator] Typing callback failed", { sessionId }, error);
      }
    }
  }

  private startTypingIndicator(sessionId: string): void {
    this.activeTypingSessions.add(sessionId);

    if (this.typingTimer) {
      return;
    }

    this.emitTypingIndicators();
    this.typingTimer = setInterval(() => {
      this.emitTypingIndicators();
    }, 4000);
  }

  stopTypingIndicator(sessionId?: string): void {
    if (sessionId) {
      this.activeTypingSessions.delete(sessionId);
    } else {
      this.activeTypingSessions.clear();
    }

    if (!this.typingTimer || this.activeTypingSessions.size > 0) {
      return;
    }

    clearInterval(this.typingTimer);
    this.typingTimer = null;
  }

  processEvent(event: Event): void {
    try {
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
          logger.info(`[Aggregator] Question replied: requestID=${event.properties.requestID}`);
          break;
        case "question.rejected":
          logger.info(`[Aggregator] Question rejected: requestID=${event.properties.requestID}`);
          break;
        case "session.diff":
          this.handleSessionDiff(event);
          break;
        case "permission.asked":
          this.handlePermissionAsked(event);
          break;
        case "permission.replied":
          logger.info(`[Aggregator] Permission replied: requestID=${event.properties.requestID}`);
          break;
        default:
          logger.debug(`[Aggregator] Unhandled event type: ${event.type}`);
          break;
      }
    } catch (error) {
      logger.error(
        "[Aggregator] Failed to process event",
        {
          eventType: event.type,
          sessionId: extractEventSessionId(event),
        },
        error,
      );
    }
  }

  setSession(sessionId: string): void {
    this.trackedSessionIds.add(sessionId);
  }

  clearSession(sessionId: string): void {
    this.trackedSessionIds.delete(sessionId);
    this.stopTypingIndicator(sessionId);

    for (const [messageKey, message] of this.messages.entries()) {
      if (message.sessionId !== sessionId) {
        continue;
      }

      this.messages.delete(messageKey);
      this.currentMessageParts.delete(messageKey);
      this.pendingParts.delete(messageKey);
      this.partHashes.delete(messageKey);
      this.thinkingFiredForMessages.delete(messageKey);
    }
  }

  clear(): void {
    this.stopTypingIndicator();
    this.trackedSessionIds.clear();
    this.currentMessageParts.clear();
    this.pendingParts.clear();
    this.messages.clear();
    this.partHashes.clear();
    this.processedToolStates.clear();
    this.thinkingFiredForMessages.clear();
    this.messageCount = 0;
    this.lastUpdated = 0;

    if (this.onClearedCallback) {
      try {
        this.onClearedCallback();
      } catch (err) {
        logger.error("[Aggregator] Error in clear callback:", err);
      }
    }
  }

  private handleMessageUpdated(
    event: Event & {
      type: "message.updated";
    },
  ): void {
    const { info } = event.properties;

    if (!this.isTrackedSession(info.sessionID)) {
      return;
    }

    const messageID = info.id;
    const messageKey = this.getMessageKey(info.sessionID, messageID);

    this.messages.set(messageKey, { role: info.role, sessionId: info.sessionID });

    if (info.role === "assistant") {
      if (!this.currentMessageParts.has(messageKey)) {
        this.currentMessageParts.set(messageKey, []);
        this.messageCount++;
        this.startTypingIndicator(info.sessionID);
      }

      const pending = this.pendingParts.get(messageKey) || [];
      const current = this.currentMessageParts.get(messageKey) || [];
      this.currentMessageParts.set(messageKey, [...current, ...pending]);
      this.pendingParts.delete(messageKey);

      const assistantMessage = info as { time?: { created: number; completed?: number } };
      const time = assistantMessage.time;

      if (time?.completed) {
        const parts = this.currentMessageParts.get(messageKey) || [];
        const lastPart = parts[parts.length - 1] || "";

        logger.debug(
          `[Aggregator] Message part completed: messageId=${messageID}, textLength=${lastPart.length}, totalParts=${parts.length}, session=${info.sessionID}`,
        );

        // Extract and report tokens BEFORE onComplete so keyboard context is updated
        const assistantInfo = info as {
          tokens?: {
            input: number;
            output: number;
            reasoning: number;
            cache: { read: number; write: number };
          };
        };

        if (this.onTokensCallback && assistantInfo.tokens) {
          const tokens: TokensInfo = {
            input: assistantInfo.tokens.input,
            output: assistantInfo.tokens.output,
            reasoning: assistantInfo.tokens.reasoning,
            cacheRead: assistantInfo.tokens.cache?.read || 0,
            cacheWrite: assistantInfo.tokens.cache?.write || 0,
          };
          logger.debug(
            `[Aggregator] Tokens: input=${tokens.input}, output=${tokens.output}, reasoning=${tokens.reasoning}`,
          );
          // Call synchronously so keyboardManager is updated before onComplete sends the reply
          this.onTokensCallback(info.sessionID, tokens);
        }

        if (this.onCompleteCallback && lastPart.length > 0) {
          this.onCompleteCallback(info.sessionID, lastPart);
        }

        this.currentMessageParts.delete(messageKey);
        this.messages.delete(messageKey);
        this.partHashes.delete(messageKey);

        logger.debug(
          `[Aggregator] Message completed cleanup: remaining messages=${this.currentMessageParts.size}`,
        );

        if (!this.hasActiveMessageForSession(info.sessionID)) {
          logger.debug(
            `[Aggregator] No more active messages for session ${info.sessionID}, stopping typing indicator`,
          );
          this.stopTypingIndicator(info.sessionID);
        }
      }

      this.lastUpdated = Date.now();
    }
  }

  private handleMessagePartUpdated(
    event: Event & {
      type: "message.part.updated";
    },
  ): void {
    const { part } = event.properties;

    if (!this.isTrackedSession(part.sessionID)) {
      return;
    }

    const messageID = part.messageID;
    const messageKey = this.getMessageKey(part.sessionID, messageID);
    const messageInfo = this.messages.get(messageKey);

    if (part.type === "reasoning") {
      // Fire the thinking callback once per message on the first reasoning part.
      // This is the signal that the model is actually doing extended thinking.
      if (!this.thinkingFiredForMessages.has(messageKey) && this.onThinkingCallback) {
        this.thinkingFiredForMessages.add(messageKey);
        const callback = this.onThinkingCallback;
        const sessionID = part.sessionID;
        setImmediate(() => {
          if (typeof callback === "function") {
            callback(sessionID);
          }
        });
      }
    } else if (part.type === "text" && "text" in part && part.text) {
      const partHash = this.hashString(part.text);

      if (!this.partHashes.has(messageKey)) {
        this.partHashes.set(messageKey, new Set());
      }

      const hashes = this.partHashes.get(messageKey)!;

      if (hashes.has(partHash)) {
        return;
      }

      hashes.add(partHash);

      if (messageInfo && messageInfo.role === "assistant") {
        if (!this.currentMessageParts.has(messageKey)) {
          this.currentMessageParts.set(messageKey, []);
          this.startTypingIndicator(part.sessionID);
        }

        const parts = this.currentMessageParts.get(messageKey)!;
        parts.push(part.text);
      } else {
        if (!this.pendingParts.has(messageKey)) {
          this.pendingParts.set(messageKey, []);
        }

        const pending = this.pendingParts.get(messageKey)!;
        pending.push(part.text);
      }
    } else if (part.type === "tool") {
      const state = part.state;
      const input = "input" in state ? (state.input as { [key: string]: unknown }) : undefined;
      const title = "title" in state ? state.title : undefined;

      logger.debug(
        `[Aggregator] Tool event: callID=${part.callID}, tool=${part.tool}, status=${"status" in state ? state.status : "unknown"}`,
      );

      if (part.tool === "question") {
        logger.debug(`[Aggregator] Question tool part update:`, JSON.stringify(part, null, 2));

        // If the question tool fails, clear the active poll
        // so the agent can recreate it with corrected data
        if ("status" in state && state.status === "error") {
          logger.info(
            `[Aggregator] Question tool failed with error, clearing active poll. callID=${part.callID}`,
          );
          if (this.onQuestionErrorCallback) {
            setImmediate(() => {
              this.onQuestionErrorCallback!();
            });
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

          const preparedFileContext = this.prepareToolFileContext(
            part.tool,
            input,
            title,
            state.metadata as { [key: string]: unknown } | undefined,
          );

          const toolData: ToolInfo = {
            sessionId: part.sessionID,
            messageId: messageID,
            callId: part.callID,
            tool: part.tool,
            state: part.state,
            input,
            title,
            metadata: state.metadata as { [key: string]: unknown },
            hasFileAttachment: !!preparedFileContext.fileData,
          };

          logger.debug(
            `[Aggregator] Sending tool notification to Telegram: tool=${part.tool}, title=${title || "N/A"}`,
          );

          if (this.onToolCallback) {
            this.onToolCallback(toolData);
          }

          if (preparedFileContext.fileData && this.onToolFileCallback) {
            logger.debug(
              `[Aggregator] Sending ${part.tool} file: ${preparedFileContext.fileData.filename} (${preparedFileContext.fileData.buffer.length} bytes)`,
            );
            this.onToolFileCallback({
              ...toolData,
              hasFileAttachment: true,
              fileData: preparedFileContext.fileData,
            });
          }

          if (preparedFileContext.fileChange && this.onFileChangeCallback) {
            this.onFileChangeCallback(preparedFileContext.fileChange, toolData.sessionId);
          }
        }
      }
    }

    this.lastUpdated = Date.now();
  }

  private prepareToolFileContext(
    tool: string,
    input: { [key: string]: unknown } | undefined,
    title: string | undefined,
    metadata: { [key: string]: unknown } | undefined,
  ): PreparedToolFileContext {
    if (tool === "write" && input) {
      const filePath =
        typeof input.filePath === "string" ? normalizePathForDisplay(input.filePath) : "";
      const hasContent = typeof input.content === "string";
      const content = hasContent ? (input.content as string) : "";

      if (!filePath || !hasContent) {
        return { fileData: null, fileChange: null };
      }

      return {
        fileData: prepareCodeFile(content, filePath, "write"),
        fileChange: {
          file: filePath,
          additions: content.split("\n").length,
          deletions: 0,
        },
      };
    }

    if (tool === "edit" && metadata) {
      const editMetadata = metadata as {
        diff?: unknown;
        filediff?: { file?: string; additions?: number; deletions?: number };
      };
      const filePath = editMetadata.filediff?.file
        ? normalizePathForDisplay(editMetadata.filediff.file)
        : "";
      const diffText = typeof editMetadata.diff === "string" ? editMetadata.diff : "";

      if (!filePath || !diffText) {
        return { fileData: null, fileChange: null };
      }

      return {
        fileData: prepareCodeFile(diffText, filePath, "edit"),
        fileChange: {
          file: filePath,
          additions: editMetadata.filediff?.additions || 0,
          deletions: editMetadata.filediff?.deletions || 0,
        },
      };
    }

    if (tool === "apply_patch") {
      const patchMetadata = metadata as
        | {
            filediff?: { file?: string; additions?: number; deletions?: number };
            diff?: string;
          }
        | undefined;

      const filePathFromInput =
        input && typeof input.filePath === "string"
          ? normalizePathForDisplay(input.filePath)
          : input && typeof input.path === "string"
            ? normalizePathForDisplay(input.path)
            : "";
      const filePathFromTitle = title ? extractFirstUpdatedFileFromTitle(title) : "";

      const filePath =
        (patchMetadata?.filediff?.file && normalizePathForDisplay(patchMetadata.filediff.file)) ||
        filePathFromInput ||
        normalizePathForDisplay(filePathFromTitle);
      const diffText =
        typeof patchMetadata?.diff === "string"
          ? patchMetadata.diff
          : input && typeof input.patchText === "string"
            ? input.patchText
            : "";

      if (!filePath) {
        return { fileData: null, fileChange: null };
      }

      const fileChange = patchMetadata?.filediff
        ? {
            file: filePath,
            additions: patchMetadata.filediff.additions || 0,
            deletions: patchMetadata.filediff.deletions || 0,
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

      return {
        fileData: diffText ? prepareCodeFile(diffText, filePath, "edit") : null,
        fileChange,
      };
    }

    return { fileData: null, fileChange: null };
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
    const { sessionID, status } = event.properties as {
      sessionID: string;
      status?: {
        type?: string;
        attempt?: number;
        message?: string;
        next?: number;
      };
    };

    if (!this.isTrackedSession(sessionID)) {
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

    setImmediate(() => {
      callback({
        sessionId: sessionID,
        attempt: status.attempt,
        message,
        next: status.next,
      });
    });
  }

  private handleSessionIdle(
    event: Event & {
      type: "session.idle";
    },
  ): void {
    const { sessionID } = event.properties;

    if (!this.isTrackedSession(sessionID)) {
      return;
    }

    logger.info(`[Aggregator] Session became idle: ${sessionID}`);

    // Stop typing indicator when session goes idle
    this.stopTypingIndicator();
  }

  private handleSessionCompacted(
    event: Event & {
      type: "session.compacted";
    },
  ): void {
    const properties = event.properties as { sessionID: string };
    const { sessionID } = properties;

    if (!this.isTrackedSession(sessionID)) {
      return;
    }

    logger.info(`[Aggregator] Session compacted: ${sessionID}`);

    // Reload context from history after compaction
    if (this.onSessionCompactedCallback) {
      setImmediate(() => {
        const session = getSessionById(sessionID);
        if (session?.directory) {
          this.onSessionCompactedCallback!(sessionID, session.directory);
        }
      });
    }
  }

  private handleSessionError(
    event: Event & {
      type: "session.error";
    },
  ): void {
    const { sessionID, error } = event.properties as {
      sessionID: string;
      error?: {
        name?: string;
        message?: string;
        data?: { message?: string };
      };
    };

    if (!this.isTrackedSession(sessionID)) {
      return;
    }

    const message =
      error?.data?.message || error?.message || error?.name || "Unknown session error";

    logger.warn(`[Aggregator] Session error: ${sessionID}: ${message}`);
    this.stopTypingIndicator();

    if (this.onSessionErrorCallback) {
      const callback = this.onSessionErrorCallback;
      setImmediate(() => {
        callback(sessionID, message);
      });
    }
  }

  private handleQuestionAsked(
    event: Event & {
      type: "question.asked";
    },
  ): void {
    const { id, sessionID, questions } = event.properties;

    if (!this.isTrackedSession(sessionID)) {
      logger.debug(`[Aggregator] Ignoring question.asked for untracked session: ${sessionID}`);
      return;
    }

    logger.info(`[Aggregator] Question asked: requestID=${id}, questions=${questions.length}`);

    if (this.onQuestionCallback) {
      const callback = this.onQuestionCallback;
      setImmediate(async () => {
        try {
          await callback(sessionID, questions as Question[], id);
        } catch (err) {
          logger.error("[Aggregator] Error in question callback:", err);
        }
      });
    }
  }

  private handleSessionDiff(event: Event): void {
    const properties = event.properties as {
      sessionID: string;
      diff: Array<{ file: string; additions: number; deletions: number }>;
    };

    if (!this.isTrackedSession(properties.sessionID)) {
      return;
    }

    logger.debug(`[Aggregator] Session diff: ${properties.diff.length} files changed`);

    if (this.onSessionDiffCallback) {
      const diffs: FileChange[] = properties.diff.map((d) => ({
        file: d.file,
        additions: d.additions,
        deletions: d.deletions,
      }));

      const callback = this.onSessionDiffCallback;
      setImmediate(() => {
        callback(properties.sessionID, diffs);
      });
    }
  }

  private handlePermissionAsked(
    event: Event & {
      type: "permission.asked";
    },
  ): void {
    const request = event.properties;

    if (!this.isTrackedSession(request.sessionID)) {
      logger.debug(
        `[Aggregator] Ignoring permission.asked for untracked session: ${request.sessionID}`,
      );
      return;
    }

    logger.info(
      `[Aggregator] Permission asked: requestID=${request.id}, type=${request.permission}, patterns=${request.patterns.length}`,
    );

    if (this.onPermissionCallback) {
      const callback = this.onPermissionCallback;
      setImmediate(async () => {
        try {
          await callback(request as PermissionRequest);
        } catch (err) {
          logger.error("[Aggregator] Error in permission callback:", err);
        }
      });
    }
  }
}

export const summaryAggregator = new SummaryAggregator();
