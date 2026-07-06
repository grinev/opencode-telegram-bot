import type { Context } from "grammy";
import { processUserPrompt, type ProcessPromptDeps } from "./prompt.js";
import { logger } from "../../utils/logger.js";

interface PendingPrompt {
  texts: string[];
  ctx: Context;
  deps: ProcessPromptDeps;
  timer: ReturnType<typeof setTimeout>;
}

// Buffered plain-text prompts, keyed by chat id. Telegram delivers one long
// message (or one paste) as several consecutive updates; merging them here
// turns those chunks into a single OpenCode prompt.
const pendingByChat = new Map<number, PendingPrompt>();

function flushPending(chatId: number): void {
  const pending = pendingByChat.get(chatId);
  if (!pending) {
    return;
  }

  pendingByChat.delete(chatId);
  clearTimeout(pending.timer);

  const { texts, ctx, deps } = pending;
  if (texts.length > 1) {
    logger.info(
      `[Bot] Merging ${texts.length} quick consecutive messages into one prompt (chatId=${chatId}, totalLength=${texts.reduce((sum, part) => sum + part.length, 0)})`,
    );
  } else {
    logger.debug(`[Bot] Flushing single pending prompt (chatId=${chatId})`);
  }

  void processUserPrompt(ctx, texts.join("\n\n"), deps);
}

/**
 * Buffers a plain-text prompt so several quick consecutive messages (e.g.
 * Telegram splitting one long message into chunks) are merged into a single
 * OpenCode prompt. Each new chunk restarts the wait window; once the window
 * elapses with no new chunk, the buffered text is sent at once.
 *
 * Pass `mergeWindowMs <= 0` to disable merging and process the message
 * immediately.
 */
export function queuePromptForMerging(
  ctx: Context,
  text: string,
  deps: ProcessPromptDeps,
  mergeWindowMs: number,
): void {
  const chatId = ctx.chat!.id;

  if (mergeWindowMs <= 0) {
    void processUserPrompt(ctx, text, deps);
    return;
  }

  const existing = pendingByChat.get(chatId);
  if (existing) {
    existing.texts.push(text);
    existing.ctx = ctx;
    clearTimeout(existing.timer);
    existing.timer = setTimeout(() => flushPending(chatId), mergeWindowMs);
    logger.debug(
      `[Bot] Appended message to pending prompt (chatId=${chatId}, parts=${existing.texts.length})`,
    );
    return;
  }

  const timer = setTimeout(() => flushPending(chatId), mergeWindowMs);
  pendingByChat.set(chatId, { texts: [text], ctx, deps, timer });
  logger.debug(
    `[Bot] Started prompt merge window (chatId=${chatId}, mergeWindowMs=${mergeWindowMs})`,
  );
}

/** Immediately flush any buffered prompt for the chat (e.g. when a command arrives). */
export function flushPendingPrompt(chatId: number): void {
  flushPending(chatId);
}

/** Test helper: clears all buffered prompts and their timers. */
export function __resetMessageMergerForTests(): void {
  for (const pending of pendingByChat.values()) {
    clearTimeout(pending.timer);
  }
  pendingByChat.clear();
}
