import { promises as fs } from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { Bot, Context, InputFile } from "grammy";
import { config } from "../../config.js";
import { t } from "../../i18n/index.js";
import { summaryAggregator, type ToolInfo } from "../../app/managers/summary-aggregation-manager.js";
import { formatCompactToolActivity, formatToolInfo } from "../../app/formatters/summary-formatter.js";
import { renderSubagentCards } from "../../app/formatters/subagent-formatter.js";
import { ToolMessageBatcher } from "../../app/formatters/tool-message-batcher.js";
import {
  getCompactOutputMode,
  getResponseStreamingMode,
  getSendDiffFileAttachments,
  getShowAssistantRunFooter,
  getShowThinkingContent,
  type ResponseStreamingMode,
} from "../../app/stores/settings-store.js";
import { getCurrentSession } from "../../app/services/session-service.js";
import { ingestSessionInfoForCache } from "../../app/services/session-cache-service.js";
import { logger } from "../../utils/logger.js";
import { safeBackgroundTask } from "../../utils/safe-background-task.js";
import { pinnedMessageManager } from "../pinned/pinned-message-manager.js";
import { keyboardManager } from "../keyboards/keyboard-manager.js";
import { clearPromptResponseMode } from "../handlers/prompt.js";
import {
  reconcileBusyState,
  setPromptResponseModeClearerForReconciliation,
  setResponseStreamerForReconciliation,
} from "../../app/services/busy-reconciliation-service.js";
import { finalizeAssistantResponse } from "../streaming/finalize-assistant-response.js";
import { sendTtsResponseForSession } from "../handlers/tts-response-handler.js";
import { deliverThinkingMessage } from "../messages/thinking-message.js";
import { shouldSuppressUserAbortSessionError } from "../../app/managers/abort-suppression-manager.js";
import {
  completeDraftPart,
  editRenderedBotPart,
  getTelegramRenderedPartSignature,
  sendBotText,
  sendDraftBotPart,
  sendRenderedBotPart,
} from "../messages/telegram-text.js";
import { formatAssistantRunFooter } from "../../app/formatters/assistant-run-footer-formatter.js";
import { foregroundSessionState } from "../../app/managers/foreground-session-state-manager.js";
import { scheduledTaskRuntime } from "../../app/services/scheduled-task-runtime-service.js";
import { assistantRunState } from "../../app/managers/assistant-run-state-manager.js";
import { ResponseStreamer, type StreamingMessagePayload } from "../streaming/response-streamer.js";
import { ToolCallStreamer, type ToolStreamKey } from "../streaming/tool-call-streamer.js";
import { CompactProgressStreamer } from "../streaming/compact-progress-streamer.js";
import { attachManager } from "../../app/managers/attach-manager.js";
import {
  markAttachedSessionBusy,
  markAttachedSessionIdle,
} from "../../app/services/attach-service.js";
import { externalUserInputSuppressionManager } from "../../app/managers/external-input-suppression-manager.js";
import {
  prepareAssistantFinalStreamingPayload,
  prepareAssistantStreamingPayload,
  renderAssistantFinalPartsSafe,
} from "../messages/assistant-rendering.js";
import {
  makeThinkingPayloadExpandable,
  prepareThinkingStreamingPayload,
} from "../messages/thinking-rendering.js";
import { deliverExternalUserInputNotification } from "../messages/external-user-input-notification.js";
import {
  backgroundSessionTracker,
  type BackgroundSessionNotification,
} from "../../app/managers/background-session-manager.js";
import { buildBackgroundSessionOpenKeyboard } from "../menus/session-selection-menu.js";
import { questionManager } from "../../app/managers/question-manager.js";
import { permissionManager } from "../../app/managers/permission-manager.js";
import { showCurrentQuestion } from "../menus/question-menu.js";
import { showPermissionRequest, syncPermissionInteractionState } from "../menus/permission-menu.js";
import {
  clearAllInteractionState,
  interactionManager,
} from "../../app/managers/interaction-manager.js";
import { stopEventListening, subscribeToEvents } from "../../opencode/events.js";

const TELEGRAM_DOCUMENT_CAPTION_MAX_LENGTH = 1024;
const RESPONSE_STREAM_THROTTLE_MS = config.bot.responseStreamThrottleMs;
const RESPONSE_STREAM_TEXT_LIMIT = 3800;
const SESSION_RETRY_PREFIX = "🔁";
const SUBAGENT_STREAM_PREFIX = "🧩";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMP_DIR = path.join(__dirname, "..", "..", ".tmp");

function isCompactProgressMode(): boolean {
  return getCompactOutputMode();
}

type EventStreamItem = {
  type: string;
  properties: Record<string, unknown>;
};

export interface BotEventSubscriptionService {
  ensureEventSubscription(directory: string): Promise<void>;
  setTelegramContext(bot: Bot<Context> | null, chatId: number | null): void;
  clearRuntimeState(reason: string): void;
  cleanup(reason: string): void;
}

export function createEventSubscriptionService(): BotEventSubscriptionService {
  return new EventSubscriptionService();
}

class EventSubscriptionService implements BotEventSubscriptionService {
  private botInstance: Bot<Context> | null = null;
  private chatIdInstance: number | null = null;
  private nextDraftId = 1;
  private readonly thinkingStreamingPayloads = new Map<string, StreamingMessagePayload>();
  private readonly sessionCompletionTasks = new Map<string, Promise<void>>();
  private readonly compactProgressFinalizationTasks = new Map<string, Promise<void>>();
  private readonly assistantEditResponseStreamer: ResponseStreamer;
  private readonly assistantDraftResponseStreamer: ResponseStreamer;
  private readonly thinkingResponseStreamer: ResponseStreamer;
  private readonly assistantResponseStreamModes = new Map<string, ResponseStreamingMode>();
  private readonly toolCallStreamer: ToolCallStreamer;
  private readonly toolMessageBatcher: ToolMessageBatcher;
  private readonly compactProgressStreamer: CompactProgressStreamer;

