import { Bot, Context, InputFile, NextFunction } from "grammy";
import { promises as fs } from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { config, envFilePath } from "../config.js";
import { authMiddleware } from "./middleware/auth.js";
import { BOT_COMMANDS } from "./commands/definitions.js";
import { startCommand } from "./commands/start.js";
import { helpCommand } from "./commands/help.js";
import { statusCommand } from "./commands/status.js";
import { MODEL_BUTTON_TEXT_PATTERN, VARIANT_BUTTON_TEXT_PATTERN } from "./message-patterns.js";
import { sessionsCommand, handleSessionSelect } from "./commands/sessions.js";
import { newCommand } from "./commands/new.js";
import { projectsCommand, handleProjectSelect } from "./commands/projects.js";
import { stopCommand } from "./commands/stop.js";
import { opencodeStartCommand } from "./commands/opencode-start.js";
import { opencodeStopCommand } from "./commands/opencode-stop.js";
import { handleAgentCommand } from "./commands/agent.js";
import { handleModelCommand } from "./commands/model.js";
import {
  handleQuestionCallback,
  showCurrentQuestion,
  handleQuestionTextAnswer,
} from "./handlers/question.js";
import { handlePermissionCallback, showPermissionRequest } from "./handlers/permission.js";
import { handleAgentSelect, showAgentSelectionMenu } from "./handlers/agent.js";
import { handleModelSelect, showModelSelectionMenu } from "./handlers/model.js";
import { handleVariantSelect, showVariantSelectionMenu } from "./handlers/variant.js";
import {
  handleContextButtonPress,
  handleCompactConfirm,
  handleCompactCancel,
} from "./handlers/context.js";
import { questionManager } from "../question/manager.js";
import { permissionManager } from "../permission/manager.js";
import { keyboardManager } from "../keyboard/manager.js";
import { stopEventListening, subscribeToEvents } from "../opencode/events.js";
import { summaryAggregator } from "../summary/aggregator.js";
import { formatSummary, formatToolInfo } from "../summary/formatter.js";
import { opencodeClient } from "../opencode/client.js";
import { clearSession, getCurrentSession, setCurrentSession } from "../session/manager.js";
import { ingestSessionInfoForCache } from "../session/cache-manager.js";
import { getCurrentProject } from "../settings/manager.js";
import { getStoredAgent } from "../agent/manager.js";
import { getStoredModel } from "../model/manager.js";
import { formatVariantForButton } from "../variant/manager.js";
import { createMainKeyboard } from "./utils/keyboard.js";
import { logger } from "../utils/logger.js";
import { safeBackgroundTask } from "../utils/safe-background-task.js";
import { formatErrorDetails } from "../utils/error-format.js";
import { pinnedMessageManager } from "../pinned/manager.js";
import { saveTelegramFile, transcribeAudioFile } from "../media/manager.js";
import { t } from "../i18n/index.js";

