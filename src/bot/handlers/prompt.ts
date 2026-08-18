import { Bot, Context } from "grammy";
import type { FilePartInput, TextPartInput } from "@opencode-ai/sdk/v2";
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
import {
  attachToSession,
  detachAttachedSession,
  markAttachedSessionBusy,
  markAttachedSessionIdle,
} from "../../app/services/attach-service.js";
import { externalUserInputSuppressionManager } from "../../app/managers/external-input-suppression-manager.js";
import { promptAttachment } from "../../app/managers/prompt-attachment-manager.js";
import { resolvePendingAttachment } from "../../app/services/prompt-attachment-service.js";
import { scheduledTaskRuntime } from "../../app/services/scheduled-task-runtime-service.js";
import { dispatchNextQueuedPrompt } from "./prompt-queue-dispatch.js";
import {
  createEmptyTaskAttemptEvidence,
  isSafeZeroWorkEmptyCompletion,
  mergeTaskAttemptEvidence,
  type TaskAttemptEvidence,
} from "../services/empty-completion-policy.js";

/** Module-level references for async callbacks that don't have ctx. */
let botInstance: Bot<Context> | null = null;
let chatIdInstance: number | null = null;
const promptResponseModes = new Map<string, PromptResponseMode>();

export interface PromptDispatchOptions {
  sessionID: string;
  directory: string;
  parts: Array<TextPartInput | FilePartInput>;
  model?: { providerID: string; modelID: string };
  agent?: string;
  variant?: string;
}

/**
 * Lifecycle of a single prompt attempt. Distinguishes the original attempt from
 * the one automatic retry, guards session.idle events that close the original
 * attempt while the retry is in flight, and accumulates conservative work
 * evidence across every assistant turn of the current attempt.
 */
interface PromptAttemptState {
  bot: Bot<Context>;
  chatId: number;
  promptOptions: PromptDispatchOptions;
  promptText: string;
  responseMode: PromptResponseMode;
  retryDispatched: boolean;
  /** True once the retry produced a terminal-eligible non-empty response. From
   *  that point an idle is only finalized after the authoritative OpenCode
   *  session status confirms the session is genuinely idle; a stale idle from
   *  the original attempt while the retry is still busy is consumed instead. */
  retryResponseDelivered: boolean;
  workEvidence: TaskAttemptEvidence;
}

const promptRetryStates = new Map<string, PromptAttemptState>();

export type EmptyCompletionOutcome = "retried" | "failed" | "no_retry" | "ignored";

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

export function registerPromptRetry(
  sessionId: string,
  state: Omit<PromptAttemptState, "retryDispatched" | "retryResponseDelivered" | "workEvidence">,
): void {
  promptRetryStates.set(sessionId, {
    ...state,
    retryDispatched: false,
    retryResponseDelivered: false,
    workEvidence: createEmptyTaskAttemptEvidence(),
  });
}

export function clearPromptRetry(sessionId: string): void {
  promptRetryStates.delete(sessionId);
}

export function clearAllPromptRetry(): void {
  promptRetryStates.clear();
}

export function hasPromptRetryAttempted(sessionId: string): boolean {
  return promptRetryStates.get(sessionId)?.retryDispatched ?? false;
}

export function getPromptRetryChatId(sessionId: string): number | null {
  return promptRetryStates.get(sessionId)?.chatId ?? null;
}

/**
 * Records that the retry produced a terminal-eligible non-empty response. The
 * retry state is kept alive so the retry is only finalized once the
 * authoritative OpenCode session status confirms the session is genuinely idle.
 */
export function markPromptRetryResponseDelivered(sessionId: string): void {
  const state = promptRetryStates.get(sessionId);
  if (!state) {
    return;
  }

  state.retryResponseDelivered = true;
}

/**
 * Queries the authoritative OpenCode session status for a retried run. OpenCode
 * keeps a session in its active status map while it is busy and deletes it when
 * it goes idle (publishing session.idle at the same time), and its own
 * `SessionStatus.get()` defaults a missing session to "idle" - so a missing or
 * "idle" entry is positive proof the run finished. A failed or unexpected
 * lookup returns "unknown".
 */