  constructor() {
    this.toolMessageBatcher = new ToolMessageBatcher({
      sendText: async (sessionId, text) => {
        if (!this.botInstance || !this.chatIdInstance) {
          return;
        }

        const currentSession = getCurrentSession();
        if (!currentSession || currentSession.id !== sessionId) {
          return;
        }

        const keyboard = this.getCurrentReplyKeyboard();

        await this.botInstance.api.sendMessage(this.chatIdInstance, text, {
          disable_notification: true,
          ...(keyboard ? { reply_markup: keyboard } : {}),
        });
      },
      sendFile: async (sessionId, fileData) => {
        if (!this.botInstance || !this.chatIdInstance) {
          return;
        }

        const currentSession = getCurrentSession();
        if (!currentSession || currentSession.id !== sessionId) {
          return;
        }

        const tempFilePath = path.join(TEMP_DIR, fileData.filename);

        try {
          logger.debug(
            `[Bot] Sending code file: ${fileData.filename} (${fileData.buffer.length} bytes, session=${sessionId})`,
          );

          await fs.mkdir(TEMP_DIR, { recursive: true });
          await fs.writeFile(tempFilePath, fileData.buffer);

          const keyboard = this.getCurrentReplyKeyboard();

          await this.botInstance.api.sendDocument(
            this.chatIdInstance,
            new InputFile(tempFilePath),
            {
              caption: fileData.caption,
              disable_notification: true,
              ...(keyboard ? { reply_markup: keyboard } : {}),
            },
          );
        } finally {
          await fs.unlink(tempFilePath).catch(() => {});
        }
      },
    });

    this.assistantEditResponseStreamer = this.createResponseStreamer("edit");
    this.assistantDraftResponseStreamer = this.createResponseStreamer("draft");
    this.thinkingResponseStreamer = this.createResponseStreamer("edit");
    setResponseStreamerForReconciliation({
      hasActiveStream: (sessionId) => this.hasActiveAssistantResponseStream(sessionId),
    });
    setPromptResponseModeClearerForReconciliation(clearPromptResponseMode);

    this.compactProgressStreamer = new CompactProgressStreamer({
      throttleMs: RESPONSE_STREAM_THROTTLE_MS,
      sendText: async (sessionId, text) => {
        if (!this.botInstance || !this.chatIdInstance || this.chatIdInstance <= 0) {
          throw new Error("Bot context missing for compact progress send");
        }

        const currentSession = getCurrentSession();
        if (!currentSession || currentSession.id !== sessionId) {
          throw new Error(`Compact progress session mismatch for send: ${sessionId}`);
        }

        const sentMessage = await this.botInstance.api.sendMessage(this.chatIdInstance, text, {
          disable_notification: true,
        });

        return sentMessage.message_id;
      },
      editText: async (sessionId, messageId, text) => {
        if (!this.botInstance || !this.chatIdInstance || this.chatIdInstance <= 0) {
          throw new Error("Bot context missing for compact progress edit");
        }

        const currentSession = getCurrentSession();
        if (!currentSession || currentSession.id !== sessionId) {
          throw new Error(`Compact progress session mismatch for edit: ${sessionId}`);
        }

        try {
          await this.botInstance.api.editMessageText(this.chatIdInstance, messageId, text);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
          if (errorMessage.includes("message is not modified")) {
            return;
          }

          throw error;
        }
      },
    });

    this.toolCallStreamer = new ToolCallStreamer({
      throttleMs: RESPONSE_STREAM_THROTTLE_MS,
      sendText: async (sessionId, text) => {
        if (!this.botInstance || !this.chatIdInstance || this.chatIdInstance <= 0) {
          throw new Error("Bot context missing for tool stream send");
        }

        const currentSession = getCurrentSession();
        if (!currentSession || currentSession.id !== sessionId) {
          throw new Error(`Tool stream session mismatch for send: ${sessionId}`);
        }

        const sentMessage = await this.botInstance.api.sendMessage(this.chatIdInstance, text, {
          disable_notification: true,
        });

        return sentMessage.message_id;
      },
      editText: async (sessionId, messageId, text) => {
        if (!this.botInstance || !this.chatIdInstance || this.chatIdInstance <= 0) {
          throw new Error("Bot context missing for tool stream edit");
        }

        const currentSession = getCurrentSession();
        if (!currentSession || currentSession.id !== sessionId) {
          throw new Error(`Tool stream session mismatch for edit: ${sessionId}`);
        }

        try {
          await this.botInstance.api.editMessageText(this.chatIdInstance, messageId, text);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
          if (errorMessage.includes("message is not modified")) {
            return;
          }

          throw error;
        }
      },
      deleteText: async (sessionId, messageId) => {
        if (!this.botInstance || !this.chatIdInstance || this.chatIdInstance <= 0) {
          throw new Error("Bot context missing for tool stream delete");
        }

        const currentSession = getCurrentSession();
        if (!currentSession || currentSession.id !== sessionId) {
          throw new Error(`Tool stream session mismatch for delete: ${sessionId}`);
        }

        await this.botInstance.api.deleteMessage(this.chatIdInstance, messageId).catch((error) => {
          const errorMessage =
            error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
          if (
            errorMessage.includes("message to delete not found") ||
            errorMessage.includes("message identifier is not specified")
          ) {
            return;
          }

          throw error;
        });
      },
    });
  }

  setTelegramContext(bot: Bot<Context> | null, chatId: number | null): void {
    this.botInstance = bot;
    this.chatIdInstance = chatId;
  }

  clearRuntimeState(reason: string): void {
    backgroundSessionTracker.clear();
    this.nextDraftId = 1;
    this.clearAllResponseStreams(reason);
    this.toolCallStreamer.clearAll(reason);
    this.toolMessageBatcher.clearAll(reason);
    this.compactProgressStreamer.clearAll(reason);
    this.compactProgressFinalizationTasks.clear();
    this.thinkingStreamingPayloads.clear();
    this.sessionCompletionTasks.clear();
    assistantRunState.clearAll(reason);
  }

  cleanup(reason: string): void {
    stopEventListening();
    summaryAggregator.clear();
    this.clearRuntimeState(reason);
    this.setTelegramContext(null, null);
  }