let botInstance: Bot<Context> | null = null;
let chatIdInstance: number | null = null;
let commandsInitialized = false;

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
    logger.info(`[Bot] Commands initialized for authorized user (chat_id=${ctx.chat.id})`);
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

  summaryAggregator.setOnComplete(async (sessionId, messageText) => {
    if (!botInstance || !chatIdInstance) {
      logger.error("Bot or chat ID not available for sending message");
      return;
    }

    const currentSession = getCurrentSession();
    if (currentSession?.id !== sessionId) {
      return;
    }

    try {
      const parts = formatSummary(messageText);

      logger.debug(
        `[Bot] Sending completed message to Telegram (chatId=${chatIdInstance}, parts=${parts.length})`,
      );
      for (let i = 0; i < parts.length; i++) {
        const isLastPart = i === parts.length - 1;
        if (isLastPart && keyboardManager.isInitialized()) {
          // Attach updated keyboard to the last message part (only if initialized)
          const keyboard = keyboardManager.getKeyboard();
          if (keyboard) {
            await botInstance.api.sendMessage(chatIdInstance, parts[i], {
              reply_markup: keyboard,
            });
          } else {
            await botInstance.api.sendMessage(chatIdInstance, parts[i]);
          }
        } else {
          await botInstance.api.sendMessage(chatIdInstance, parts[i]);
        }
      }
    } catch (err) {
      logger.error("Failed to send message to Telegram:", err);
      // Stop processing events after critical error to prevent infinite loop
      logger.error("[Bot] CRITICAL: Stopping event processing due to error");
      summaryAggregator.clear();
    }
  });

  summaryAggregator.setOnTool(async (toolInfo) => {
    if (!botInstance || !chatIdInstance) {
      logger.error("Bot or chat ID not available for sending tool notification");
      return;
    }

    const currentSession = getCurrentSession();
    const sessionId = summaryAggregator["currentSessionId"];
    if (!currentSession || currentSession.id !== sessionId) {
      return;
    }

    try {
      const message = formatToolInfo(toolInfo);
      if (message) {
        await botInstance.api.sendMessage(chatIdInstance, message);
      }
    } catch (err) {
      logger.error("Failed to send tool notification to Telegram:", err);
    }
  });

  summaryAggregator.setOnToolFile(async (fileData) => {
    if (!botInstance || !chatIdInstance) {
      logger.error("Bot or chat ID not available for sending file");
      return;
    }

    const currentSession = getCurrentSession();
    if (!currentSession) {
      return;
    }

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const tempDir = path.join(__dirname, "..", ".tmp");

    try {
      logger.debug(
        `[Bot] Sending code file: ${fileData.filename} (${fileData.buffer.length} bytes)`,
      );

      await fs.mkdir(tempDir, { recursive: true });

      const tempFilePath = path.join(tempDir, fileData.filename);
      await fs.writeFile(tempFilePath, fileData.buffer);

      await botInstance.api.sendDocument(chatIdInstance, new InputFile(tempFilePath), {
        caption: fileData.caption,
      });

      await fs.unlink(tempFilePath);
      logger.debug(`[Bot] Temporary file deleted: ${fileData.filename}`);
    } catch (err) {
      logger.error("Failed to send file to Telegram:", err);
    }
  });

  summaryAggregator.setOnQuestion(async (questions, requestID) => {
    if (!botInstance || !chatIdInstance) {
      logger.error("Bot or chat ID not available for showing questions");
      return;
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

    questionManager.clear();
  });

  summaryAggregator.setOnPermission(async (request) => {
    if (!botInstance || !chatIdInstance) {
      logger.error("Bot or chat ID not available for showing permission request");
      return;
    }

    logger.info(
      `[Bot] Received permission request from agent: type=${request.permission}, requestID=${request.id}`,
    );
    await showPermissionRequest(botInstance.api, chatIdInstance, request);
  });

  summaryAggregator.setOnThinking(async () => {
    if (!botInstance || !chatIdInstance) {
      return;
    }

    logger.debug("[Bot] Agent started thinking");

    await botInstance.api.sendMessage(chatIdInstance, t("bot.thinking")).catch((err) => {
      logger.error("[Bot] Failed to send thinking message:", err);
    });
  });

  summaryAggregator.setOnTokens(async (tokens) => {
    if (!pinnedMessageManager.isInitialized()) {
      return;
    }

    try {
      logger.debug(`[Bot] Received tokens: input=${tokens.input}, output=${tokens.output}`);

      // Update keyboardManager SYNCHRONOUSLY before any await
      // This ensures keyboard has correct context when onComplete sends the reply
      const contextSize = tokens.input + tokens.cacheRead;
      const contextLimit = pinnedMessageManager.getContextLimit();
      if (contextLimit > 0) {
        keyboardManager.updateContext(contextSize, contextLimit);
      }

      await pinnedMessageManager.onMessageComplete(tokens);
    } catch (err) {
      logger.error("[Bot] Error updating pinned message with tokens:", err);
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

async function isSessionBusy(sessionId: string, directory: string): Promise<boolean> {
  try {
    const { data, error } = await opencodeClient.session.status({ directory });

    if (error || !data) {
      logger.warn("[Bot] Failed to check session status before prompt:", error);
      return false;
    }

    const sessionStatus = (data as Record<string, { type?: string }>)[sessionId];
    if (!sessionStatus) {
      return false;
    }

    logger.debug(`[Bot] Current session status before prompt: ${sessionStatus.type || "unknown"}`);
    return sessionStatus.type === "busy";
  } catch (err) {
    logger.warn("[Bot] Error checking session status before prompt:", err);
    return false;
  }
}

async function resetMismatchedSessionContext(): Promise<void> {
  stopEventListening();
  summaryAggregator.clear();
  questionManager.clear();
  permissionManager.clear();
  clearSession();
  keyboardManager.clearContext();

  if (!pinnedMessageManager.isInitialized()) {
    return;
  }

  try {
    await pinnedMessageManager.clear();
  } catch (err) {
    logger.error("[Bot] Failed to clear pinned message during session reset:", err);
  }
}

export function createBot(): Bot<Context> {
  const bot = new Bot(config.telegram.token);

  // Heartbeat for diagnostics: verify the event loop is not blocked
  let heartbeatCounter = 0;
  setInterval(() => {
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
    } else if (method === "sendMessage") {
      logger.debug(`[Bot API] sendMessage to chat ${(payload as { chat_id?: number }).chat_id}`);
    }
    return prev(method, payload, signal);
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

  bot.command("start", startCommand);
  bot.command("help", helpCommand);
  bot.command("status", statusCommand);
  bot.command("opencode_start", opencodeStartCommand);
  bot.command("opencode_stop", opencodeStopCommand);
  bot.command("projects", projectsCommand);
  bot.command("sessions", sessionsCommand);
  bot.command("new", newCommand);
  bot.command("agent", handleAgentCommand);
  bot.command("model", handleModelCommand);
  bot.command("stop", stopCommand);

  bot.on("callback_query:data", async (ctx) => {
    logger.debug(`[Bot] Received callback_query:data: ${ctx.callbackQuery?.data}`);
    logger.debug(`[Bot] Callback context: from=${ctx.from?.id}, chat=${ctx.chat?.id}`);

    try {
      const handledSession = await handleSessionSelect(ctx);
      const handledProject = await handleProjectSelect(ctx);
      const handledQuestion = await handleQuestionCallback(ctx);
      const handledPermission = await handlePermissionCallback(ctx);
      const handledAgent = await handleAgentSelect(ctx);
      const handledModel = await handleModelSelect(ctx);
      const handledVariant = await handleVariantSelect(ctx);
      const handledCompactConfirm = await handleCompactConfirm(ctx);
      const handledCompactCancel = await handleCompactCancel(ctx);

      logger.debug(
        `[Bot] Callback handled: session=${handledSession}, project=${handledProject}, question=${handledQuestion}, permission=${handledPermission}, agent=${handledAgent}, model=${handledModel}, variant=${handledVariant}, compact=${handledCompactConfirm || handledCompactCancel}`,
      );

      if (
        !handledSession &&
        !handledProject &&
        !handledQuestion &&
        !handledPermission &&
        !handledAgent &&
        !handledModel &&
        !handledVariant &&
        !handledCompactConfirm &&
        !handledCompactCancel
      ) {
        logger.debug("Unknown callback query:", ctx.callbackQuery?.data);
        await ctx.answerCallbackQuery({ text: t("callback.unknown_command") });
      }
    } catch (err) {
      logger.error("[Bot] Error handling callback:", err);
      await ctx.answerCallbackQuery({ text: t("callback.processing_error") }).catch(() => {});
    }
  });

  // Handle Reply Keyboard button press (agent mode indicator)
  bot.hears(/^(📋|🛠️|💬|🔍|📝|📄|📦|🤖) \w+ Mode$/, async (ctx) => {
    logger.debug(`[Bot] Agent mode button pressed: ${ctx.message?.text}`);

    try {
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
        logger.info("[Bot] Cleared global commands (default and all_private_chats scopes)");
        return;
      }

      logger.warn("[Bot] Could not clear global commands:", result.error);
    },
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message?.text;
    if (!text) {
      return;
    }

    if (text.startsWith("/")) {
      return;
    }

    if (questionManager.isActive()) {
      await handleQuestionTextAnswer(ctx);
      return;
    }

    const currentProject = getCurrentProject();
    if (!currentProject) {
      await ctx.reply(t("bot.project_not_selected"));
      return;
    }

    botInstance = bot;
    chatIdInstance = ctx.chat.id;

    // Initialize pinned message manager if not already
    if (!pinnedMessageManager.isInitialized()) {
      pinnedMessageManager.initialize(bot.api, ctx.chat.id);
    }

    // Initialize keyboard manager if not already
    keyboardManager.initialize(bot.api, ctx.chat.id);

    let currentSession = getCurrentSession();

    if (currentSession && currentSession.directory !== currentProject.worktree) {
      logger.warn(
        `[Bot] Session/project mismatch detected. sessionDirectory=${currentSession.directory}, projectDirectory=${currentProject.worktree}. Resetting session context.`,
      );
      await resetMismatchedSessionContext();
      await ctx.reply(t("bot.session_reset_project_mismatch"));
      return;
    }

    if (!currentSession) {
      await ctx.reply(t("bot.creating_session"));

      const { data: session, error } = await opencodeClient.session.create({
        directory: currentProject.worktree,
      });

      if (error || !session) {
        await ctx.reply(t("bot.create_session_error"));
        return;
      }

      logger.info(
        `[Bot] Created new session: id=${session.id}, title="${session.title}", project=${currentProject.worktree}`,
      );

      currentSession = {
        id: session.id,
        title: session.title,
        directory: currentProject.worktree,
      };

      setCurrentSession(currentSession);
      await ingestSessionInfoForCache(session);

      // Create pinned message for new session
      try {
        await pinnedMessageManager.onSessionChange(session.id, session.title);
      } catch (err) {
        logger.error("[Bot] Error creating pinned message for new session:", err);
      }

      const currentAgent = getStoredAgent();
      const currentModel = getStoredModel();
      const contextInfo = pinnedMessageManager.getContextInfo();
      const variantName = formatVariantForButton(currentModel.variant || "default");
      const keyboard = createMainKeyboard(
        currentAgent,
        currentModel,
        contextInfo ?? undefined,
        variantName,
      );

      await ctx.reply(t("bot.session_created", { title: session.title }), {
        reply_markup: keyboard,
      });
    } else {
      logger.info(
        `[Bot] Using existing session: id=${currentSession.id}, title="${currentSession.title}"`,
      );

      // Ensure pinned message exists for existing session
      if (!pinnedMessageManager.getState().messageId) {
        try {
          await pinnedMessageManager.onSessionChange(currentSession.id, currentSession.title);
        } catch (err) {
          logger.error("[Bot] Error creating pinned message for existing session:", err);
        }
      }
    }

    await ensureEventSubscription(currentSession.directory);

    summaryAggregator.setSession(currentSession.id);
    summaryAggregator.setBotAndChatId(bot, ctx.chat.id);

    const sessionIsBusy = await isSessionBusy(currentSession.id, currentSession.directory);
    if (sessionIsBusy) {
      logger.info(`[Bot] Ignoring new prompt: session ${currentSession.id} is busy`);
      await ctx.reply(t("bot.session_busy"));
      return;
    }

    try {
      const currentAgent = getStoredAgent();
      const storedModel = getStoredModel();

      const promptOptions: {
        sessionID: string;
        directory: string;
        parts: Array<{ type: "text"; text: string }>;
        model?: { providerID: string; modelID: string };
        agent?: string;
        variant?: string;
      } = {
        sessionID: currentSession.id,
        directory: currentSession.directory,
        parts: [{ type: "text", text }],
        agent: currentAgent,
      };

      // Use stored model (from settings or config)
      if (storedModel.providerID && storedModel.modelID) {
        promptOptions.model = {
          providerID: storedModel.providerID,
          modelID: storedModel.modelID,
        };

        // Add variant if specified
        if (storedModel.variant) {
          promptOptions.variant = storedModel.variant;
        }
      }

      logger.info(`[Bot] Calling session.prompt (fire-and-forget) with agent=${currentAgent}...`);

      // CRITICAL: DO NOT wait for session.prompt to complete.
      // If we wait, the handler will not finish and grammY will not call getUpdates,
      // which blocks receiving button callback_query updates.
      // The processing result will arrive via SSE events.
      safeBackgroundTask({
        taskName: "session.prompt",
        task: () => opencodeClient.session.prompt(promptOptions),
        onSuccess: ({ error }) => {
          if (error) {
            const details = formatErrorDetails(error);
            logger.error("OpenCode API error:", error);
            // Send the error via API directly because ctx is no longer available
            void bot.api
              .sendMessage(
                ctx.chat.id,
                t("bot.prompt_send_error_detailed", {
                  details,
                }),
              )
              .catch(() => {});
            return;
          }

          logger.info("[Bot] session.prompt completed");
        },
        onError: (error) => {
          logger.error("[Bot] session.prompt background task failed:", error);
          void bot.api.sendMessage(ctx.chat.id, t("bot.prompt_send_error")).catch(() => {});
        },
      });
    } catch (err) {
      logger.error("Error in prompt handler:", err);
      await ctx.reply(t("error.generic"));
    }

    logger.debug("[Bot] message:text handler completed (prompt sent in background)");
  });

  async function handleMediaMessage(
    ctx: Context & {
      message?: {
        photo?: { file_id: string }[];
        document?: { file_id: string; file_name?: string };
        video?: { file_id: string; file_name?: string };
        audio?: { file_id: string; file_name?: string };
        voice?: { file_id: string };
        caption?: string;
      };
    },
    mediaType: "photo" | "document" | "video" | "audio" | "voice",
  ): Promise<void> {
    const message = ctx.message;
    if (!message || !ctx.chat) return;

    let fileId: string | undefined;
    let fileName = `file_${Date.now()}`;

    switch (mediaType) {
      case "photo":
        const photos = message.photo;
        if (photos && photos.length > 0) {
          fileId = photos[photos.length - 1].file_id;
          fileName = `photo_${Date.now()}.jpg`;
        }
        break;
      case "document":
        if (message.document) {
          fileId = message.document.file_id;
          fileName = message.document.file_name || `document_${Date.now()}`;
        }
        break;
      case "video":
        if (message.video) {
          fileId = message.video.file_id;
          fileName = message.video.file_name || `video_${Date.now()}.mp4`;
        }
        break;
      case "audio":
        if (message.audio) {
          fileId = message.audio.file_id;
          fileName = message.audio.file_name || `audio_${Date.now()}.mp3`;
        }
        break;
      case "voice":
        if (message.voice) {
          fileId = message.voice.file_id;
          fileName = `voice_${Date.now()}.ogg`;
        }
        break;
    }

    if (!fileId) {
      await ctx.reply(t("bot.media_error"));
      return;
    }

    const caption = message.caption || "";

    const currentProject = getCurrentProject();
    if (!currentProject) {
      await ctx.reply(t("bot.project_not_selected"));
      return;
    }

    botInstance = bot;
    chatIdInstance = ctx.chat.id;

    if (!pinnedMessageManager.isInitialized()) {
      pinnedMessageManager.initialize(bot.api, ctx.chat.id);
    }

    keyboardManager.initialize(bot.api, ctx.chat.id);

    let currentSession = getCurrentSession();

    if (currentSession && currentSession.directory !== currentProject.worktree) {
      logger.warn(
        `[Bot] Session/project mismatch detected. sessionDirectory=${currentSession.directory}, projectDirectory=${currentProject.worktree}. Resetting session context.`,
      );
      await resetMismatchedSessionContext();
      await ctx.reply(t("bot.session_reset_project_mismatch"));
      return;
    }

    if (!currentSession) {
      await ctx.reply(t("bot.creating_session"));

      const { data: session, error } = await opencodeClient.session.create({
        directory: currentProject.worktree,
      });

      if (error || !session) {
        await ctx.reply(t("bot.create_session_error"));
        return;
      }

      logger.info(
        `[Bot] Created new session: id=${session.id}, title="${session.title}", project=${currentProject.worktree}`,
      );

      currentSession = {
        id: session.id,
        title: session.title,
        directory: currentProject.worktree,
      };

      setCurrentSession(currentSession);
      await ingestSessionInfoForCache(session);

      try {
        await pinnedMessageManager.onSessionChange(session.id, session.title);
      } catch (err) {
        logger.error("[Bot] Error creating pinned message for new session:", err);
      }

      const currentAgent = getStoredAgent();
      const currentModel = getStoredModel();
      const contextInfo = pinnedMessageManager.getContextInfo();
      const variantName = formatVariantForButton(currentModel.variant || "default");
      const keyboard = createMainKeyboard(
        currentAgent,
        currentModel,
        contextInfo ?? undefined,
        variantName,
      );

      await ctx.reply(t("bot.session_created", { title: session.title }), {
        reply_markup: keyboard,
      });
    } else {
      logger.info(
        `[Bot] Using existing session: id=${currentSession.id}, title="${currentSession.title}"`,
      );

      if (!pinnedMessageManager.getState().messageId) {
        try {
          await pinnedMessageManager.onSessionChange(currentSession.id, currentSession.title);
        } catch (err) {
          logger.error("[Bot] Error creating pinned message for existing session:", err);
        }
      }
    }

    await ensureEventSubscription(currentSession.directory);

    summaryAggregator.setSession(currentSession.id);
    summaryAggregator.setBotAndChatId(bot, ctx.chat.id);

    const sessionIsBusy = await isSessionBusy(currentSession.id, currentSession.directory);
    if (sessionIsBusy) {
      logger.info(`[Bot] Ignoring new prompt: session ${currentSession.id} is busy`);
      await ctx.reply(t("bot.session_busy"));
      return;
    }

    try {
      const saved = await saveTelegramFile(ctx.api, fileId, fileName);

      const currentAgent = getStoredAgent();
      const storedModel = getStoredModel();

      const parts: Array<
        | { type: "text"; text: string }
        | { type: "file"; url: string; mime: string; filename?: string }
      > = [];

      if (caption) {
        parts.push({ type: "text", text: caption });
      }

      // Handle voice messages with optional transcription
      if (mediaType === "voice") {
        if (config.transcription.command && config.transcription.command !== "false") {
          await ctx.reply(t("bot.voice_transcribing"));
        }
        const transcription = await transcribeAudioFile(saved.filePath);
        if (transcription.success && transcription.transcript) {
          parts.push({
            type: "text",
            text: `[voice message, auto-transcribed by Telegram bot] ${transcription.transcript}`,
          });
        } else if (transcription.notConfigured) {
          // TRANSCRIBE_VOICE_COMMAND not set — same message to user AND LLM
          const msg = t("bot.voice_not_configured", {
            filePath: saved.filePath,
            envPath: envFilePath,
          });
          await ctx.reply(msg, { parse_mode: "Markdown" });
          parts.push({ type: "text", text: msg });
        } else {
          // Command failed — same message to user AND LLM
          logger.info(`[Bot] Transcription failed: ${transcription.error}`);
          const failureDetails = transcription.details || transcription.error || "unknown";
          const msg = t("bot.voice_transcription_failed", {
            filePath: saved.filePath,
            envPath: envFilePath,
            details: failureDetails,
          });
          await ctx.reply(msg, { parse_mode: "Markdown" });
          parts.push({ type: "text", text: msg });
        }
      } else {
        parts.push({
          type: "file",
          url: saved.fileUrl,
          mime: saved.mimeType,
          filename: saved.fileName,
        });
      }

      const promptOptions: {
        sessionID: string;
        directory: string;
        parts: typeof parts;
        model?: { providerID: string; modelID: string };
        agent?: string;
        variant?: string;
      } = {
        sessionID: currentSession.id,
        directory: currentSession.directory,
        parts,
        agent: currentAgent,
      };

      if (storedModel.providerID && storedModel.modelID) {
        promptOptions.model = {
          providerID: storedModel.providerID,
          modelID: storedModel.modelID,
        };

        if (storedModel.variant) {
          promptOptions.variant = storedModel.variant;
        }
      }

      logger.info(
        `[Bot] Calling session.prompt with media: ${saved.fileName}, agent=${currentAgent}...`,
      );

      const chatId = ctx.chat.id;

      safeBackgroundTask({
        taskName: "session.prompt",
        task: () => opencodeClient.session.prompt(promptOptions),
        onSuccess: ({ error }) => {
          if (error) {
            const details = formatErrorDetails(error);
            logger.error("OpenCode API error:", error);
            void bot.api
              .sendMessage(chatId, t("bot.prompt_send_error_detailed", { details }))
              .catch(() => {});
            return;
          }

          logger.info("[Bot] session.prompt completed");
        },
        onError: (error) => {
          logger.error("[Bot] session.prompt background task failed:", error);
          void bot.api.sendMessage(chatId, t("bot.prompt_send_error")).catch(() => {});
        },
      });
    } catch (err) {
      logger.error("[Bot] Error handling media message:", err);
      await ctx.reply(t("bot.media_error"));
    }
  }

  bot.on("message:photo", (ctx) => handleMediaMessage(ctx, "photo"));
  bot.on("message:document", (ctx) => handleMediaMessage(ctx, "document"));
  bot.on("message:video", (ctx) => handleMediaMessage(ctx, "video"));
  bot.on("message:audio", (ctx) => handleMediaMessage(ctx, "audio"));
  bot.on("message:voice", (ctx) => handleMediaMessage(ctx, "voice"));

  bot.catch((err) => {
    logger.error("[Bot] Unhandled error in bot:", err);
    if (err.ctx) {
      logger.error(
        "[Bot] Error context - update type:",
        err.ctx.update ? Object.keys(err.ctx.update) : "unknown",
      );
    }
  });

  return bot;
}