async function queryAuthoritativeSessionState(
  sessionId: string,
  directory: string,
): Promise<"idle" | "busy" | "unknown"> {
  try {
    const { data, error } = await opencodeClient.session.status({ directory });

    if (error || !data) {
      logger.warn(`[Bot] Failed to verify retry session status: session=${sessionId}`, error);
      return "unknown";
    }

    const status = (data as Record<string, { type?: string }>)[sessionId];
    if (!status || status.type === "idle") {
      return "idle";
    }

    if (status.type === "busy" || status.type === "retry") {
      return "busy";
    }

    return "unknown";
  } catch (err) {
    logger.warn(`[Bot] Error verifying retry session status: session=${sessionId}`, err);
    return "unknown";
  }
}

export type RetryIdleDecision = "none" | "consumed" | "finalize";

/**
 * Decides how a session.idle during a retry lifecycle should be handled.
 *
 * - `none`: no active retry for this session; the idle is a normal one.
 * - `consumed`: the idle belongs to the retry (the original attempt's idle, a
 *   stale duplicate, or the retry still busy per the authoritative status). It
 *   must not finalize anything.
 * - `finalize`: the retry produced a terminal response AND the authoritative
 *   OpenCode session status confirms the session is genuinely idle, so the
 *   caller finalizes the run exactly once.
 *
 * The guard only activates once the retry is actually dispatched, so a
 * registered-but-unreplayed attempt never swallows a normal run's idle. When
 * the status lookup fails or is ambiguous the idle is consumed and success is
 * never finalized (fail closed).
 */
export async function decidePromptRetryIdle(sessionId: string): Promise<RetryIdleDecision> {
  const state = promptRetryStates.get(sessionId);
  if (!state || !state.retryDispatched) {
    return "none";
  }

  if (!state.retryResponseDelivered) {
    return "consumed";
  }

  const sessionState = await queryAuthoritativeSessionState(
    sessionId,
    state.promptOptions.directory,
  );
  return sessionState === "idle" ? "finalize" : "consumed";
}

/**
 * Merges the completion evidence of one assistant turn into the running
 * attempt-wide evidence, so a later empty completion is judged by everything the
 * run actually did, not by the final message alone.
 */
export function recordAttemptEvidence(
  sessionId: string,
  evidence: TaskAttemptEvidence,
): void {
  const state = promptRetryStates.get(sessionId);
  if (!state) {
    return;
  }

  state.workEvidence = mergeTaskAttemptEvidence(state.workEvidence, evidence);
}

/**
 * Decides what an empty completion means for the current prompt attempt:
 * retried (zero-work original, retry dispatched), failed (the retry itself came
 * back empty), no_retry (work evidence says the run is not provably zero-work),
 * or ignored (no prompt attempt is registered for this session).
 */
export function handleEmptyCompletion(sessionId: string): EmptyCompletionOutcome {
  const state = promptRetryStates.get(sessionId);
  if (!state) {
    return "ignored";
  }

  if (!state.retryDispatched && isSafeZeroWorkEmptyCompletion(state.workEvidence)) {
    return retryPromptOnce(sessionId) ? "retried" : "no_retry";
  }

  if (state.retryDispatched) {
    clearPromptRetry(sessionId);
    return "failed";
  }

  clearPromptRetry(sessionId);
  return "no_retry";
}

/**
 * Clears the retry state and restores a coherent idle state after the retry API
 * call itself failed. Only the state this attempt registered is invalidated, so
 * a slower duplicate callback can never wipe out a newer prompt's state.
 */
function abandonRetryAttempt(
  sessionId: string,
  state: PromptAttemptState,
  reason: string,
): void {
  if (promptRetryStates.get(sessionId) !== state) {
    return;
  }

  clearPromptRetry(sessionId);
  foregroundSessionState.markIdle(sessionId);
  void markAttachedSessionIdle(sessionId);
  assistantRunState.clearRun(sessionId, reason);
  clearPromptResponseMode(sessionId);
  void state.bot.api.sendMessage(state.chatId, t("bot.prompt_send_error")).catch(() => {});
  // The idle that would normally drive the queue was consumed by the guard, so
  // the canonical lifecycle is resumed from here.
  void dispatchNextQueuedPrompt();
  void scheduledTaskRuntime.flushDeferredDeliveries();
}

