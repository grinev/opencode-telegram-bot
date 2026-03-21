import { Event, ToolState } from "@opencode-ai/sdk/v2";
import type { Bot } from "grammy";
import type { CodeFileData } from "./formatter.js";
import { normalizePathForDisplay, prepareCodeFile } from "./formatter.js";
import type { Question } from "../question/types.js";
import type { PermissionRequest } from "../permission/types.js";
import type { FileChange } from "../pinned/types.js";
import { logger } from "../utils/logger.js";
import { getCurrentProject } from "../settings/manager.js";

export interface SummaryInfo {
  sessionId: string;
  text: string;
  messageCount: number;
  lastUpdated: number;
}

type MessageCompleteCallback = (sessionId: string, messageId: string, messageText: string) => void;

type MessagePartialCallback = (sessionId: string, messageId: string, messageText: string) => void;

interface MessagePartDeltaEventRaw {
  type: "message.part.delta";
  properties: {
    part?: {
      id?: string;
      sessionID?: string;
      messageID?: string;
      type?: string;
      text?: string;
    };
    sessionID?: string;
    messageID?: string;
    partID?: string;
    type?: string;
    delta?: string;
  };
}

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

type QuestionCallback = (questions: Question[], requestID: string) => void;

type QuestionErrorCallback = () => void;

type ThinkingCallback = (sessionId: string) => void;

export interface TokensInfo {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
}

type TokensCallback = (tokens: TokensInfo) => void;

type CostCallback = (cost: number) => void;

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

type FileChangeCallback = (change: FileChange) => void;

type ClearedCallback = () => void;

interface PreparedToolFileContext {
  fileData: CodeFileData | null;
  fileChange: FileChange | null;
}

interface TextMessageState {
  orderedPartIds: string[];
  partTexts: Map<string, string>;
  optimisticUpdateCount: number;
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

class SummaryAggregator {
  private currentSessionId: string | null = null;
  private textMessageStates: Map<string, TextMessageState> = new Map();
  private messages: Map<string, { role: string }> = new Map();
  private messageCount = 0;
  private lastUpdated = 0;
  private onCompleteCallback: MessageCompleteCallback | null = null;
  private onPartialCallback: MessagePartialCallback | null = null;
  private onToolCallback: ToolCallback | null = null;
  private onToolFileCallback: ToolFileCallback | null = null;
  private onQuestionCallback: QuestionCallback | null = null;
  private onQuestionErrorCallback: QuestionErrorCallback | null = null;
  private onThinkingCallback: ThinkingCallback | null = null;
  private onTokensCallback: TokensCallback | null = null;
  private onCostCallback: CostCallback | null = null;
  private onSessionCompactedCallback: SessionCompactedCallback | null = null;
  private onSessionErrorCallback: SessionErrorCallback | null = null;
  private onSessionRetryCallback: SessionRetryCallback | null = null;
  private onPermissionCallback: PermissionCallback | null = null;
  private onSessionDiffCallback: SessionDiffCallback | null = null;
  private onFileChangeCallback: FileChangeCallback | null = null;
  private onClearedCallback: ClearedCallback | null = null;
  private processedToolStates: Set<string> = new Set();
  private thinkingFiredForMessages: Set<string> = new Set();
  private knownTextPartIds: Map<string, Set<string>> = new Map();
  private bot: Bot | null = null;
  private chatId: number | null = null;
  private typingTimer: ReturnType<typeof setInterval> | null = null;
  private typingIndicatorEnabled = true;
  private partHashes: Map<string, Set<string>> = new Map();

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

  setOnTokens(callback: TokensCallback): void {
    this.onTokensCallback = callback;
  }