  ensureEventSubscription = async (directory: string): Promise<void> => {
    if (!directory) {
      logger.error("No directory found for event subscription");
      return;
    }

    summaryAggregator.setTypingIndicatorEnabled(true);
    backgroundSessionTracker.setDirectory(directory);
    backgroundSessionTracker.setOnNotification(this.deliverBackgroundSessionNotification);

    if (!config.bot.trackBackgroundSessions) {
      backgroundSessionTracker.clear();
    }

    summaryAggregator.setOnCleared(() => {
      this.toolMessageBatcher.clearAll("summary_aggregator_clear");
      this.toolCallStreamer.clearAll("summary_aggregator_clear");
      this.clearAllResponseStreams("summary_aggregator_clear");
      this.compactProgressStreamer.clearAll("summary_aggregator_clear");
      this.compactProgressFinalizationTasks.clear();
      this.thinkingStreamingPayloads.clear();
    });

    summaryAggregator.setOnPartial((sessionId, messageId, messageText) => {
      if (!this.botInstance || !this.chatIdInstance) {
        return;
      }

      const currentSession = getCurrentSession();
      if (!currentSession || currentSession.id !== sessionId) {
        return;
      }

      if (isCompactProgressMode()) {
        void this.finalizeCompactProgress(sessionId)
          .then(() => {
            const activeSession = getCurrentSession();
            if (!activeSession || activeSession.id !== sessionId) {
              return;
            }

            const preparedStreamPayload = this.prepareStreamingPayload(messageText);
            if (!preparedStreamPayload) {
              return;
            }

            preparedStreamPayload.sendOptions = { disable_notification: true };
            preparedStreamPayload.editOptions = undefined;

            this.enqueueAssistantResponse(sessionId, messageId, preparedStreamPayload);
          })
          .catch((error) => {
            logger.error("[Bot] Failed to finalize compact progress before assistant stream", error);
          });
        return;
      }

      const preparedStreamPayload = this.prepareStreamingPayload(messageText);
      if (!preparedStreamPayload) {
        return;
      }

      preparedStreamPayload.sendOptions = { disable_notification: true };
      preparedStreamPayload.editOptions = undefined;

      this.enqueueAssistantResponse(sessionId, messageId, preparedStreamPayload);
    });

    summaryAggregator.setOnComplete((sessionId, messageId, messageText, completionInfo) => {
      void this.enqueueSessionCompletionTask(sessionId, async () => {
        if (!this.botInstance || !this.chatIdInstance) {
          logger.error("Bot or chat ID not available for sending message");
          clearPromptResponseMode(sessionId);
          this.clearAssistantResponseStream(sessionId, messageId, "bot_context_missing");
          this.clearThinkingStream(sessionId, messageId, "bot_context_missing");
          this.toolCallStreamer.clearSession(sessionId, "bot_context_missing");
          this.compactProgressStreamer.clearSession(sessionId, "bot_context_missing");
          assistantRunState.clearRun(sessionId, "bot_context_missing");
          foregroundSessionState.markIdle(sessionId);
          return;
        }

        const currentSession = getCurrentSession();
        if (currentSession?.id !== sessionId) {
          clearPromptResponseMode(sessionId);
          this.clearAssistantResponseStream(sessionId, messageId, "session_mismatch");
          this.clearThinkingStream(sessionId, messageId, "session_mismatch");
          this.toolCallStreamer.clearSession(sessionId, "session_mismatch");
          this.compactProgressStreamer.clearSession(sessionId, "session_mismatch");
          assistantRunState.clearRun(sessionId, "session_mismatch");
          foregroundSessionState.markIdle(sessionId);
          await scheduledTaskRuntime.flushDeferredDeliveries();
          return;
        }

        const botApi = this.botInstance.api;
        const chatId = this.chatIdInstance;

        try {
          assistantRunState.markResponseCompleted(sessionId, {
            agent: completionInfo.agent,
            providerID: completionInfo.providerID,
            modelID: completionInfo.modelID,
          });

          await this.completeThinkingStream(sessionId, messageId);

          if (isCompactProgressMode()) {
            await this.finalizeCompactProgress(sessionId);
          }

          const assistantResponseMode = this.getAssistantResponseStreamMode(sessionId, messageId);

          await finalizeAssistantResponse({
            sessionId,
            messageId,
            messageText,
            responseStreamer: {
              complete: (completeSessionId, completeMessageId, payload, options) =>
                this.completeAssistantResponse(
                  completeSessionId,
                  completeMessageId,
                  payload,
                  options,
                ),
            },
            flushPendingServiceMessages: () =>
              Promise.all([
                this.toolMessageBatcher.flushSession(sessionId, "assistant_message_completed"),
                this.toolCallStreamer.breakSession(sessionId, "assistant_message_completed"),
              ]).then(() => undefined),
            prepareStreamingPayload: this.prepareFinalStreamingPayload,
            renderFinalParts: (text) => renderAssistantFinalPartsSafe(text),
            getReplyKeyboard: this.getCurrentReplyKeyboard,
            notifyFirstFinalPart:
              assistantResponseMode === "draft" && !getShowAssistantRunFooter(),
            sendRenderedPart: async (part, options) => {
              await sendRenderedBotPart({
                api: botApi,
                chatId,
                part,
                options: options as Parameters<typeof sendBotText>[0]["options"],
              });
            },
          });

          await sendTtsResponseForSession({
            api: botApi,
            sessionId,
            chatId,
            text: messageText,
          });
        } catch (err) {
          clearPromptResponseMode(sessionId);
          this.clearThinkingStream(sessionId, messageId, "assistant_finalize_failed");
          this.compactProgressStreamer.clearSession(sessionId, "assistant_finalize_failed");
          assistantRunState.clearRun(sessionId, "assistant_finalize_failed");
          logger.error("Failed to send message to Telegram:", err);
          logger.error("[Bot] CRITICAL: Stopping event processing due to error");
          summaryAggregator.clear();
          foregroundSessionState.markIdle(sessionId);
        } finally {
          await scheduledTaskRuntime.flushDeferredDeliveries();
        }
      });
    });

    summaryAggregator.setOnExternalUserInput(async (sessionId, _messageId, messageText) => {
      void this.enqueueSessionCompletionTask(sessionId, async () => {
        if (!this.botInstance || !this.chatIdInstance) {
          return;
        }

        try {
          await deliverExternalUserInputNotification({
            api: this.botInstance.api,
            chatId: this.chatIdInstance,
            currentSessionId: getCurrentSession()?.id ?? null,
            sessionId,
            text: messageText,
            consumeSuppressedInput: (incomingSessionId, incomingText) =>
              externalUserInputSuppressionManager.consume(incomingSessionId, incomingText),
          });
        } catch (err) {
          logger.error("[Bot] Failed to deliver external user input to Telegram:", err);
        }
      });
    });

    summaryAggregator.setOnRootToolUpdate((toolInfo) => {
      if (!isCompactProgressMode()) {
        return;
      }

      const currentSession = getCurrentSession();
      if (!currentSession || currentSession.id !== toolInfo.sessionId) {
        return;
      }

      const activity = this.getCompactToolActivity(toolInfo);
      if (activity) {
        this.compactProgressStreamer.updateActivity(toolInfo.sessionId, activity);
      }

      if ("status" in toolInfo.state && toolInfo.state.status === "completed") {
        this.compactProgressStreamer.addToolCall(toolInfo.sessionId, toolInfo.callId);
      }
    });

    summaryAggregator.setOnTool(async (toolInfo) => {
      if (!this.botInstance || !this.chatIdInstance) {
        logger.error("Bot or chat ID not available for sending tool notification");
        return;
      }

      const currentSession = getCurrentSession();
      if (!currentSession || currentSession.id !== toolInfo.sessionId) {
        return;
      }

      if (isCompactProgressMode()) {
        return;
      }

      const shouldSendToolFileAttachment =
        toolInfo.hasFileAttachment &&
        getSendDiffFileAttachments() &&
        (toolInfo.tool === "write" || toolInfo.tool === "edit" || toolInfo.tool === "apply_patch");

      if (shouldSendToolFileAttachment || toolInfo.tool === "task") {
        return;
      }

      try {
        const message = formatToolInfo(toolInfo);
        if (message) {
          this.toolCallStreamer.append(
            toolInfo.sessionId,
            message,
            this.getToolStreamKey(toolInfo.tool),
          );
        }
      } catch (err) {
        logger.error("Failed to send tool notification to Telegram:", err);
      }
    });

    summaryAggregator.setOnSubagent(async (sessionId, subagents) => {
      if (!this.botInstance || !this.chatIdInstance) {
        return;
      }

      if (isCompactProgressMode()) {
        return;
      }

      const currentSession = getCurrentSession();
      if (!currentSession || currentSession.id !== sessionId) {
        return;
      }

      try {
        const renderedCards = await renderSubagentCards(subagents);
        if (!renderedCards) {
          return;
        }

        this.toolCallStreamer.replaceByPrefix(
          sessionId,
          SUBAGENT_STREAM_PREFIX,
          renderedCards,
          "subagent",
        );
      } catch (err) {
        logger.error("Failed to render subagent activity for Telegram:", err);
      }
    });

    summaryAggregator.setOnToolFile(async (fileInfo) => {
      if (!this.botInstance || !this.chatIdInstance) {
        logger.error("Bot or chat ID not available for sending file");
        return;
      }

      const currentSession = getCurrentSession();
      if (!currentSession || currentSession.id !== fileInfo.sessionId) {
        return;
      }

      if (isCompactProgressMode()) {
        return;
      }

      if (!getSendDiffFileAttachments()) {
        return;
      }

      try {
        await this.toolCallStreamer.breakSession(fileInfo.sessionId, "tool_file_boundary");

        const toolMessage = formatToolInfo(fileInfo);
        const caption = this.prepareDocumentCaption(toolMessage || fileInfo.fileData.caption);

        this.toolMessageBatcher.enqueueFile(fileInfo.sessionId, {
          ...fileInfo.fileData,
          caption,
        });
      } catch (err) {
        logger.error("Failed to send file to Telegram:", err);
      }
    });

    summaryAggregator.setOnQuestion(async (questions, requestID, sessionId) => {
      if (!this.botInstance || !this.chatIdInstance) {
        logger.error("Bot or chat ID not available for showing questions");
        return;
      }

      const currentSession = getCurrentSession();
      if (!currentSession || currentSession.id !== sessionId) {
        return;
      }

      if (isCompactProgressMode()) {
        this.compactProgressStreamer.updateWaitingForQuestion(sessionId);
      }

      await Promise.all([
        this.toolMessageBatcher.flushSession(currentSession.id, "question_asked"),
        this.toolCallStreamer.flushSession(currentSession.id, "question_asked"),
      ]);

      if (questionManager.isActive()) {
        logger.warn("[Bot] Replacing active poll with a new one");

        const previousMessageIds = questionManager.getMessageIds();
        for (const messageId of previousMessageIds) {
          await this.botInstance.api.deleteMessage(this.chatIdInstance, messageId).catch(() => {});
        }

        clearAllInteractionState("question_replaced_by_new_poll");
      }

      logger.info(`[Bot] Received ${questions.length} questions from agent, requestID=${requestID}`);
      questionManager.startQuestions(questions, requestID);
      await showCurrentQuestion(this.botInstance.api, this.chatIdInstance);
    });

    summaryAggregator.setOnQuestionError(async () => {
      logger.info("[Bot] Question tool failed, clearing active poll and deleting messages");

      const messageIds = questionManager.getMessageIds();
      for (const messageId of messageIds) {
        if (this.chatIdInstance) {
          await this.botInstance?.api.deleteMessage(this.chatIdInstance, messageId).catch((err) => {
            logger.error(`[Bot] Failed to delete question message ${messageId}:`, err);
          });
        }
      }

      clearAllInteractionState("question_error");
    });

    summaryAggregator.setOnPermission(async (request) => {
      const generation = permissionManager.getGeneration();

      if (!this.botInstance || !this.chatIdInstance) {
        logger.error("Bot or chat ID not available for showing permission request");
        return;
      }

      const currentSession = getCurrentSession();
      const isCurrent = currentSession?.id === request.sessionID;
      const isSubagent = summaryAggregator.isSubagentSession(request.sessionID);
      if (!currentSession || (!isCurrent && !isSubagent)) {
        return;
      }

      if (isCompactProgressMode()) {
        this.compactProgressStreamer.updateWaitingForPermission(currentSession.id);
      }

      await Promise.all([
        this.toolMessageBatcher.flushSession(request.sessionID, "permission_asked"),
        this.toolCallStreamer.flushSession(request.sessionID, "permission_asked"),
      ]);

      logger.info(
        `[Bot] Received permission request from agent: type=${request.permission}, requestID=${request.id}, subagent=${isSubagent}`,
      );
      await showPermissionRequest(this.botInstance.api, this.chatIdInstance, request, generation);
    });

    summaryAggregator.setOnPermissionReplied(async (_sessionId, requestID) => {
      const messageIds = permissionManager.resolveRequest(requestID);
      const interaction = interactionManager.getSnapshot();
      if (!permissionManager.isActive() || !interaction || interaction.kind === "permission") {
        syncPermissionInteractionState({ resolvedRequestID: requestID });
      }

      if (this.botInstance && this.chatIdInstance) {
        const api = this.botInstance.api;
        const chatId = this.chatIdInstance;
        await Promise.all(
          messageIds.map((messageId) =>
            api.deleteMessage(chatId, messageId).catch((err) => {
              logger.warn(`[Bot] Failed to delete resolved permission message ${messageId}:`, err);
            }),
          ),
        );
      }

      if (messageIds.length > 0) {
        logger.info(
          `[Bot] Cleared resolved permission prompt: requestID=${requestID}, messages=${messageIds.length}`,
        );
      }
    });

    summaryAggregator.setOnThinking(async (update) => {
      if (!this.botInstance || !this.chatIdInstance) {
        return;
      }

      const currentSession = getCurrentSession();
      if (!currentSession || currentSession.id !== update.sessionId) {
        return;
      }

      logger.debug("[Bot] Agent thinking update", {
        sessionId: update.sessionId,
        messageId: update.messageId,
        sectionCount: update.sections.length,
        isFirstUpdate: update.isFirstUpdate,
      });

      if (isCompactProgressMode()) {
        this.compactProgressStreamer.updateThinking(update.sessionId);

        if (update.isFirstUpdate && pinnedMessageManager.isInitialized()) {
          await pinnedMessageManager.refresh();
        }
        return;
      }

      if (update.isFirstUpdate) {
        void this.toolCallStreamer.breakSession(update.sessionId, "thinking_started").catch((error) => {
          logger.error("[Bot] Failed to break tool stream before thinking message", error);
        });
      }

      if (getShowThinkingContent()) {
        const payload = prepareThinkingStreamingPayload(update.sections, RESPONSE_STREAM_TEXT_LIMIT, {
          expandable: false,
        });
        if (payload) {
          payload.sendOptions = { disable_notification: true };
          payload.editOptions = undefined;

          this.thinkingStreamingPayloads.set(
            this.getThinkingPayloadKey(update.sessionId, update.messageId),
            payload,
          );
          this.thinkingResponseStreamer.enqueue(
            update.sessionId,
            this.getThinkingStreamId(update.messageId),
            payload,
          );
        }
      } else if (update.isFirstUpdate) {
        deliverThinkingMessage(update.sessionId, this.toolMessageBatcher);
      }

      if (update.isFirstUpdate && pinnedMessageManager.isInitialized()) {
        await pinnedMessageManager.refresh();
      }
    });

    summaryAggregator.setOnThinkingFinished((sessionId, messageId) => {
      if (!this.botInstance || !this.chatIdInstance) {
        return;
      }

      const currentSession = getCurrentSession();
      if (!currentSession || currentSession.id !== sessionId) {
        return;
      }

      logger.debug("[Bot] Agent thinking finished", { sessionId, messageId });
      void this.completeThinkingStream(sessionId, messageId).catch((error) => {
        logger.error("[Bot] Failed to finalize thinking stream early", error);
      });
    });

    summaryAggregator.setOnTokens(async (tokens, isCompleted) => {
      if (!pinnedMessageManager.isInitialized()) {
        return;
      }

      try {
        logger.debug(
          `[Bot] Received tokens: input=${tokens.input}, output=${tokens.output}, completed=${isCompleted}`,
        );

        const contextSize = tokens.input + tokens.cacheRead;
        const contextLimit = pinnedMessageManager.getContextLimit();

        if (!isCompleted && contextSize === 0) {
          logger.debug("[Bot] Skipping zero-token intermediate update");
          return;
        }

        if (contextLimit > 0) {
          keyboardManager.updateContext(contextSize, contextLimit);
        }
        pinnedMessageManager.updateTokensSilent(tokens);

        if (isCompleted) {
          await pinnedMessageManager.onMessageComplete(tokens);
        }
      } catch (err) {
        logger.error("[Bot] Error updating pinned message with tokens:", err);
      }
    });

    summaryAggregator.setOnCost(async (cost) => {
      if (!pinnedMessageManager.isInitialized()) {
        return;
      }

      try {
        logger.debug(`[Bot] Cost update: $${cost.toFixed(2)}`);
        await pinnedMessageManager.onCostUpdate(cost);
      } catch (err) {
        logger.error("[Bot] Error updating cost:", err);
      }
    });

    summaryAggregator.setOnSessionCompacted(async (sessionId, directory) => {
      if (!pinnedMessageManager.isInitialized()) {
        return;
      }

      try {
        logger.info(`[Bot] Session compacted, reloading context: ${sessionId}`);
        await pinnedMessageManager.onSessionCompacted(sessionId, directory);
      } catch (err) {
        logger.error("[Bot] Error reloading context after compaction:", err);
      }
    });

    summaryAggregator.setOnSessionIdle(async (sessionId) => {
      await markAttachedSessionIdle(sessionId);
      await this.sessionCompletionTasks.get(sessionId)?.catch(() => undefined);

      const completedRun = assistantRunState.finishRun(sessionId, "session_idle");
      clearPromptResponseMode(sessionId);

      if (!this.botInstance || !this.chatIdInstance) {
        foregroundSessionState.markIdle(sessionId);
        return;
      }

      const currentSession = getCurrentSession();
      if (!currentSession || currentSession.id !== sessionId) {
        foregroundSessionState.markIdle(sessionId);
        await scheduledTaskRuntime.flushDeferredDeliveries();
        return;
      }

      try {
        await Promise.all([
          this.toolMessageBatcher.flushSession(sessionId, "session_idle"),
          this.toolCallStreamer.flushSession(sessionId, "session_idle"),
        ]);

        if (getShowAssistantRunFooter() && completedRun?.hasCompletedResponse) {
          const agent = completedRun.actualAgent || completedRun.configuredAgent;
          const providerID = completedRun.actualProviderID || completedRun.configuredProviderID;
          const modelID = completedRun.actualModelID || completedRun.configuredModelID;

          if (agent && providerID && modelID) {
            const keyboard = this.getCurrentReplyKeyboard();
            await this.botInstance.api.sendMessage(
              this.chatIdInstance,
              formatAssistantRunFooter({
                agent,
                providerID,
                modelID,
                elapsedMs: Date.now() - completedRun.startedAt,
              }),
              {
                ...(keyboard ? { reply_markup: keyboard } : {}),
              },
            );
          }
        }
      } catch (err) {
        logger.error("[Bot] Failed to send session idle footer:", err);
      } finally {
        foregroundSessionState.markIdle(sessionId);
        await scheduledTaskRuntime.flushDeferredDeliveries();
      }
    });

    summaryAggregator.setOnSessionError(async (sessionId, message) => {
      await markAttachedSessionIdle(sessionId);
      if (!this.botInstance || !this.chatIdInstance) {
        clearPromptResponseMode(sessionId);
        this.compactProgressStreamer.clearSession(sessionId, "session_error_no_bot_context");
        assistantRunState.clearRun(sessionId, "session_error_no_bot_context");
        foregroundSessionState.markIdle(sessionId);
        return;
      }

      const currentSession = getCurrentSession();
      if (!currentSession || currentSession.id !== sessionId) {
        clearPromptResponseMode(sessionId);
          this.clearAssistantResponseSession(sessionId, "session_error_not_current");
        this.toolCallStreamer.clearSession(sessionId, "session_error_not_current");
        this.compactProgressStreamer.clearSession(sessionId, "session_error_not_current");
        assistantRunState.clearRun(sessionId, "session_error_not_current");
        foregroundSessionState.markIdle(sessionId);
        await scheduledTaskRuntime.flushDeferredDeliveries();
        return;
      }

      this.clearAssistantResponseSession(sessionId, "session_error");
      this.compactProgressStreamer.clearSession(sessionId, "session_error");
      clearPromptResponseMode(sessionId);
      assistantRunState.clearRun(sessionId, "session_error");
      await Promise.all([
        this.toolMessageBatcher.flushSession(sessionId, "session_error"),
        this.toolCallStreamer.flushSession(sessionId, "session_error"),
      ]);

      const normalizedMessage = message.trim() || t("common.unknown_error");
      if (shouldSuppressUserAbortSessionError(sessionId, normalizedMessage)) {
        logger.debug(`[Bot] Suppressed user-initiated abort error: session=${sessionId}`);
        foregroundSessionState.markIdle(sessionId);
        await scheduledTaskRuntime.flushDeferredDeliveries();
        return;
      }

      const truncatedMessage =
        normalizedMessage.length > 3500
          ? `${normalizedMessage.slice(0, 3497)}...`
          : normalizedMessage;

      await this.botInstance.api
        .sendMessage(this.chatIdInstance, t("bot.session_error", { message: truncatedMessage }))
        .catch((err) => {
          logger.error("[Bot] Failed to send session.error message:", err);
        });

      foregroundSessionState.markIdle(sessionId);
      await scheduledTaskRuntime.flushDeferredDeliveries();
    });

    summaryAggregator.setOnSessionRetry(async ({ sessionId, message }) => {
      if (!this.botInstance || !this.chatIdInstance) {
        return;
      }

      const currentSession = getCurrentSession();
      if (!currentSession || currentSession.id !== sessionId) {
        return;
      }

      if (isCompactProgressMode()) {
        this.compactProgressStreamer.updateActivity(sessionId, t("progress.compact.retrying"));
        return;
      }

      const normalizedMessage = message.trim() || t("common.unknown_error");
      const truncatedMessage =
        normalizedMessage.length > 3500
          ? `${normalizedMessage.slice(0, 3497)}...`
          : normalizedMessage;

      const retryMessage = t("bot.session_retry", { message: truncatedMessage });
      this.toolCallStreamer.replaceByPrefix(sessionId, SESSION_RETRY_PREFIX, retryMessage);
    });

    summaryAggregator.setOnSessionDiff(async (sessionId, diffs) => {
      if (isCompactProgressMode()) {
        for (const diff of diffs) {
          this.compactProgressStreamer.addFileChange(sessionId, diff.file);
        }
      }

      if (!pinnedMessageManager.isInitialized()) {
        return;
      }

      try {
        await pinnedMessageManager.onSessionDiff(diffs);
      } catch (err) {
        logger.error("[Bot] Error updating session diff:", err);
      }
    });

    summaryAggregator.setOnFileChange((change) => {
      if (isCompactProgressMode()) {
        const currentSession = getCurrentSession();
        if (currentSession) {
          this.compactProgressStreamer.addFileChange(currentSession.id, change.file);
        }
      }

      if (!pinnedMessageManager.isInitialized()) {
        return;
      }
      pinnedMessageManager.addFileChange(change);
    });

    pinnedMessageManager.setOnKeyboardUpdate(async (tokensUsed, tokensLimit) => {
      try {
        logger.debug(`[Bot] Updating keyboard with context: ${tokensUsed}/${tokensLimit}`);
        keyboardManager.updateContext(tokensUsed, tokensLimit);
      } catch (err) {
        logger.error("[Bot] Error updating keyboard context:", err);
      }
    });

    logger.info(`[Bot] Subscribing to OpenCode events for project: ${directory}`);
    subscribeToEvents(directory, (event) => {
      if ((event as EventStreamItem).type === "server.heartbeat") {
        void reconcileBusyState(directory);
      }

      const attached = attachManager.getSnapshot();
      const eventSessionId = this.getEventSessionId(event as EventStreamItem);
      if (
        attached &&
        eventSessionId === attached.sessionId &&
        this.shouldMarkAttachedBusyFromEvent(event as EventStreamItem)
      ) {
        void markAttachedSessionBusy(attached.sessionId);
      }

      if (event.type === "session.created" || event.type === "session.updated") {
        const info = (
          event.properties as { info?: { directory?: string; time?: { updated?: number } } }
        ).info;

        if (info?.directory) {
          safeBackgroundTask({
            taskName: `session.cache.${event.type}`,
            task: () => ingestSessionInfoForCache(info),
          });
        }
      }

      if (config.bot.trackBackgroundSessions) {
        backgroundSessionTracker.processEvent(event, getCurrentSession()?.id ?? null);
      }

      summaryAggregator.processEvent(event);
    }).catch((err) => {
      logger.error("Failed to subscribe to events:", err);
    });
  };

