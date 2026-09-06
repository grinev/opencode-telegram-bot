import { Bot, Context } from "grammy";
import type { FilePartInput, TextPartInput } from "@opencode-ai/sdk/v2";
import type { Model } from "@opencode-ai/sdk/v2";
import { opencodeClient } from "../../opencode/client.js";
import {
  clearSession,
  getCurrentSession,
  setCurrentSession,
} from "../../app/services/session-service.js";
import { ingestSessionInfoForCache } from "../../app/services/session-cache-service.js";
import { getCurrentProject, getTtsMode } from "../../app/stores/settings-store.js";
import { getStoredAgent, resolveProjectAgent } from "../../app/services/agent-selection-service.js";
import { getStoredModel } from "../../app/services/model-selection-service.js";
import { formatVariantForButton } from "../../app/services/variant-selection-service.js";
import { createMainKeyboard } from "../keyboards/main-reply-keyboard.js";
import { keyboardManager } from "../keyboards/keyboard-manager.js";
import { pinnedMessageManager } from "../pinned/pinned-message-manager.js";
import { summaryAggregator } from "../../app/managers/summary-aggregation-manager.js";
import { stopEventListening } from "../../opencode/events.js";
import { interactionManager } from "../../app/managers/interaction-manager.js";
import { clearAllInteractionState } from "../../app/managers/interaction-manager.js";
import { safeBackgroundTask } from "../../utils/safe-background-task.js";
import { formatErrorDetails } from "../../utils/error-format.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { foregroundSessionState } from "../../app/managers/foreground-session-state-manager.js";
import { assistantRunState } from "../../app/managers/assistant-run-state-manager.js";
import { attachManager } from "../../app/managers/attach-manager.js";
import {
  attachToSession,
  detachAttachedSession,
  markAttachedSessionBusy,
  markAttachedSessionIdle,
} from "../../app/services/attach-service.js";
import { externalUserInputSuppressionManager } from "../../app/managers/external-input-suppression-manager.js";
import { promptAttachment } from "../../app/managers/prompt-attachment-manager.js";
import { resolvePendingAttachment } from "../../app/services/prompt-attachment-service.js";
import {
  downloadTelegramFile,
  toDataUri,
} from "../../app/services/file-download-service.js";
import {
  getModelCapabilities,
  supportsInput,
} from "../../app/services/model-capabilities-service.js";
import type { IncomingPrompt } from "../../app/types/prompt.js";

/** Module-level references for async callbacks that don't have ctx. */
let botInstance: Bot<Context> | null = null;
let chatIdInstance: number | null = null;
const promptResponseModes = new Map<string, PromptResponseMode>();

export type PromptResponseMode = "text_only" | "text_and_tts";

type ProcessPromptOptions = {
  responseMode?: PromptResponseMode;
};

export function getPromptBotInstance(): Bot<Context> | null {
  return botInstance;
}

export function getPromptChatId(): number | null {
  return chatIdInstance;
}

export function setPromptResponseMode(sessionId: string, responseMode: PromptResponseMode): void {
  promptResponseModes.set(sessionId, responseMode);
}

export function clearPromptResponseMode(sessionId: string): void {
  promptResponseModes.delete(sessionId);
}