export function retryPromptOnce(sessionId: string): boolean {
  const state = promptRetryStates.get(sessionId);
  if (!state || state.retryDispatched) {
    return false;
  }

  state.retryDispatched = true;
  state.retryResponseDelivered = false;
  state.workEvidence = createEmptyTaskAttemptEvidence();
  foregroundSessionState.markBusy(sessionId, state.promptOptions.directory);
  void markAttachedSessionBusy(sessionId);
  assistantRunState.startRun(sessionId, {
    startedAt: Date.now(),
    configuredAgent: state.promptOptions.agent,
    configuredProviderID: state.promptOptions.model?.providerID,
    configuredModelID: state.promptOptions.model?.modelID,
  });
  setPromptResponseMode(sessionId, state.responseMode);
  if (state.promptText.trim().length > 0) {
    externalUserInputSuppressionManager.register(sessionId, state.promptText);
  }

  safeBackgroundTask({
    taskName: "session.promptAsync.retry",
    task: () => opencodeClient.session.promptAsync(state.promptOptions),
    onSuccess: ({ error }) => {
      if (!error) {
        logger.info(`[Bot] Automatic empty-completion retry accepted: session=${sessionId}`);
        return;
      }

      logger.error(
        `[Bot] Automatic empty-completion retry rejected by OpenCode: session=${sessionId}`,
        error,
      );
      abandonRetryAttempt(sessionId, state, "session_prompt_retry_api_error");
    },
    onError: (error) => {
      logger.error(
        `[Bot] Automatic empty-completion retry background failure: session=${sessionId}`,
        error,
      );
      abandonRetryAttempt(sessionId, state, "session_prompt_retry_background_error");
    },
  });

  return true;
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
  const currentSession = getCurrentSession();
  if (currentSession) {
    clearPromptRetry(currentSession.id);
  }
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
 * @param text - Text content of the prompt
 * @param deps - Dependencies (bot and event subscription)
 * @param fileParts - Optional file parts (for photo/document attachments)
 * @returns true if the prompt was dispatched, false if it was blocked/failed early.
 */
export async function processUserPrompt(
  ctx: Context,
  text: string,
  deps: ProcessPromptDeps,
  fileParts: FilePartInput[] = [],
  options: ProcessPromptOptions = {},
): Promise<boolean> {
  const { bot, ensureEventSubscription } = deps;
  const responseMode =
    options.responseMode ?? (getTtsMode() === "all" ? "text_and_tts" : "text_only");

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
    const storedModel = getStoredModel();

    // Build parts array with text and files
    const parts: Array<TextPartInput | FilePartInput> = [];

    // Add text part if present
    if (text.trim().length > 0) {
      parts.push({ type: "text", text });
    }

    // Add file parts
    parts.push(...fileParts);

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
      if (fileParts.length > 0) {
        // Files without text - add a minimal system prompt
        const attachmentText = fileParts.length === 1 ? "See attached file" : "See attached files";
        parts.unshift({ type: "text", text: attachmentText });
      }
    }

    // Counted from `parts` rather than `fileParts`: a file attached through /ls is added
    // above and would otherwise be missing from the logs.
    const filePartCount = parts.filter((part) => part.type === "file").length;

    const promptOptions: PromptDispatchOptions = {
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
      promptLength: text.length,
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
    registerPromptRetry(currentSession.id, {
      bot,
      chatId: ctx.chat!.id,
      promptOptions,
      promptText: text,
      responseMode,
    });

    if (text.trim().length > 0) {
      externalUserInputSuppressionManager.register(currentSession.id, text);
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
          clearPromptRetry(currentSession.id);
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
          void bot.api.sendMessage(ctx.chat!.id, t("bot.prompt_send_error")).catch(() => {});
          return;
        }

        logger.info("[Bot] session.promptAsync accepted");
      },
      onError: (error) => {
        clearPromptRetry(currentSession.id);
        foregroundSessionState.markIdle(currentSession.id);
        void markAttachedSessionIdle(currentSession.id);
        assistantRunState.clearRun(currentSession.id, "session_prompt_background_error");
        clearPromptResponseMode(currentSession.id);
        const details = formatErrorDetails(error, 6000);
        logger.error("[Bot] session.promptAsync background task failed", promptErrorLogContext);
        logger.error("[Bot] session.promptAsync background failure details:", details);
        logger.error("[Bot] session.promptAsync raw background error object:", error);
        void bot.api.sendMessage(ctx.chat!.id, t("bot.prompt_send_error")).catch(() => {});
      },
    });

    return true;
  } catch (err) {
    if (currentSession) {
      foregroundSessionState.markIdle(currentSession.id);
      await markAttachedSessionIdle(currentSession.id);
      assistantRunState.clearRun(currentSession.id, "session_prompt_handler_error");
      clearPromptRetry(currentSession.id);
    }
    logger.error("Error in prompt handler:", err);
    if (interactionManager.getSnapshot()) {
      clearAllInteractionState("message_handler_error");
    }
    await ctx.reply(t("error.generic"));
    return false;
  }
}
