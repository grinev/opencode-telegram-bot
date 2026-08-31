import type { Context } from "grammy";
import { MAX_QUEUED_PROMPTS, promptQueue } from "../../app/managers/prompt-queue-manager.js";
import { buildExternalUserInputNotification } from "../../app/services/external-user-input-service.js";
import { isForegroundBusy } from "../../app/services/run-control-service.js";
import { getPromptQueueEnabled } from "../../app/stores/settings-store.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { keyboardManager } from "../keyboards/keyboard-manager.js";
import { sendBotText } from "../messages/telegram-text.js";
import { isReplyKeyboardButtonText } from "../message-patterns.js";
import { processUserPrompt, type ProcessPromptDeps } from "./prompt.js";

// `ensureEventSubscription` is not a singleton: createBot() passes it into every
// router. The interaction guard is registered without deps, so the dispatcher
// receives them once at startup instead.
let promptDeps: ProcessPromptDeps | null = null;

// Live context of the last queued message, replayed when the queue drains.
// Same approach as message-merger.ts.
let queuedPromptContext: Context | null = null;

// Both drain sites fire unawaited, and processUserPrompt only marks the session
// busy after several network round-trips. Without this flag two overlapping
// drains could each pass the busy check and start a second run for the same
// session, losing the prompt the loser took off the queue.
let dispatchInFlight = false;

export function initializePromptQueueDispatch(deps: ProcessPromptDeps): void {
  promptDeps = deps;
}

/** Whether the text is user prompt content rather than a command or a button press. */
function isQueueablePromptText(text: string): boolean {
  const normalizedText = text.trim();
  return Boolean(normalizedText) && !normalizedText.startsWith("/") && !isReplyKeyboardButtonText(text);
}

/**
 * Whether the user should be told that this message could have been queued.
 * True only when the setting is off and the text would otherwise have been queued.
 */
export function shouldSuggestPromptQueue(text: string): boolean {
  return !getPromptQueueEnabled() && isQueueablePromptText(text);
}

/**
 * Queues a text prompt that arrived while the session was busy.
 * Returns false when queueing does not apply, so the caller keeps its old behaviour.
 */
export async function tryEnqueuePrompt(ctx: Context, text: string): Promise<boolean> {
  if (!getPromptQueueEnabled() || !ctx.chat || !isQueueablePromptText(text)) {
    return false;
  }

  const normalizedText = text.trim();
  queuedPromptContext = ctx;

  if (promptQueue.isFull()) {
    logger.info(`[PromptQueue] Rejected prompt: queue is full (max=${MAX_QUEUED_PROMPTS})`);
    await replyWithKeyboard(ctx, t("queue.full", { max: String(MAX_QUEUED_PROMPTS) }));
    return true;
  }

  const queued = promptQueue.add(normalizedText);
  if (!queued) {
    return false;
  }

  logger.info(
    `[PromptQueue] Prompt queued while session is busy: size=${promptQueue.size()}/${MAX_QUEUED_PROMPTS}`,
  );
  await replyWithKeyboard(
    ctx,
    t("queue.added", { count: String(promptQueue.size()), max: String(MAX_QUEUED_PROMPTS) }),
  );
  return true;
}

/**
 * Sends the next queued prompt once the session is idle again, echoing it in the
 * same "external user input" format used for prompts sent from another device.
 */
export async function dispatchNextQueuedPrompt(): Promise<void> {
  if (
    dispatchInFlight ||
    promptQueue.size() === 0 ||
    !promptDeps ||
    !queuedPromptContext ||
    isForegroundBusy()
  ) {
    return;
  }

  dispatchInFlight = true;

  try {
    const item = promptQueue.takeNext();
    if (!item) {
      return;
    }

    const ctx = queuedPromptContext;
    const deps = promptDeps;

    const notification = buildExternalUserInputNotification(item.text);
    if (notification && ctx.chat) {
      try {
        const keyboard = keyboardManager.getKeyboard();
        await sendBotText({
          api: ctx.api,
          chatId: ctx.chat.id,
          text: notification.text,
          rawFallbackText: notification.rawFallbackText,
          format: "markdown_v2",
          options: keyboard ? { reply_markup: keyboard } : {},
        });
      } catch (err) {
        logger.error("[PromptQueue] Failed to echo queued prompt:", err);
      }
    }

    logger.info(
      `[PromptQueue] Dispatching queued prompt: id=${item.id}, left=${promptQueue.size()}`,
    );

    try {
      const dispatched = await processUserPrompt(ctx, item.text, deps);
      if (!dispatched) {
        logger.warn(`[PromptQueue] Queued prompt was not dispatched: id=${item.id}`);
      }
    } catch (err) {
      logger.error(`[PromptQueue] Failed to dispatch queued prompt: id=${item.id}`, err);
    }
  } finally {
    dispatchInFlight = false;
  }
}

async function replyWithKeyboard(ctx: Context, text: string): Promise<void> {
  const keyboard = keyboardManager.getKeyboard();
  await ctx.reply(text, keyboard ? { reply_markup: keyboard } : {}).catch((err) => {
    logger.error("[PromptQueue] Failed to send queue reply:", err);
  });
}

/** Test helper: clears the stored context and dependencies. */
export function __resetPromptQueueDispatchForTests(): void {
  promptDeps = null;
  queuedPromptContext = null;
  dispatchInFlight = false;
}