export function consumePromptResponseMode(sessionId: string): PromptResponseMode | null {
  const responseMode = promptResponseModes.get(sessionId) ?? null;
  promptResponseModes.delete(sessionId);
  return responseMode;
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
  detachAttachedSession("session_mismatch_reset");
  stopEventListening();
  summaryAggregator.clear();
  foregroundSessionState.clearAll("session_mismatch_reset");
  assistantRunState.clearAll("session_mismatch_reset");
  clearAllInteractionState("session_mismatch_reset");
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

export interface ProcessPromptDeps {
  bot: Bot<Context>;
  ensureEventSubscription: (directory: string) => Promise<void>;
  downloadFile?: (
    api: Context["api"],
    fileId: string,
  ) => Promise<{ buffer: Buffer; filePath: string }>;
  getModelCapabilities?: (
    providerId: string,
    modelId: string,
  ) => Promise<Model["capabilities"] | null>;
  getStoredModel?: () => { providerID: string; modelID: string; variant?: string };
}

/**
 * Drops the cancel button from the attachment confirmation once the file has been sent.
 * The attachment is consumed by then, so the button would no longer cancel anything.
 * The message text stays as a record of what went with the prompt.
 */
async function retireAttachmentConfirmation(
  ctx: Context,
  messageId: number | undefined,
): Promise<void> {
  if (!messageId || !ctx.chat) {
    return;
  }

  await ctx.api.editMessageReplyMarkup(ctx.chat.id, messageId).catch((err) => {
    logger.debug(`[PromptAttachment] Could not retire confirmation message ${messageId}:`, err);
  });
}

/**
 * Processes a user prompt: ensures project/session, subscribes to events, and sends
 * the prompt to OpenCode. Used by text, voice, and photo message handlers.
 *
 * @param ctx - Grammy context
 * @param input - Text and attachment content of the prompt
 * @param deps - Dependencies (bot and event subscription)
 * @returns true if the prompt was dispatched, false if it was blocked/failed early.
 */
export async function processUserPrompt(
  ctx: Context,
  input: IncomingPrompt,
  deps: ProcessPromptDeps,
  options: ProcessPromptOptions = {},
): Promise<boolean> {
  const { bot, ensureEventSubscription } = deps;
  const responseMode =
    options.responseMode ?? (getTtsMode() === "all" ? "text_and_tts" : "text_only");

  if (
    input.text.trim().length === 0 &&
    input.fileParts.length === 0 &&
    input.photos.length === 0 &&
    !promptAttachment.get()
  ) {
    return false;
  }

  const currentProject = getCurrentProject();
  if (!currentProject) {
    await ctx.reply(t("bot.project_not_selected"));
    return false;
  }

  botInstance = bot;
  chatIdInstance = ctx.chat!.id;

  let currentSession = getCurrentSession();
  let createdNewSession = false;

  if (currentSession && currentSession.directory !== currentProject.worktree) {
    logger.warn(
      `[Bot] Session/project mismatch detected. sessionDirectory=${currentSession.directory}, projectDirectory=${currentProject.worktree}. Resetting session context.`,
    );
    await resetMismatchedSessionContext();
    await ctx.reply(t("bot.session_reset_project_mismatch"));
    return false;
  }

  if (!currentSession) {
    await ctx.reply(t("bot.creating_session"));

    const { data: session, error } = await opencodeClient.session.create({
      directory: currentProject.worktree,
    });

    if (error || !session) {
      await ctx.reply(t("bot.create_session_error"));
      return false;
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
    createdNewSession = true;
  } else {
    logger.info(
      `[Bot] Using existing session: id=${currentSession.id}, title="${currentSession.title}"`,
    );
  }

  await attachToSession({
    bot,
    chatId: ctx.chat!.id,
    session: currentSession,
    ensureEventSubscription,
  });

  if (createdNewSession) {
    const currentAgent = await resolveProjectAgent(getStoredAgent());
    const currentModel = getStoredModel();
    keyboardManager.updateAgent(currentAgent);
    const contextInfo = keyboardManager.getContextInfo();
    const variantName = formatVariantForButton(currentModel.variant || "default");
    const keyboard = createMainKeyboard(
      currentAgent,
      currentModel,
      contextInfo ?? undefined,
      variantName,
    );

    await ctx.reply(t("bot.session_created", { title: currentSession.title }), {
      reply_markup: keyboard,
    });
  }

  const sessionIsBusy = await isSessionBusy(currentSession.id, currentSession.directory);
  if (sessionIsBusy) {
    logger.info(`[Bot] Ignoring new prompt: session ${currentSession.id} is busy`);
    await ctx.reply(t("bot.session_busy"));
    return false;
  }

  try {
    const currentAgent = await resolveProjectAgent(getStoredAgent());
    const storedModel = (deps.getStoredModel ?? getStoredModel)();
    const preparedInput = await prepareTelegramPhotos(ctx, input, deps, storedModel);
    if (!preparedInput) {
      return false;
    }

    // Build parts array with text and files
    const parts: Array<TextPartInput | FilePartInput> = [];

    // Add text part if present
    if (preparedInput.text.trim().length > 0) {
      parts.push({ type: "text", text: preparedInput.text });
    }

    // Add file parts
    parts.push(...preparedInput.fileParts);

    // A file picked in /ls belongs to this prompt. Capture whether one existed before
    // resolving it: the resolver clears the attachment on every failed check, so afterwards
    // a null result can no longer tell "nothing was attached" from "it went stale".
    const pendingAttachment = promptAttachment.get();
    const attachmentPart = await resolvePendingAttachment(currentSession.directory);

    if (attachmentPart) {
      parts.push(attachmentPart);
    } else if (pendingAttachment) {
      await ctx.reply(t("attachment.invalid"));
    }

    if (pendingAttachment) {
      // Cleared here rather than next to `return true`: the catch below already clears the
      // interaction on any failure but knows nothing about the attachment, which would leave
      // it behind to be picked up silently by an unrelated later prompt.
      promptAttachment.clear("consumed");
      interactionManager.clear("attachment_consumed");
      await retireAttachmentConfirmation(ctx, pendingAttachment.confirmationMessageId);
    }

    // If no text and files exist, use a placeholder
    if (parts.length === 0 || (parts.length > 0 && parts.every((p) => p.type === "file"))) {
      if (preparedInput.fileParts.length > 0) {
        // Files without text - add a minimal system prompt
        const attachmentText =
          preparedInput.fileParts.length === 1 ? "See attached file" : "See attached files";
        parts.unshift({ type: "text", text: attachmentText });
      }
    }

    // Counted from `parts` rather than `fileParts`: a file attached through /ls is added
    // above and would otherwise be missing from the logs.
    const filePartCount = parts.filter((part) => part.type === "file").length;

    const promptOptions: {
      sessionID: string;
      directory: string;
      parts: Array<TextPartInput | FilePartInput>;
      model?: { providerID: string; modelID: string };
      agent?: string;
      variant?: string;
    } = {
      sessionID: currentSession.id,
      directory: currentSession.directory,
      parts,
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

    const promptErrorLogContext = {
      sessionId: currentSession.id,
      directory: currentSession.directory,
      agent: currentAgent || "default",
      modelProvider: storedModel.providerID || "default",
      modelId: storedModel.modelID || "default",
      variant: storedModel.variant || "default",
      promptLength: preparedInput.text.length,
      fileCount: filePartCount,
    };

    logger.info(
      `[Bot] Calling session.promptAsync (start-only) with agent=${currentAgent}, fileCount=${filePartCount}...`,
    );

    foregroundSessionState.markBusy(currentSession.id, currentSession.directory);
    await markAttachedSessionBusy(currentSession.id);
    assistantRunState.startRun(currentSession.id, {
      startedAt: Date.now(),
      configuredAgent: currentAgent,
      configuredProviderID: storedModel.providerID,
      configuredModelID: storedModel.modelID,
    });
    setPromptResponseMode(currentSession.id, responseMode);

    if (preparedInput.text.trim().length > 0) {
      externalUserInputSuppressionManager.register(currentSession.id, preparedInput.text);
    }

    // CRITICAL: Use the async prompt start endpoint here.
    // session.prompt streams the full assistant response and can outlive the original
    // Telegram message handler, which turns late transport failures into misleading
    // "failed to send" messages even after the run has already started.
    // The actual assistant result still arrives via the SSE event subscription.
    safeBackgroundTask({
      taskName: "session.promptAsync",
      task: () => opencodeClient.session.promptAsync(promptOptions),
      onSuccess: ({ error }) => {
        if (error) {
          foregroundSessionState.markIdle(currentSession.id);
          void markAttachedSessionIdle(currentSession.id);
          assistantRunState.clearRun(currentSession.id, "session_prompt_api_error");
          clearPromptResponseMode(currentSession.id);
          const details = formatErrorDetails(error, 6000);
          logger.error(
            "[Bot] OpenCode API returned an error for session.promptAsync",
            promptErrorLogContext,
          );
          logger.error("[Bot] session.promptAsync error details:", details);
          logger.error("[Bot] session.promptAsync raw API error object:", error);

          // Send user-friendly error via API directly because ctx is no longer available
          if (attachManager.isAttachedSession(currentSession.id)) {
            void bot.api.sendMessage(ctx.chat!.id, t("bot.prompt_send_error")).catch(() => {});
          }
          return;
        }

        logger.info("[Bot] session.promptAsync accepted");
      },
      onError: (error) => {
        foregroundSessionState.markIdle(currentSession.id);
        void markAttachedSessionIdle(currentSession.id);
        assistantRunState.clearRun(currentSession.id, "session_prompt_background_error");
        clearPromptResponseMode(currentSession.id);
        const details = formatErrorDetails(error, 6000);
        logger.error("[Bot] session.promptAsync background task failed", promptErrorLogContext);
        logger.error("[Bot] session.promptAsync background failure details:", details);
        logger.error("[Bot] session.promptAsync raw background error object:", error);
        if (attachManager.isAttachedSession(currentSession.id)) {
          void bot.api.sendMessage(ctx.chat!.id, t("bot.prompt_send_error")).catch(() => {});
        }
      },
    });

    return true;
  } catch (err) {
    if (currentSession) {
      foregroundSessionState.markIdle(currentSession.id);
      await markAttachedSessionIdle(currentSession.id);
      assistantRunState.clearRun(currentSession.id, "session_prompt_handler_error");
    }
    logger.error("Error in prompt handler:", err);
    if (interactionManager.getSnapshot()) {
      clearAllInteractionState("message_handler_error");
    }
    await ctx.reply(t("error.generic"));
    return false;
  }
}

async function prepareTelegramPhotos(
  ctx: Context,
  input: IncomingPrompt,
  deps: ProcessPromptDeps,
  storedModel: { providerID: string; modelID: string },
): Promise<IncomingPrompt | null> {
  if (input.photos.length === 0) {
    return input;
  }

  const getCapabilities = deps.getModelCapabilities ?? getModelCapabilities;
  const capabilities = await getCapabilities(storedModel.providerID, storedModel.modelID);

  if (!supportsInput(capabilities, "image")) {
    logger.warn(
      `[Bot] Model ${storedModel.providerID}/${storedModel.modelID} doesn't support image input`,
    );
    const onlyStandalone = input.photos.every((photo) => photo.source === "standalone");
    await ctx.reply(
      input.photos.some((photo) => photo.source === "album")
        ? t("bot.media_group_not_processed")
        : t("bot.photo_model_no_image"),
    );
    if (onlyStandalone && input.text.trim().length > 0) {
      return { ...input, photos: [] };
    }
    return null;
  }

  const isAlbum = input.photos.every((photo) => photo.source === "album");
  await ctx.reply(
    isAlbum || input.photos.length > 1 ? t("bot.files_downloading") : t("bot.photo_downloading"),
  );

  const downloadFile = deps.downloadFile ?? downloadTelegramFile;

  try {
    const downloadedParts: FilePartInput[] = [];
    for (const photo of input.photos) {
      const downloaded = await downloadFile(ctx.api, photo.fileId);
      downloadedParts.push({
        type: "file",
        mime: "image/jpeg",
        filename: photo.filename,
        url: toDataUri(downloaded.buffer, "image/jpeg"),
      });
    }

    logger.info(`[Bot] Prepared ${downloadedParts.length} Telegram photo(s) for prompt`);
    return {
      ...input,
      fileParts: [...input.fileParts, ...downloadedParts],
      photos: [],
    };
  } catch (err) {
    logger.error("[Bot] Error downloading Telegram photo input:", err);
    await ctx.reply(isAlbum ? t("bot.media_group_download_error") : t("bot.photo_download_error"));
    return null;
  }
}
