import { Bot, Context, InputFile, NextFunction } from "grammy";
import { promises as fs } from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { SocksProxyAgent } from "socks-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import { config } from "../config.js";
import { authMiddleware } from "./middleware/auth.js";
import { interactionGuardMiddleware } from "./middleware/interaction-guard.js";
import { unknownCommandMiddleware } from "./middleware/unknown-command.js";
import { BOT_COMMANDS } from "./commands/definitions.js";
import { startCommand } from "./commands/start.js";
import { helpCommand } from "./commands/help.js";
import { statusCommand } from "./commands/status.js";
import {
  AGENT_MODE_BUTTON_TEXT_PATTERN,
  MODEL_BUTTON_TEXT_PATTERN,
  VARIANT_BUTTON_TEXT_PATTERN,
} from "./message-patterns.js";
import { sessionsCommand, handleSessionSelect } from "./commands/sessions.js";
import { newCommand } from "./commands/new.js";
import { projectsCommand, handleProjectSelect } from "./commands/projects.js";
import { worktreeCommand, handleWorktreeCallback } from "./commands/worktree.js";
import { openCommand, handleOpenCallback, clearOpenPathIndex } from "./commands/open.js";
import { abortCommand } from "./commands/abort.js";
import { opencodeStartCommand } from "./commands/opencode-start.js";
import { opencodeStopCommand } from "./commands/opencode-stop.js";
import { renameCommand, handleRenameCancel, handleRenameTextAnswer } from "./commands/rename.js";
import { handleTaskCallback, handleTaskTextInput, taskCommand } from "./commands/task.js";
import { handleTaskListCallback, taskListCommand } from "./commands/tasklist.js";
import {
  commandsCommand,
  handleCommandsCallback,
  handleCommandTextArguments,
} from "./commands/commands.js";
import {
  skillsCommand,
  handleSkillsCallback,
  handleSkillTextArguments,
} from "./commands/skills.js";
import { ttsCommand } from "./commands/tts.js";
import {
  handleQuestionCallback,
  showCurrentQuestion,
  handleQuestionTextAnswer,
} from "./handlers/question.js";
import { handlePermissionCallback, showPermissionRequest } from "./handlers/permission.js";
import { handleAgentSelect, showAgentSelectionMenu } from "./handlers/agent.js";
import { handleModelSelect, showModelSelectionMenu } from "./handlers/model.js";
import { handleVariantSelect, showVariantSelectionMenu } from "./handlers/variant.js";
import { handleContextButtonPress, handleCompactConfirm } from "./handlers/context.js";
import { handleInlineMenuCancel } from "./handlers/inline-menu.js";
import { questionManager } from "../question/manager.js";
import { interactionManager } from "../interaction/manager.js";
import { clearAllInteractionState } from "../interaction/cleanup.js";
import { keyboardManager } from "../keyboard/manager.js";
import { stopEventListening, subscribeToEvents } from "../opencode/events.js";
import { summaryAggregator } from "../summary/aggregator.js";
import { formatToolInfo } from "../summary/formatter.js";
import { renderSubagentCards } from "../summary/subagent-formatter.js";
import { ToolMessageBatcher } from "../summary/tool-message-batcher.js";
import { getCurrentSession } from "../session/manager.js";
import { ingestSessionInfoForCache } from "../session/cache-manager.js";
import { logger } from "../utils/logger.js";
import { safeBackgroundTask } from "../utils/safe-background-task.js";
import { withTelegramRateLimitRetry } from "../utils/telegram-rate-limit-retry.js";
import { pinnedMessageManager } from "../pinned/manager.js";
import { t } from "../i18n/index.js";
import { clearPromptResponseMode, processUserPrompt } from "./handlers/prompt.js";
import { handleVoiceMessage } from "./handlers/voice.js";
import { handleDocumentMessage } from "./handlers/document.js";
import { downloadTelegramFile, toDataUri } from "./utils/file-download.js";
import { finalizeAssistantResponse } from "./utils/finalize-assistant-response.js";
import { sendTtsResponseForSession } from "./utils/send-tts-response.js";
import { deliverThinkingMessage } from "./utils/thinking-message.js";
import {
  editRenderedBotPart,
  getTelegramRenderedPartSignature,
  sendBotText,
  sendRenderedBotPart,
} from "./utils/telegram-text.js";
import { formatAssistantRunFooter } from "./utils/assistant-run-footer.js";
import { getModelCapabilities, supportsInput } from "../model/capabilities.js";
import { getStoredModel } from "../model/manager.js";
import type { FilePartInput } from "@opencode-ai/sdk/v2";
import { foregroundSessionState } from "../scheduled-task/foreground-state.js";
import { scheduledTaskRuntime } from "../scheduled-task/runtime.js";
import { assistantRunState } from "./assistant-run-state.js";
import { ResponseStreamer } from "./streaming/response-streamer.js";
import type { StreamingMessagePayload } from "./streaming/response-streamer.js";
import { ToolCallStreamer, type ToolStreamKey } from "./streaming/tool-call-streamer.js";
import { attachManager } from "../attach/manager.js";
import {
  markAttachedSessionBusy,
  markAttachedSessionIdle,
  restoreAttachedCurrentSession,
} from "../attach/service.js";
import { externalUserInputSuppressionManager } from "../external-input/suppression.js";
import {
  prepareAssistantFinalStreamingPayload,
  prepareAssistantStreamingPayload,
  renderAssistantFinalPartsSafe,
} from "./utils/assistant-rendering.js";
import { deliverExternalUserInputNotification } from "./utils/external-user-input.js";