  private getAssistantResponseStreamKey(sessionId: string, messageId: string): string {
    return `${sessionId}:${messageId}`;
  }

  private getAssistantResponseStreamer(mode: ResponseStreamingMode): ResponseStreamer {
    return mode === "draft"
      ? this.assistantDraftResponseStreamer
      : this.assistantEditResponseStreamer;
  }

  private getAssistantResponseStreamMode(sessionId: string, messageId: string): ResponseStreamingMode {
    return (
      this.assistantResponseStreamModes.get(this.getAssistantResponseStreamKey(sessionId, messageId)) ??
      getResponseStreamingMode()
    );
  }

  private enqueueAssistantResponse(
    sessionId: string,
    messageId: string,
    payload: StreamingMessagePayload,
  ): void {
    const key = this.getAssistantResponseStreamKey(sessionId, messageId);
    const mode = this.getAssistantResponseStreamMode(sessionId, messageId);
    this.assistantResponseStreamModes.set(key, mode);
    this.getAssistantResponseStreamer(mode).enqueue(sessionId, messageId, payload);
  }

  private async completeAssistantResponse(
    sessionId: string,
    messageId: string,
    payload?: StreamingMessagePayload,
    options?: Parameters<ResponseStreamer["complete"]>[3],
  ) {
    const key = this.getAssistantResponseStreamKey(sessionId, messageId);
    const mode = this.getAssistantResponseStreamMode(sessionId, messageId);
    const result = await this.getAssistantResponseStreamer(mode).complete(
      sessionId,
      messageId,
      payload,
      options,
    );
    this.assistantResponseStreamModes.delete(key);
    return result;
  }

