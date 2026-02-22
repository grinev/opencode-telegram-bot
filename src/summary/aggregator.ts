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

type SessionCompactedCallback = (sessionId: string, directory: string) => void;

type PermissionCallback = (request: PermissionRequest) => void;

type SessionDiffCallback = (sessionId: string, diffs: FileChange[]) => void;

type FileChangeCallback = (change: FileChange) => void;

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

class SummaryAggregator {
  private currentSessionId: string | null = null;
  private currentMessageParts: Map<string, string[]> = new Map();
  private pendingParts: Map<string, string[]> = new Map();
  private messages: Map<string, { role: string }> = new Map();
  private messageCount = 0;
  private lastUpdated = 0;
  private onCompleteCallback: MessageCompleteCallback | null = null;
  private onToolCallback: ToolCallback | null = null;
  private onToolFileCallback: ToolFileCallback | null = null;
  private onQuestionCallback: QuestionCallback | null = null;
  private onQuestionErrorCallback: QuestionErrorCallback | null = null;
  private onThinkingCallback: ThinkingCallback | null = null;
  private onTokensCallback: TokensCallback | null = null;
  private onSessionCompactedCallback: SessionCompactedCallback | null = null;
  private onPermissionCallback: PermissionCallback | null = null;
  private onSessionDiffCallback: SessionDiffCallback | null = null;
  private onFileChangeCallback: FileChangeCallback | null = null;
  private onClearedCallback: ClearedCallback | null = null;
  private processedToolStates: Set<string> = new Set();
  private bot: Bot | null = null;
  private chatId: number | null = null;
  private typingTimer: ReturnType<typeof setInterval> | null = null;
  private partHashes: Map<string, Set<string>> = new Map();

  setBotAndChatId(bot: Bot, chatId: number): void {
    this.bot = bot;
    this.chatId = chatId;
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

  setOnTokens(callback: TokensCallback): void {
    this.onTokensCallback = callback;
  }

  setOnSessionCompacted(callback: SessionCompactedCallback): void {
    this.onSessionCompactedCallback = callback;
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

  private startTypingIndicator(): void {
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
    this.currentMessageParts.clear();
    this.pendingParts.clear();
    this.messages.clear();
    this.partHashes.clear();
    this.processedToolStates.clear();
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
      if (!this.currentMessageParts.has(messageID)) {
        this.currentMessageParts.set(messageID, []);
        this.messageCount++;
        this.startTypingIndicator();

        // Notify that agent started thinking
        if (this.onThinkingCallback) {
          const callback = this.onThinkingCallback;
          setImmediate(() => {
            if (typeof callback === "function") {
              callback(info.sessionID);
            }
          });
        }
      }

      const pending = this.pendingParts.get(messageID) || [];
      const current = this.currentMessageParts.get(messageID) || [];
      this.currentMessageParts.set(messageID, [...current, ...pending]);
      this.pendingParts.delete(messageID);

      const assistantMessage = info as { time?: { created: number; completed?: number } };
      const time = assistantMessage.time;

      if (time?.completed) {
        const parts = this.currentMessageParts.get(messageID) || [];
        const lastPart = parts[parts.length - 1] || "";

        logger.debug(
          `[Aggregator] Message part completed: messageId=${messageID}, textLength=${lastPart.length}, totalParts=${parts.length}, session=${this.currentSessionId}`,
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
          this.onTokensCallback(tokens);
        }

        if (this.onCompleteCallback && lastPart.length > 0) {
          this.onCompleteCallback(this.currentSessionId!, lastPart);
        }

        this.currentMessageParts.delete(messageID);
        this.messages.delete(messageID);
        this.partHashes.delete(messageID);

        logger.debug(
          `[Aggregator] Message completed cleanup: remaining messages=${this.currentMessageParts.size}`,
        );

        if (this.currentMessageParts.size === 0) {
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

    if (part.type === "text" && "text" in part && part.text) {
      const partHash = this.hashString(part.text);

      if (!this.partHashes.has(messageID)) {
        this.partHashes.set(messageID, new Set());
      }

      const hashes = this.partHashes.get(messageID)!;

      if (hashes.has(partHash)) {
        return;
      }

      hashes.add(partHash);

      if (messageInfo && messageInfo.role === "assistant") {
        if (!this.currentMessageParts.has(messageID)) {
          this.currentMessageParts.set(messageID, []);
          this.startTypingIndicator();
        }

        const parts = this.currentMessageParts.get(messageID)!;
        parts.push(part.text);
      } else {
        if (!this.pendingParts.has(messageID)) {
          this.pendingParts.set(messageID, []);
        }

        const pending = this.pendingParts.get(messageID)!;
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
            this.onFileChangeCallback(preparedFileContext.fileChange);
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
    const { sessionID } = event.properties;

    if (sessionID !== this.currentSessionId) {
      return;
    }
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