let botInstance: Bot<Context> | null = null;
let chatIdInstance: number | null = null;
let commandsInitialized = false;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

const TELEGRAM_DOCUMENT_CAPTION_MAX_LENGTH = 1024;
const RESPONSE_STREAM_THROTTLE_MS = config.bot.responseStreamThrottleMs;
const RESPONSE_STREAM_TEXT_LIMIT = 3800;
const SESSION_RETRY_PREFIX = "🔁";
const SUBAGENT_STREAM_PREFIX = "🧩";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMP_DIR = path.join(__dirname, "..", ".tmp");
const sessionCompletionTasks = new Map<string, Promise<void>>();

function getCurrentReplyKeyboard() {
  if (!keyboardManager.isInitialized()) {
    return undefined;
  }

  return keyboardManager.getKeyboard();
}

function prepareDocumentCaption(caption: string): string {
  const normalizedCaption = caption.trim();
  if (!normalizedCaption) {
    return "";
  }

  if (normalizedCaption.length <= TELEGRAM_DOCUMENT_CAPTION_MAX_LENGTH) {
    return normalizedCaption;
  }

  return `${normalizedCaption.slice(0, TELEGRAM_DOCUMENT_CAPTION_MAX_LENGTH - 3)}...`;
}

function prepareStreamingPayload(messageText: string): StreamingMessagePayload | null {
  return prepareAssistantStreamingPayload(messageText, RESPONSE_STREAM_TEXT_LIMIT);
}

function prepareFinalStreamingPayload(messageText: string): StreamingMessagePayload | null {
  return prepareAssistantFinalStreamingPayload(messageText, RESPONSE_STREAM_TEXT_LIMIT);
}

function enqueueSessionCompletionTask(sessionId: string, task: () => Promise<void>): Promise<void> {
  const previousTask = sessionCompletionTasks.get(sessionId) ?? Promise.resolve();
  const nextTask = previousTask
    .catch(() => undefined)
    .then(task)
    .finally(() => {
      if (sessionCompletionTasks.get(sessionId) === nextTask) {
        sessionCompletionTasks.delete(sessionId);
      }
    });

  sessionCompletionTasks.set(sessionId, nextTask);
  return nextTask;
}

const toolMessageBatcher = new ToolMessageBatcher({
  sendText: async (sessionId, text) => {
    if (!botInstance || !chatIdInstance) {
      return;
    }

    const currentSession = getCurrentSession();
    if (!currentSession || currentSession.id !== sessionId) {
      return;
    }

    const keyboard = getCurrentReplyKeyboard();

    await botInstance.api.sendMessage(chatIdInstance, text, {
      disable_notification: true,
      ...(keyboard ? { reply_markup: keyboard } : {}),
    });
  },
  sendFile: async (sessionId, fileData) => {
    if (!botInstance || !chatIdInstance) {
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

      const keyboard = getCurrentReplyKeyboard();

      await botInstance.api.sendDocument(chatIdInstance, new InputFile(tempFilePath), {
        caption: fileData.caption,
        disable_notification: true,
        ...(keyboard ? { reply_markup: keyboard } : {}),
      });
    } finally {
      await fs.unlink(tempFilePath).catch(() => {});
    }
  },
});