  private clearAssistantResponseStream(sessionId: string, messageId: string, reason: string): void {
    this.assistantResponseStreamModes.delete(
      this.getAssistantResponseStreamKey(sessionId, messageId),
    );
    this.assistantEditResponseStreamer.clearMessage(sessionId, messageId, reason);
    this.assistantDraftResponseStreamer.clearMessage(sessionId, messageId, reason);
  }

  private clearAssistantResponseSession(sessionId: string, reason: string): void {
    for (const key of this.assistantResponseStreamModes.keys()) {
      if (key.startsWith(`${sessionId}:`)) {
        this.assistantResponseStreamModes.delete(key);
      }
    }

    this.assistantEditResponseStreamer.clearSession(sessionId, reason);
    this.assistantDraftResponseStreamer.clearSession(sessionId, reason);
  }

  private clearAllResponseStreams(reason: string): void {
    this.assistantResponseStreamModes.clear();
    this.assistantEditResponseStreamer.clearAll(reason);
    this.assistantDraftResponseStreamer.clearAll(reason);
    this.thinkingResponseStreamer.clearAll(reason);
  }

  private hasActiveAssistantResponseStream(sessionId: string): boolean {
    return (
      this.assistantEditResponseStreamer.hasActiveStream(sessionId) ||
      this.assistantDraftResponseStreamer.hasActiveStream(sessionId)
    );
  }