  setOnCost(callback: CostCallback): void {
    this.onCostCallback = callback;
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
    const eventType = (event as unknown as { type: string }).type;

    if (eventType === "message.part.delta") {
      this.handleMessagePartDelta(event as unknown as MessagePartDeltaEventRaw);
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
  }

  setSession(sessionId: string): void {
    if (this.currentSessionId !== sessionId) {
      this.clear();
      this.currentSessionId = sessionId;
    }
  }

  clear(): void {
    this.stopTypingIndicator();
    this.currentSessionId = null;
    this.textMessageStates.clear();
    this.messages.clear();
    this.partHashes.clear();
    this.knownTextPartIds.clear();
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

    if (info.sessionID !== this.currentSessionId) {
      return;
    }

    const messageID = info.id;

    this.messages.set(messageID, { role: info.role });

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

      const assistantMessage = info as { time?: { created: number; completed?: number } };
      const time = assistantMessage.time;
      const isCompleted = Boolean(time?.completed);
      const messageText = this.getCombinedMessageText(messageID);

      if (!isCompleted && textState.optimisticUpdateCount === 1) {
        this.emitPartialText(info.sessionID, messageID, messageText);
      }

      if (isCompleted) {
        const finalText = messageText;

        logger.debug(
          `[Aggregator] Message part completed: messageId=${messageID}, textLength=${finalText.length}, totalParts=${textState.orderedPartIds.length}, session=${this.currentSessionId}`,
        );

        // Extract and report tokens BEFORE onComplete so keyboard context is updated
        const assistantInfo = info as {
          tokens?: {
            input: number;
            output: number;
            reasoning: number;
            cache: { read: number; write: number };
          };
          cost?: number;
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
          this.onTokensCallback(tokens);
        }

        // Extract and report cost
        if (this.onCostCallback && assistantInfo.cost !== undefined) {
          logger.debug(`[Aggregator] Cost: $${assistantInfo.cost.toFixed(2)}`);
          this.onCostCallback(assistantInfo.cost);
        }

        if (this.onCompleteCallback && finalText.length > 0) {
          this.onCompleteCallback(this.currentSessionId!, messageID, finalText);
        }

        this.textMessageStates.delete(messageID);
        this.messages.delete(messageID);
        this.partHashes.delete(messageID);
        this.knownTextPartIds.delete(messageID);

        logger.debug(
          `[Aggregator] Message completed cleanup: remaining messages=${this.textMessageStates.size}`,
        );

        if (this.textMessageStates.size === 0) {
          logger.debug("[Aggregator] No more active messages, stopping typing indicator");
          this.stopTypingIndicator();
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

    if (part.sessionID !== this.currentSessionId) {
      return;
    }

    const messageID = part.messageID;
    const messageInfo = this.messages.get(messageID);

    if (part.type === "text") {
      this.registerKnownTextPart(messageID, part.id);
      this.registerTextPart(messageID, part.id);
    }

    const deltaFromUpdated = (event.properties as { delta?: unknown }).delta;
    if (
      part.type === "text" &&
      typeof deltaFromUpdated === "string" &&
      deltaFromUpdated.length > 0
    ) {
      this.applyTextDelta(part.sessionID, messageID, part.id, deltaFromUpdated, part.text);
      this.lastUpdated = Date.now();
      return;
    }

    if (part.type === "reasoning") {
      // Fire the thinking callback once per message on the first reasoning part.
      // This is the signal that the model is actually doing extended thinking.
      if (!this.thinkingFiredForMessages.has(messageID) && this.onThinkingCallback) {
        this.thinkingFiredForMessages.add(messageID);
        const callback = this.onThinkingCallback;
        const sessionID = part.sessionID;
        setImmediate(() => {
          if (typeof callback === "function") {
            callback(sessionID);
          }
        });
      }
    } else if (part.type === "text" && "text" in part && part.text) {
      const wasUpdated =
        messageInfo && messageInfo.role === "assistant"
          ? this.setTextPartSnapshot(messageID, part.id, part.text)
          : this.setOptimisticTextSnapshot(messageID, part.id, part.text);
      if (!wasUpdated) {
        return;
      }

      const fullText = this.getCombinedMessageText(messageID);

      if (messageInfo && messageInfo.role === "assistant") {
        this.startTypingIndicator();
        this.emitPartialText(part.sessionID, messageID, fullText);
      } else {
        const state = this.getOrCreateTextMessageState(messageID);
        state.optimisticUpdateCount++;

        if (state.optimisticUpdateCount >= 2) {
          this.emitPartialText(part.sessionID, messageID, fullText);
        }
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
            this.onFileChangeCallback(preparedFileContext.fileChange);
          }
        }
      }
    }

    this.lastUpdated = Date.now();
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

    this.startTypingIndicator();
    this.emitPartialText(sessionID, messageID, combined);
  }

  private emitPartialText(sessionId: string, messageId: string, messageText: string): void {
    if (!this.onPartialCallback || !messageText.trim()) {
      return;
    }

    try {
      this.onPartialCallback(sessionId, messageId, messageText);
    } catch (err) {
      logger.error("[Aggregator] Error in partial callback:", err);
    }
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

  private getCombinedMessageText(messageID: string): string {
    const state = this.textMessageStates.get(messageID);
    if (!state) {
      return "";
    }

    return state.orderedPartIds.map((partID) => state.partTexts.get(partID) || "").join("");
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

    if (sessionID !== this.currentSessionId) {
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

    if (sessionID !== this.currentSessionId) {
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

    if (sessionID !== this.currentSessionId) {
      return;
    }

    logger.info(`[Aggregator] Session compacted: ${sessionID}`);

    // Reload context from history after compaction
    if (this.onSessionCompactedCallback) {
      setImmediate(() => {
        const project = getCurrentProject();
        if (project) {
          this.onSessionCompactedCallback!(sessionID, project.worktree);
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

    if (sessionID !== this.currentSessionId) {
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

    if (sessionID !== this.currentSessionId) {
      logger.debug(
        `[Aggregator] Ignoring question.asked for different session: ${sessionID} (current: ${this.currentSessionId})`,
      );
      return;
    }

    logger.info(`[Aggregator] Question asked: requestID=${id}, questions=${questions.length}`);

    if (this.onQuestionCallback) {
      const callback = this.onQuestionCallback;
      setImmediate(async () => {
        try {
          await callback(questions as Question[], id);
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

    if (properties.sessionID !== this.currentSessionId) {
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

    if (request.sessionID !== this.currentSessionId) {
      logger.debug(
        `[Aggregator] Ignoring permission.asked for different session: ${request.sessionID} (current: ${this.currentSessionId})`,
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