const responseStreamer = new ResponseStreamer({
  throttleMs: RESPONSE_STREAM_THROTTLE_MS,
  sendPart: async (part, options) => {
    if (!botInstance || !chatIdInstance || chatIdInstance <= 0) {
      throw new Error("Bot context missing for streamed send");
    }

    return sendRenderedBotPart({
      api: botInstance.api,
      chatId: chatIdInstance,
      part,
      options,
    });
  },
  editPart: async (messageId, part, options) => {
    if (!botInstance || !chatIdInstance || chatIdInstance <= 0) {
      throw new Error("Bot context missing for streamed edit");
    }

    try {
      return await editRenderedBotPart({
        api: botInstance.api,
        chatId: chatIdInstance,
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
    if (!botInstance || !chatIdInstance || chatIdInstance <= 0) {
      throw new Error("Bot context missing for streamed delete");
    }

    await botInstance.api.deleteMessage(chatIdInstance, messageId).catch((error) => {
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

const toolCallStreamer = new ToolCallStreamer({
  throttleMs: RESPONSE_STREAM_THROTTLE_MS,
  sendText: async (sessionId, text) => {
    if (!botInstance || !chatIdInstance || chatIdInstance <= 0) {
      throw new Error("Bot context missing for tool stream send");
    }

    const currentSession = getCurrentSession();
    if (!currentSession || currentSession.id !== sessionId) {
      throw new Error(`Tool stream session mismatch for send: ${sessionId}`);
    }

    const sentMessage = await botInstance.api.sendMessage(chatIdInstance, text, {
      disable_notification: true,
    });

    return sentMessage.message_id;
  },
  editText: async (sessionId, messageId, text) => {
    if (!botInstance || !chatIdInstance || chatIdInstance <= 0) {
      throw new Error("Bot context missing for tool stream edit");
    }

    const currentSession = getCurrentSession();
    if (!currentSession || currentSession.id !== sessionId) {
      throw new Error(`Tool stream session mismatch for edit: ${sessionId}`);
    }

    try {
      await botInstance.api.editMessageText(chatIdInstance, messageId, text);
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
    if (!botInstance || !chatIdInstance || chatIdInstance <= 0) {
      throw new Error("Bot context missing for tool stream delete");
    }

    const currentSession = getCurrentSession();
    if (!currentSession || currentSession.id !== sessionId) {
      throw new Error(`Tool stream session mismatch for delete: ${sessionId}`);
    }

    await botInstance.api.deleteMessage(chatIdInstance, messageId).catch((error) => {
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

function getToolStreamKey(tool: string): ToolStreamKey {
  if (tool === "todowrite") {
    return "todo";
  }

  return "default";
}

type EventStreamItem = {
  type: string;
  properties: Record<string, unknown>;
};

function getEventSessionId(event: EventStreamItem): string | null {
  const properties = event.properties as {
    sessionID?: string;
    info?: { sessionID?: string };
    part?: { sessionID?: string };
  };

  return properties.sessionID || properties.info?.sessionID || properties.part?.sessionID || null;
}

function shouldMarkAttachedBusyFromEvent(event: EventStreamItem): boolean {
  switch (event.type) {
    case "session.status":
      return (event.properties as { status?: { type?: string } }).status?.type === "busy";
    case "message.updated": {
      const info = (event.properties as { info?: { role?: string; time?: { completed?: number } } }).info;
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

async function ensureCommandsInitialized(ctx: Context, next: NextFunction): Promise<void> {
  if (commandsInitialized || !ctx.from || ctx.from.id !== config.telegram.allowedUserId) {
    await next();
    return;
  }

  if (!ctx.chat) {
    logger.warn("[Bot] Cannot initialize commands: chat context is missing");
    await next();
    return;
  }

  try {
    await ctx.api.setMyCommands(BOT_COMMANDS, {
      scope: {
        type: "chat",
        chat_id: ctx.chat.id,
      },
    });

    commandsInitialized = true;
    logger.debug(`[Bot] Commands initialized for authorized user (chat_id=${ctx.chat.id})`);
  } catch (err) {
    logger.error("[Bot] Failed to set commands:", err);
  }

  await next();
}

async function ensureEventSubscription(directory: string): Promise<void> {
  if (!directory) {
    logger.error("No directory found for event subscription");
    return;
  }

  summaryAggregator.setTypingIndicatorEnabled(true);
  summaryAggregator.setOnCleared(() => {
    toolMessageBatcher.clearAll("summary_aggregator_clear");
    toolCallStreamer.clearAll("summary_aggregator_clear");
    responseStreamer.clearAll("summary_aggregator_clear");
  });

  summaryAggregator.setOnPartial((sessionId, messageId, messageText) => {
    if (!botInstance || !chatIdInstance) {
      return;
    }

    const currentSession = getCurrentSession();
    if (!currentSession || currentSession.id !== sessionId) {
      return;
    }

    const preparedStreamPayload = prepareStreamingPayload(messageText);
    if (!preparedStreamPayload) {
      return;
    }

    // Reply keyboards make the first streamed message non-editable in Telegram,
    // so partial chunks must be sent without reply_markup and finalized later.
    preparedStreamPayload.sendOptions = { disable_notification: true };
    preparedStreamPayload.editOptions = undefined;

    responseStreamer.enqueue(sessionId, messageId, preparedStreamPayload);
  });

  summaryAggregator.setOnComplete((sessionId, messageId, messageText, completionInfo) => {
    void enqueueSessionCompletionTask(sessionId, async () => {
      if (!botInstance || !chatIdInstance) {
        logger.error("Bot or chat ID not available for sending message");
        clearPromptResponseMode(sessionId);
        responseStreamer.clearMessage(sessionId, messageId, "bot_context_missing");
        toolCallStreamer.clearSession(sessionId, "bot_context_missing");
        assistantRunState.clearRun(sessionId, "bot_context_missing");
        foregroundSessionState.markIdle(sessionId);
        return;
      }

      const currentSession = getCurrentSession();
      if (currentSession?.id !== sessionId) {
        clearPromptResponseMode(sessionId);
        responseStreamer.clearMessage(sessionId, messageId, "session_mismatch");
        toolCallStreamer.clearSession(sessionId, "session_mismatch");
        assistantRunState.clearRun(sessionId, "session_mismatch");
        foregroundSessionState.markIdle(sessionId);
        await scheduledTaskRuntime.flushDeferredDeliveries();
        return;
      }

      const botApi = botInstance.api;
      const chatId = chatIdInstance;

      try {
        assistantRunState.markResponseCompleted(sessionId, {
          agent: completionInfo.agent,
          providerID: completionInfo.providerID,
          modelID: completionInfo.modelID,
        });

        await finalizeAssistantResponse({
          sessionId,
          messageId,
          messageText,
          responseStreamer,
          flushPendingServiceMessages: () =>
            Promise.all([
              toolMessageBatcher.flushSession(sessionId, "assistant_message_completed"),
              toolCallStreamer.breakSession(sessionId, "assistant_message_completed"),
            ]).then(() => undefined),
          prepareStreamingPayload: prepareFinalStreamingPayload,
          renderFinalParts: (text) => renderAssistantFinalPartsSafe(text),
          getReplyKeyboard: getCurrentReplyKeyboard,
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
        assistantRunState.clearRun(sessionId, "assistant_finalize_failed");
        logger.error("Failed to send message to Telegram:", err);
        // Stop processing events after critical error to prevent infinite loop
        logger.error("[Bot] CRITICAL: Stopping event processing due to error");
        summaryAggregator.clear();
        foregroundSessionState.markIdle(sessionId);
      } finally {
        await scheduledTaskRuntime.flushDeferredDeliveries();
      }
    });
  });

  summaryAggregator.setOnExternalUserInput(async (sessionId, _messageId, messageText) => {
    void enqueueSessionCompletionTask(sessionId, async () => {
      if (!botInstance || !chatIdInstance) {
        return;
      }

      try {
        await deliverExternalUserInputNotification({
          api: botInstance.api,
          chatId: chatIdInstance,
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

  summaryAggregator.setOnTool(async (toolInfo) => {
    if (!botInstance || !chatIdInstance) {
      logger.error("Bot or chat ID not available for sending tool notification");
      return;
    }

    const currentSession = getCurrentSession();
    if (!currentSession || currentSession.id !== toolInfo.sessionId) {
      return;
    }

    const shouldIncludeToolInfoInFileCaption =
      toolInfo.hasFileAttachment &&
      (toolInfo.tool === "write" || toolInfo.tool === "edit" || toolInfo.tool === "apply_patch");

    if (
      config.bot.hideToolCallMessages ||
      shouldIncludeToolInfoInFileCaption ||
      toolInfo.tool === "task"
    ) {
      return;
    }

    try {
      const message = formatToolInfo(toolInfo);
      if (message) {
        toolCallStreamer.append(toolInfo.sessionId, message, getToolStreamKey(toolInfo.tool));
      }
    } catch (err) {
      logger.error("Failed to send tool notification to Telegram:", err);
    }
  });

  summaryAggregator.setOnSubagent(async (sessionId, subagents) => {
    if (!botInstance || !chatIdInstance) {
      return;
    }

    if (config.bot.hideToolCallMessages) {
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

      toolCallStreamer.replaceByPrefix(
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
    if (!botInstance || !chatIdInstance) {
      logger.error("Bot or chat ID not available for sending file");
      return;
    }

    const currentSession = getCurrentSession();
    if (!currentSession || currentSession.id !== fileInfo.sessionId) {
      return;
    }

    if (config.bot.hideToolFileMessages) {
      return;
    }

    try {
      await toolCallStreamer.breakSession(fileInfo.sessionId, "tool_file_boundary");

      const toolMessage = formatToolInfo(fileInfo);
      const caption = prepareDocumentCaption(toolMessage || fileInfo.fileData.caption);

      toolMessageBatcher.enqueueFile(fileInfo.sessionId, {
        ...fileInfo.fileData,
        caption,
      });
    } catch (err) {
      logger.error("Failed to send file to Telegram:", err);
    }
  });

  summaryAggregator.setOnQuestion(async (questions, requestID, sessionId) => {
    if (!botInstance || !chatIdInstance) {
      logger.error("Bot or chat ID not available for showing questions");
      return;
    }

    const currentSession = getCurrentSession();
    if (!currentSession || currentSession.id !== sessionId) {
      return;
    }

    await Promise.all([
      toolMessageBatcher.flushSession(currentSession.id, "question_asked"),
      toolCallStreamer.flushSession(currentSession.id, "question_asked"),
    ]);

    if (questionManager.isActive()) {
      logger.warn("[Bot] Replacing active poll with a new one");

      const previousMessageIds = questionManager.getMessageIds();
      for (const messageId of previousMessageIds) {
        await botInstance.api.deleteMessage(chatIdInstance, messageId).catch(() => {});
      }

      clearAllInteractionState("question_replaced_by_new_poll");
    }

    logger.info(`[Bot] Received ${questions.length} questions from agent, requestID=${requestID}`);
    questionManager.startQuestions(questions, requestID);
    await showCurrentQuestion(botInstance.api, chatIdInstance);
  });

  summaryAggregator.setOnQuestionError(async () => {
    logger.info(`[Bot] Question tool failed, clearing active poll and deleting messages`);

    // Delete all messages from the invalid poll
    const messageIds = questionManager.getMessageIds();
    for (const messageId of messageIds) {
      if (chatIdInstance) {
        await botInstance?.api.deleteMessage(chatIdInstance, messageId).catch((err) => {
          logger.error(`[Bot] Failed to delete question message ${messageId}:`, err);
        });
      }
    }

    clearAllInteractionState("question_error");
  });

  summaryAggregator.setOnPermission(async (request) => {
    if (!botInstance || !chatIdInstance) {
      logger.error("Bot or chat ID not available for showing permission request");
      return;
    }

    const currentSession = getCurrentSession();
    if (!currentSession || currentSession.id !== request.sessionID) {
      return;
    }

    await Promise.all([
      toolMessageBatcher.flushSession(request.sessionID, "permission_asked"),
      toolCallStreamer.flushSession(request.sessionID, "permission_asked"),
    ]);

    logger.info(
      `[Bot] Received permission request from agent: type=${request.permission}, requestID=${request.id}`,
    );
    await showPermissionRequest(botInstance.api, chatIdInstance, request);
  });

  summaryAggregator.setOnThinking(async (sessionId) => {
    if (!botInstance || !chatIdInstance) {
      return;
    }

    const currentSession = getCurrentSession();
    if (!currentSession || currentSession.id !== sessionId) {
      return;
    }

    logger.debug("[Bot] Agent started thinking");

    await toolCallStreamer.breakSession(sessionId, "thinking_started");

    deliverThinkingMessage(sessionId, toolMessageBatcher, {
      hideThinkingMessages: config.bot.hideThinkingMessages,
    });

    // Refresh pinned message so it shows the latest in-memory context
    // (accumulated from silent token updates). 1 API call per thinking event.
    if (pinnedMessageManager.isInitialized()) {
      await pinnedMessageManager.refresh();
    }
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

      // Skip non-completed messages with zero context: a new assistant message
      // starts with tokens={input:0, ...} which would overwrite valid context
      // from the previous step. Only accept zeros from completed messages.
      if (!isCompleted && contextSize === 0) {
        logger.debug("[Bot] Skipping zero-token intermediate update");
        return;
      }

      // Update both keyboard and pinned state in memory (keeps them in sync)
      if (contextLimit > 0) {
        keyboardManager.updateContext(contextSize, contextLimit);
      }
      pinnedMessageManager.updateTokensSilent(tokens);

      // Full pinned message update (API call) only on completed messages
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
    await sessionCompletionTasks.get(sessionId)?.catch(() => undefined);

    const completedRun = assistantRunState.finishRun(sessionId, "session_idle");
    clearPromptResponseMode(sessionId);

    if (!botInstance || !chatIdInstance) {
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
        toolMessageBatcher.flushSession(sessionId, "session_idle"),
        toolCallStreamer.flushSession(sessionId, "session_idle"),
      ]);

      if (completedRun?.hasCompletedResponse) {
        const agent = completedRun.actualAgent || completedRun.configuredAgent;
        const providerID = completedRun.actualProviderID || completedRun.configuredProviderID;
        const modelID = completedRun.actualModelID || completedRun.configuredModelID;

        if (agent && providerID && modelID) {
          const keyboard = getCurrentReplyKeyboard();
          await botInstance.api.sendMessage(
            chatIdInstance,
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
    if (!botInstance || !chatIdInstance) {
      clearPromptResponseMode(sessionId);
      assistantRunState.clearRun(sessionId, "session_error_no_bot_context");
      foregroundSessionState.markIdle(sessionId);
      return;
    }

    const currentSession = getCurrentSession();
    if (!currentSession || currentSession.id !== sessionId) {
      clearPromptResponseMode(sessionId);
      responseStreamer.clearSession(sessionId, "session_error_not_current");
      toolCallStreamer.clearSession(sessionId, "session_error_not_current");
      assistantRunState.clearRun(sessionId, "session_error_not_current");
      foregroundSessionState.markIdle(sessionId);
      await scheduledTaskRuntime.flushDeferredDeliveries();
      return;
    }

    responseStreamer.clearSession(sessionId, "session_error");
    clearPromptResponseMode(sessionId);
    assistantRunState.clearRun(sessionId, "session_error");
    await Promise.all([
      toolMessageBatcher.flushSession(sessionId, "session_error"),
      toolCallStreamer.flushSession(sessionId, "session_error"),
    ]);

    const normalizedMessage = message.trim() || t("common.unknown_error");
    const truncatedMessage =
      normalizedMessage.length > 3500
        ? `${normalizedMessage.slice(0, 3497)}...`
        : normalizedMessage;

    await botInstance.api
      .sendMessage(chatIdInstance, t("bot.session_error", { message: truncatedMessage }))
      .catch((err) => {
        logger.error("[Bot] Failed to send session.error message:", err);
      });

    foregroundSessionState.markIdle(sessionId);
    await scheduledTaskRuntime.flushDeferredDeliveries();
  });

  summaryAggregator.setOnSessionRetry(async ({ sessionId, message }) => {
    if (!botInstance || !chatIdInstance) {
      return;
    }

    const currentSession = getCurrentSession();
    if (!currentSession || currentSession.id !== sessionId) {
      return;
    }

    const normalizedMessage = message.trim() || t("common.unknown_error");
    const truncatedMessage =
      normalizedMessage.length > 3500
        ? `${normalizedMessage.slice(0, 3497)}...`
        : normalizedMessage;

    const retryMessage = t("bot.session_retry", { message: truncatedMessage });
    toolCallStreamer.replaceByPrefix(sessionId, SESSION_RETRY_PREFIX, retryMessage);
  });

  summaryAggregator.setOnSessionDiff(async (_sessionId, diffs) => {
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
    if (!pinnedMessageManager.isInitialized()) {
      return;
    }
    pinnedMessageManager.addFileChange(change);
  });

  pinnedMessageManager.setOnKeyboardUpdate(async (tokensUsed, tokensLimit) => {
    try {
      logger.debug(`[Bot] Updating keyboard with context: ${tokensUsed}/${tokensLimit}`);
      keyboardManager.updateContext(tokensUsed, tokensLimit);
      // Don't send automatic keyboard updates - keyboard will update naturally with user messages
    } catch (err) {
      logger.error("[Bot] Error updating keyboard context:", err);
    }
  });

  logger.info(`[Bot] Subscribing to OpenCode events for project: ${directory}`);
  subscribeToEvents(directory, (event) => {
    const attached = attachManager.getSnapshot();
    const eventSessionId = getEventSessionId(event);
    if (attached && eventSessionId === attached.sessionId && shouldMarkAttachedBusyFromEvent(event)) {
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

    summaryAggregator.processEvent(event);
  }).catch((err) => {
    logger.error("Failed to subscribe to events:", err);
  });
}

export function createBot(): Bot<Context> {
  clearAllInteractionState("bot_startup");
  sessionCompletionTasks.clear();
  attachManager.clear("bot_startup");
  assistantRunState.clearAll("bot_startup");

  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  const botOptions: ConstructorParameters<typeof Bot<Context>>[1] = {};

  if (config.telegram.apiRoot || config.telegram.proxySecret) {
    botOptions.client = botOptions.client ?? {};
    if (config.telegram.apiRoot) {
      botOptions.client.apiRoot = config.telegram.apiRoot;
      logger.info(`[Bot] Using custom Telegram API root: ${config.telegram.apiRoot}`);
    }
    if (config.telegram.proxySecret) {
      // Inject the shared-secret header via a custom fetch wrapper instead of
      // baseFetchConfig.headers, because grammY's client spreads
      // `{...baseFetchConfig, ...config}` and the per-request config.headers
      // (Content-Type/Length) wipes out anything we put on baseFetchConfig.
      // Using plain-object headers merge (not the Headers class) so this stays
      // compatible with node-fetch v2's init shape (grammY's default shim on
      // Node) and we don't need @types/node-fetch or DOM lib for HeadersInit.
      const proxySecret = config.telegram.proxySecret;
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any
      const nodeFetch = require("node-fetch") as any;
      botOptions.client.fetch = (((url: unknown, init: Record<string, unknown> | undefined) => {
        const existing = (init?.headers as Record<string, string> | undefined) ?? {};
        const merged = { ...existing, "X-Proxy-Secret": proxySecret };
        return nodeFetch(url, { ...(init ?? {}), headers: merged });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any);
      logger.info(`[Bot] Sending X-Proxy-Secret header to Telegram API root`);
    }
  }

  if (config.telegram.proxyUrl) {
    const proxyUrl = config.telegram.proxyUrl;
    let agent;

    if (proxyUrl.startsWith("socks")) {
      agent = new SocksProxyAgent(proxyUrl);
      logger.info(`[Bot] Using SOCKS proxy: ${proxyUrl.replace(/\/\/.*@/, "//***@")}`);
    } else {
      agent = new HttpsProxyAgent(proxyUrl);
      logger.info(`[Bot] Using HTTP/HTTPS proxy: ${proxyUrl.replace(/\/\/.*@/, "//***@")}`);
    }

    botOptions.client = {
      baseFetchConfig: {
        agent,
        compress: true,
      },
    };
  }

  const bot = new Bot(config.telegram.token, botOptions);
  botInstance = bot;
  chatIdInstance = config.telegram.allowedUserId;

  // Heartbeat for diagnostics: verify the event loop is not blocked
  let heartbeatCounter = 0;
  heartbeatTimer = setInterval(() => {
    heartbeatCounter++;
    if (heartbeatCounter % 6 === 0) {
      // Log every 30 seconds (5 sec * 6)
      logger.debug(`[Bot] Heartbeat #${heartbeatCounter} - event loop alive`);
    }
  }, 5000);

  // Log all API calls for diagnostics
  let lastGetUpdatesTime = Date.now();
  bot.api.config.use(async (prev, method, payload, signal) => {
    if (method === "getUpdates") {
      const now = Date.now();
      const timeSinceLast = now - lastGetUpdatesTime;
      logger.debug(`[Bot API] getUpdates called (${timeSinceLast}ms since last)`);
      lastGetUpdatesTime = now;
      return prev(method, payload, signal);
    }

    if (method === "sendMessage") {
      logger.debug(`[Bot API] sendMessage to chat ${(payload as { chat_id?: number }).chat_id}`);
    }

    return withTelegramRateLimitRetry(() => prev(method, payload, signal), {
      maxRetries: 5,
      onRetry: ({ attempt, retryAfterMs, error }) => {
        logger.warn(
          `[Bot API] Telegram rate limit on ${method}, retrying in ${retryAfterMs}ms (attempt=${attempt})`,
          error,
        );
      },
    });
  });

  bot.use((ctx, next) => {
    const hasCallbackQuery = !!ctx.callbackQuery;
    const hasMessage = !!ctx.message;
    const callbackData = ctx.callbackQuery?.data || "N/A";
    logger.debug(
      `[DEBUG] Incoming update: hasCallbackQuery=${hasCallbackQuery}, hasMessage=${hasMessage}, callbackData=${callbackData}`,
    );
    return next();
  });

  bot.use(authMiddleware);
  bot.use(ensureCommandsInitialized);
  bot.use(interactionGuardMiddleware);

  const blockMenuWhileInteractionActive = async (ctx: Context): Promise<boolean> => {
    const activeInteraction = interactionManager.getSnapshot();
    if (!activeInteraction) {
      return false;
    }

    logger.debug(
      `[Bot] Blocking menu open while interaction active: kind=${activeInteraction.kind}, expectedInput=${activeInteraction.expectedInput}`,
    );
    await ctx.reply(t("interaction.blocked.finish_current"));
    return true;
  };

  bot.command("start", startCommand);
  bot.command("help", helpCommand);
  bot.command("status", statusCommand);
  bot.command("tts", ttsCommand);
  bot.command("opencode_start", opencodeStartCommand);
  bot.command("opencode_stop", opencodeStopCommand);
  bot.command("projects", projectsCommand);
  bot.command("worktree", worktreeCommand);
  bot.command("open", openCommand);
  bot.command("sessions", sessionsCommand);
  bot.command("new", (ctx) => newCommand(ctx, { bot, ensureEventSubscription }));
  bot.command("abort", abortCommand);
  bot.command("task", taskCommand);
  bot.command("tasklist", taskListCommand);
  bot.command("rename", renameCommand);
  bot.command("commands", commandsCommand);
  bot.command("skills", skillsCommand);

  bot.on("message:text", unknownCommandMiddleware);

  bot.on("callback_query:data", async (ctx) => {
    logger.debug(`[Bot] Received callback_query:data: ${ctx.callbackQuery?.data}`);
    logger.debug(`[Bot] Callback context: from=${ctx.from?.id}, chat=${ctx.chat?.id}`);

    if (ctx.chat) {
      botInstance = bot;
      chatIdInstance = ctx.chat.id;
    }

    try {
      const handledInlineCancel = await handleInlineMenuCancel(ctx);
      if (handledInlineCancel) {
        // Clean up path index when the open-directory menu is cancelled
        clearOpenPathIndex();
      }
      const handledSession = await handleSessionSelect(ctx, { bot, ensureEventSubscription });
      const handledProject = await handleProjectSelect(ctx);
      const handledWorktree = await handleWorktreeCallback(ctx);
      const handledOpen = await handleOpenCallback(ctx);
      const handledQuestion = await handleQuestionCallback(ctx);
      const handledPermission = await handlePermissionCallback(ctx);
      const handledAgent = await handleAgentSelect(ctx);
      const handledModel = await handleModelSelect(ctx);
      const handledVariant = await handleVariantSelect(ctx);
      const handledCompactConfirm = await handleCompactConfirm(ctx);
      const handledTask = await handleTaskCallback(ctx);
      const handledTaskList = await handleTaskListCallback(ctx);
      const handledRenameCancel = await handleRenameCancel(ctx);
      const handledCommands = await handleCommandsCallback(ctx, { bot, ensureEventSubscription });
      const handledSkills = await handleSkillsCallback(ctx, { bot, ensureEventSubscription });

      logger.debug(
        `[Bot] Callback handled: inlineCancel=${handledInlineCancel}, session=${handledSession}, project=${handledProject}, worktree=${handledWorktree}, open=${handledOpen}, question=${handledQuestion}, permission=${handledPermission}, agent=${handledAgent}, model=${handledModel}, variant=${handledVariant}, compactConfirm=${handledCompactConfirm}, task=${handledTask}, taskList=${handledTaskList}, rename=${handledRenameCancel}, commands=${handledCommands}, skills=${handledSkills}`,
      );

      if (
        !handledInlineCancel &&
        !handledSession &&
        !handledProject &&
        !handledWorktree &&
        !handledOpen &&
        !handledQuestion &&
        !handledPermission &&
        !handledAgent &&
        !handledModel &&
        !handledVariant &&
        !handledCompactConfirm &&
        !handledTask &&
        !handledTaskList &&
        !handledRenameCancel &&
        !handledCommands &&
        !handledSkills
      ) {
        logger.debug("Unknown callback query:", ctx.callbackQuery?.data);
        await ctx.answerCallbackQuery({ text: t("callback.unknown_command") });
      }
    } catch (err) {
      logger.error("[Bot] Error handling callback:", err);
      clearAllInteractionState("callback_handler_error");
      await ctx.answerCallbackQuery({ text: t("callback.processing_error") }).catch(() => {});
    }
  });

  // Handle Reply Keyboard button press (agent indicator)
  bot.hears(AGENT_MODE_BUTTON_TEXT_PATTERN, async (ctx) => {
    logger.debug(`[Bot] Agent button pressed: ${ctx.message?.text}`);

    try {
      if (await blockMenuWhileInteractionActive(ctx)) {
        return;
      }

      await showAgentSelectionMenu(ctx);
    } catch (err) {
      logger.error("[Bot] Error showing agent menu:", err);
      await ctx.reply(t("error.load_agents"));
    }
  });

  // Handle Reply Keyboard button press (model selector)
  // Model button text is produced by formatModelForButton() and always starts with "🤖 ".
  bot.hears(MODEL_BUTTON_TEXT_PATTERN, async (ctx) => {
    logger.debug(`[Bot] Model button pressed: ${ctx.message?.text}`);

    try {
      if (await blockMenuWhileInteractionActive(ctx)) {
        return;
      }

      await showModelSelectionMenu(ctx);
    } catch (err) {
      logger.error("[Bot] Error showing model menu:", err);
      await ctx.reply(t("error.load_models"));
    }
  });

  // Handle Reply Keyboard button press (context button)
  bot.hears(/^📊(?:\s|$)/, async (ctx) => {
    logger.debug(`[Bot] Context button pressed: ${ctx.message?.text}`);

    try {
      if (await blockMenuWhileInteractionActive(ctx)) {
        return;
      }

      await handleContextButtonPress(ctx);
    } catch (err) {
      logger.error("[Bot] Error handling context button:", err);
      await ctx.reply(t("error.context_button"));
    }
  });

  // Handle Reply Keyboard button press (variant selector)
  // Keep support for both legacy "💭" and current "💡" prefix.
  bot.hears(VARIANT_BUTTON_TEXT_PATTERN, async (ctx) => {
    logger.debug(`[Bot] Variant button pressed: ${ctx.message?.text}`);

    try {
      if (await blockMenuWhileInteractionActive(ctx)) {
        return;
      }

      await showVariantSelectionMenu(ctx);
    } catch (err) {
      logger.error("[Bot] Error showing variant menu:", err);
      await ctx.reply(t("error.load_variants"));
    }
  });

  bot.on("message:text", async (ctx, next) => {
    const text = ctx.message?.text;
    if (text) {
      const isCommand = text.startsWith("/");
      logger.debug(
        `[Bot] Received text message: ${isCommand ? `command="${text}"` : `prompt (length=${text.length})`}, chatId=${ctx.chat.id}`,
      );
    }
    await next();
  });

  // Remove any previously set global commands to prevent unauthorized users from seeing them
  safeBackgroundTask({
    taskName: "bot.clearGlobalCommands",
    task: async () => {
      try {
        await Promise.all([
          bot.api.setMyCommands([], { scope: { type: "default" } }),
          bot.api.setMyCommands([], { scope: { type: "all_private_chats" } }),
        ]);
        return { success: true as const };
      } catch (error) {
        return { success: false as const, error };
      }
    },
    onSuccess: (result) => {
      if (result.success) {
        logger.debug("[Bot] Cleared global commands (default and all_private_chats scopes)");
        return;
      }

      logger.warn("[Bot] Could not clear global commands:", result.error);
    },
  });

  // Voice and audio message handlers (STT transcription -> prompt)
  const voicePromptDeps = { bot, ensureEventSubscription };

  safeBackgroundTask({
    taskName: "bot.restoreFollowedSession",
    task: () =>
      restoreAttachedCurrentSession({
        bot,
        chatId: config.telegram.allowedUserId,
        ensureEventSubscription,
      }),
  });

  bot.on("message:voice", async (ctx) => {
    logger.debug(`[Bot] Received voice message, chatId=${ctx.chat.id}`);
    botInstance = bot;
    chatIdInstance = ctx.chat.id;
    await handleVoiceMessage(ctx, voicePromptDeps);
  });

  bot.on("message:audio", async (ctx) => {
    logger.debug(`[Bot] Received audio message, chatId=${ctx.chat.id}`);
    botInstance = bot;
    chatIdInstance = ctx.chat.id;
    await handleVoiceMessage(ctx, voicePromptDeps);
  });

  // Photo message handler
  bot.on("message:photo", async (ctx) => {
    logger.debug(`[Bot] Received photo message, chatId=${ctx.chat.id}`);

    const photos = ctx.message?.photo;
    if (!photos || photos.length === 0) {
      return;
    }

    const caption = ctx.message.caption || "";

    try {
      // Get the largest photo (last element in array)
      const largestPhoto = photos[photos.length - 1];

      // Check model capabilities
      const storedModel = getStoredModel();
      const capabilities = await getModelCapabilities(storedModel.providerID, storedModel.modelID);

      if (!supportsInput(capabilities, "image")) {
        logger.warn(
          `[Bot] Model ${storedModel.providerID}/${storedModel.modelID} doesn't support image input`,
        );
        await ctx.reply(t("bot.photo_model_no_image"));

        // Fall back to caption-only if present
        if (caption.trim().length > 0) {
          botInstance = bot;
          chatIdInstance = ctx.chat.id;
          const promptDeps = { bot, ensureEventSubscription };
          await processUserPrompt(ctx, caption, promptDeps);
        }
        return;
      }

      // Download photo
      await ctx.reply(t("bot.photo_downloading"));
      const downloadedFile = await downloadTelegramFile(ctx.api, largestPhoto.file_id);

      // Convert to data URI (Telegram always converts photos to JPEG)
      const dataUri = toDataUri(downloadedFile.buffer, "image/jpeg");

      // Create file part
      const filePart: FilePartInput = {
        type: "file",
        mime: "image/jpeg",
        filename: "photo.jpg",
        url: dataUri,
      };

      logger.info(`[Bot] Sending photo (${downloadedFile.buffer.length} bytes) with prompt`);

      botInstance = bot;
      chatIdInstance = ctx.chat.id;

      // Send via processUserPrompt with file part
      const promptDeps = { bot, ensureEventSubscription };
      await processUserPrompt(ctx, caption, promptDeps, [filePart]);
    } catch (err) {
      logger.error("[Bot] Error handling photo message:", err);
      await ctx.reply(t("bot.photo_download_error"));
    }
  });

  // Document message handler (PDF and text files)
  bot.on("message:document", async (ctx) => {
    logger.debug(`[Bot] Received document message, chatId=${ctx.chat.id}`);
    botInstance = bot;
    chatIdInstance = ctx.chat.id;
    const deps = { bot, ensureEventSubscription };
    await handleDocumentMessage(ctx, deps);
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message?.text;
    if (!text) {
      return;
    }

    botInstance = bot;
    chatIdInstance = ctx.chat.id;

    if (text.startsWith("/")) {
      return;
    }

    if (questionManager.isActive()) {
      await handleQuestionTextAnswer(ctx);
      return;
    }

    const handledTask = await handleTaskTextInput(ctx);
    if (handledTask) {
      return;
    }

    const handledRename = await handleRenameTextAnswer(ctx);
    if (handledRename) {
      return;
    }

    const promptDeps = { bot, ensureEventSubscription };
    const handledCommandArgs = await handleCommandTextArguments(ctx, promptDeps);
    if (handledCommandArgs) {
      return;
    }

    const handledSkillArgs = await handleSkillTextArguments(ctx, promptDeps);
    if (handledSkillArgs) {
      return;
    }

    await processUserPrompt(ctx, text, promptDeps);

    logger.debug("[Bot] message:text handler completed (prompt sent in background)");
  });

  bot.catch((err) => {
    logger.error("[Bot] Unhandled error in bot:", err);
    clearAllInteractionState("bot_unhandled_error");
    if (err.ctx) {
      logger.error(
        "[Bot] Error context - update type:",
        err.ctx.update ? Object.keys(err.ctx.update) : "unknown",
      );
    }
  });

  return bot;
}

export function cleanupBotRuntime(reason: string): void {
  stopEventListening();
  summaryAggregator.clear();
  responseStreamer.clearAll(reason);
  toolCallStreamer.clearAll(reason);
  toolMessageBatcher.clearAll(reason);
  sessionCompletionTasks.clear();
  assistantRunState.clearAll(reason);

  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  botInstance = null;
  chatIdInstance = null;
}