  private createResponseStreamer(mode: ResponseStreamingMode): ResponseStreamer {
    if (mode === "draft") {
      return new ResponseStreamer({
        throttleMs: RESPONSE_STREAM_THROTTLE_MS,
        sendPart: async (part) => {
          if (!this.botInstance || !this.chatIdInstance || this.chatIdInstance <= 0) {
            throw new Error("Bot context missing for draft send");
          }

          const draftId = this.getNextDraftId();
          const result = await sendDraftBotPart({
            api: this.botInstance.api,
            chatId: this.chatIdInstance,
            draftId,
            part,
          });
          return { messageId: draftId, deliveredSignature: result.deliveredSignature };
        },
        editPart: async (messageId, part) => {
          if (!this.botInstance || !this.chatIdInstance || this.chatIdInstance <= 0) {
            throw new Error("Bot context missing for draft edit");
          }

          return sendDraftBotPart({
            api: this.botInstance.api,
            chatId: this.chatIdInstance,
            draftId: messageId,
            part,
          });
        },
        deleteText: async () => {},
        completePart: async (part, options) => {
          if (!this.botInstance || !this.chatIdInstance || this.chatIdInstance <= 0) {
            throw new Error("Bot context missing for draft complete");
          }

          return completeDraftPart({
            api: this.botInstance.api,
            chatId: this.chatIdInstance,
            part,
            options,
          });
        },
      });
    }

    return new ResponseStreamer({
      throttleMs: RESPONSE_STREAM_THROTTLE_MS,
      sendPart: async (part, options) => {
        if (!this.botInstance || !this.chatIdInstance || this.chatIdInstance <= 0) {
          throw new Error("Bot context missing for streamed send");
        }

        return sendRenderedBotPart({
          api: this.botInstance.api,
          chatId: this.chatIdInstance,
          part,
          options,
        });
      },
      editPart: async (messageId, part, options) => {
        if (!this.botInstance || !this.chatIdInstance || this.chatIdInstance <= 0) {
          throw new Error("Bot context missing for streamed edit");
        }

        try {
          return await editRenderedBotPart({
            api: this.botInstance.api,
            chatId: this.chatIdInstance,
            messageId,
            part,
            options,
          });
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
          if (errorMessage.includes("message is not modified")) {
            return {
              deliveredSignature: getTelegramRenderedPartSignature(part),
            };
          }

          throw error;
        }
      },
      deleteText: async (messageId) => {
        if (!this.botInstance || !this.chatIdInstance || this.chatIdInstance <= 0) {
          throw new Error("Bot context missing for streamed delete");
        }

        await this.botInstance.api.deleteMessage(this.chatIdInstance, messageId).catch((error) => {
          const errorMessage =
            error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
          if (
            errorMessage.includes("message to delete not found") ||
            errorMessage.includes("message identifier is not specified")
          ) {
            return;
          }

          throw error;
        });
      },
    });
  }

  private getCurrentReplyKeyboard = () => {
    if (!keyboardManager.isInitialized()) {
      return undefined;
    }

    return keyboardManager.getKeyboard();
  };

  private prepareDocumentCaption(caption: string): string {
    const normalizedCaption = caption.trim();
    if (!normalizedCaption) {
      return "";
    }

    if (normalizedCaption.length <= TELEGRAM_DOCUMENT_CAPTION_MAX_LENGTH) {
      return normalizedCaption;
    }

    return `${normalizedCaption.slice(0, TELEGRAM_DOCUMENT_CAPTION_MAX_LENGTH - 3)}...`;
  }

  private prepareStreamingPayload(messageText: string): StreamingMessagePayload | null {
    return prepareAssistantStreamingPayload(messageText, RESPONSE_STREAM_TEXT_LIMIT);
  }

  private prepareFinalStreamingPayload(messageText: string): StreamingMessagePayload | null {
    return prepareAssistantFinalStreamingPayload(messageText, RESPONSE_STREAM_TEXT_LIMIT);
  }

  private getThinkingStreamId(messageId: string): string {
    return `thinking:${messageId}`;
  }

  private getThinkingPayloadKey(sessionId: string, messageId: string): string {
    return `${sessionId}:${messageId}`;
  }

  private clearThinkingStream(sessionId: string, messageId: string, reason: string): void {
    this.thinkingResponseStreamer.clearMessage(sessionId, this.getThinkingStreamId(messageId), reason);
    this.thinkingStreamingPayloads.delete(this.getThinkingPayloadKey(sessionId, messageId));
  }

  private async completeThinkingStream(sessionId: string, messageId: string): Promise<void> {
    const key = this.getThinkingPayloadKey(sessionId, messageId);
    const payload = this.thinkingStreamingPayloads.get(key);
    const finalPayload = payload ? makeThinkingPayloadExpandable(payload) : undefined;
    const result = await this.thinkingResponseStreamer.complete(
      sessionId,
      this.getThinkingStreamId(messageId),
      finalPayload,
    );
    this.thinkingStreamingPayloads.delete(key);

    if (result.streamed || !finalPayload) {
      return;
    }

    if (!this.botInstance || !this.chatIdInstance) {
      return;
    }

    for (const part of finalPayload.parts) {
      await sendRenderedBotPart({
        api: this.botInstance.api,
        chatId: this.chatIdInstance,
        part,
        options: finalPayload.sendOptions as Parameters<typeof sendBotText>[0]["options"],
      });
    }
  }

  private enqueueSessionCompletionTask(sessionId: string, task: () => Promise<void>): Promise<void> {
    const previousTask = this.sessionCompletionTasks.get(sessionId) ?? Promise.resolve();
    const nextTask = previousTask
      .catch(() => undefined)
      .then(task)
      .finally(() => {
        if (this.sessionCompletionTasks.get(sessionId) === nextTask) {
          this.sessionCompletionTasks.delete(sessionId);
        }
      });

    this.sessionCompletionTasks.set(sessionId, nextTask);
    return nextTask;
  }

  private finalizeCompactProgress(sessionId: string): Promise<void> {
    const existingTask = this.compactProgressFinalizationTasks.get(sessionId);
    if (existingTask) {
      return existingTask;
    }

    const nextTask = this.compactProgressStreamer.finalize(sessionId).finally(() => {
      if (this.compactProgressFinalizationTasks.get(sessionId) === nextTask) {
        this.compactProgressFinalizationTasks.delete(sessionId);
      }
    });

    this.compactProgressFinalizationTasks.set(sessionId, nextTask);
    return nextTask;
  }

  private getNextDraftId(): number {
    const id = this.nextDraftId;
    this.nextDraftId += 1;
    return id;
  }

  private getToolStreamKey(tool: string): ToolStreamKey {
    if (tool === "todowrite") {
      return "todo";
    }

    return "default";
  }

  private getCompactToolActivity(toolInfo: ToolInfo): string | null {
    if (toolInfo.tool === "task") {
      return t("progress.compact.task");
    }

    return formatCompactToolActivity(toolInfo, 128);
  }

  private formatShortSessionId(sessionId: string): string {
    return sessionId.length <= 8 ? sessionId : sessionId.slice(0, 8);
  }

  private getBackgroundSessionLabel(notification: BackgroundSessionNotification): string {
    const title = notification.sessionTitle?.trim();
    if (title) {
      return title;
    }

    return t("background.session_fallback", {
      id: this.formatShortSessionId(notification.sessionId),
    });
  }

  private formatBackgroundSessionNotification(notification: BackgroundSessionNotification): string {
    const session = this.getBackgroundSessionLabel(notification);

    switch (notification.kind) {
      case "assistant_response":
        return t("background.assistant_response", { session });
      case "question_asked":
        return t("background.question_asked", { session });
      case "permission_asked":
        return t("background.permission_asked", { session });
    }
  }

  private deliverBackgroundSessionNotification = async (
    notification: BackgroundSessionNotification,
  ): Promise<void> => {
    if (!this.botInstance || !this.chatIdInstance) {
      return;
    }

    await this.botInstance.api.sendMessage(
      this.chatIdInstance,
      this.formatBackgroundSessionNotification(notification),
      {
        reply_markup: buildBackgroundSessionOpenKeyboard(notification.sessionId, notification.kind),
      },
    );
  };

  private getEventSessionId(event: EventStreamItem): string | null {
    const properties = event.properties as {
      sessionID?: string;
      info?: { sessionID?: string };
      part?: { sessionID?: string };
    };

    return properties.sessionID || properties.info?.sessionID || properties.part?.sessionID || null;
  }

  private shouldMarkAttachedBusyFromEvent(event: EventStreamItem): boolean {
    switch (event.type) {
      case "session.status":
        return (event.properties as { status?: { type?: string } }).status?.type === "busy";
      case "message.updated": {
        const info = (
          event.properties as { info?: { role?: string; time?: { completed?: number } } }
        ).info;
        return info?.role === "assistant" && !info.time?.completed;
      }
      case "message.part.updated":
      case "message.part.delta":
      case "question.asked":
      case "permission.asked":
        return true;
      default:
        return false;
    }
  }
}
