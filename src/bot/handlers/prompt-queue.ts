import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import type { FilePartInput } from "@opencode-ai/sdk/v2";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { getCurrentSession } from "../../app/services/session-service.js";
import type { ProcessPromptDeps, ProcessPromptOptions } from "./prompt.js";

/** Callback data prefix for the inline cancel button on a queued-prompt bubble. */
export const PROMPT_QUEUE_CANCEL_PREFIX = "qcancel:";

/** Hard cap per session. A stuck agent must not accumulate stale instructions. */
export const PROMPT_QUEUE_LIMIT = 10;

/** Delay before draining after the session reports idle, to let OpenCode settle. */
const FLUSH_DELAY_MS = 400;

/** Backoff used when the session still reports busy at drain time. */
const FLUSH_RETRY_DELAY_MS = 1500;
const FLUSH_MAX_RETRIES = 5;

export interface QueuedPrompt {
  id: string;
  sessionId: string;
  ctx: Context;
  text: string;
  deps: ProcessPromptDeps;
  fileParts: FilePartInput[];
  options: ProcessPromptOptions;
  ackChatId: number;
  ackMessageId: number | null;
  enqueuedAt: number;
  retries: number;
}

const queuesBySession = new Map<string, QueuedPrompt[]>();
const flushTimers = new Map<string, ReturnType<typeof setTimeout>>();
let nextQueueId = 1;

function getQueue(sessionId: string): QueuedPrompt[] {
  const existing = queuesBySession.get(sessionId);
  if (existing) {
    return existing;
  }

  const created: QueuedPrompt[] = [];
  queuesBySession.set(sessionId, created);
  return created;
}

function buildCancelKeyboard(id: string): InlineKeyboard {
  return new InlineKeyboard().text(
    t("prompt_queue.button.cancel"),
    `${PROMPT_QUEUE_CANCEL_PREFIX}${id}`,
  );
}

/** Rewrites the acknowledgement bubble in place; failures are never fatal. */
async function updateAck(
  item: QueuedPrompt,
  text: string,
  keyboard?: InlineKeyboard,
): Promise<void> {
  if (item.ackMessageId === null) {
    return;
  }

  try {
    await item.ctx.api.editMessageText(item.ackChatId, item.ackMessageId, text, {
      reply_markup: keyboard,
    });
  } catch (err) {
    logger.debug(`[PromptQueue] Failed to update ack message (id=${item.id}): ${String(err)}`);
  }
}

export function getQueueDepth(sessionId: string): number {
  return queuesBySession.get(sessionId)?.length ?? 0;
}

/**
 * Parks a prompt that arrived while the session was busy, and acknowledges it
 * immediately so the user sees the message was accepted rather than dropped.
 *
 * Re-entrant: a prompt that was already queued and bounced off a still-busy
 * session goes back to the head of the queue keeping its original bubble.
 *
 * @returns true when the prompt is queued, false when the queue is full.
 */
export async function queueBusyPrompt(params: {
  sessionId: string;
  ctx: Context;
  text: string;
  deps: ProcessPromptDeps;
  fileParts: FilePartInput[];
  options: ProcessPromptOptions;
}): Promise<boolean> {
  const { sessionId, ctx, text, deps, fileParts, options } = params;
  const queue = getQueue(sessionId);
  const existing = options.queueItem;

  if (existing) {
    existing.retries += 1;
    if (existing.retries > FLUSH_MAX_RETRIES) {
      logger.warn(
        `[PromptQueue] Dropping queued prompt after ${FLUSH_MAX_RETRIES} busy retries (id=${existing.id}, session=${sessionId})`,
      );
      await updateAck(existing, t("prompt_queue.failed"));
      return false;
    }

    queue.unshift(existing);
    await updateAck(
      existing,
      t("prompt_queue.queued", { position: 1 }),
      buildCancelKeyboard(existing.id),
    );
    scheduleQueueFlush(sessionId, FLUSH_RETRY_DELAY_MS);
    return true;
  }

  if (queue.length >= PROMPT_QUEUE_LIMIT) {
    logger.info(`[PromptQueue] Queue full, rejecting prompt (session=${sessionId})`);
    await ctx.reply(t("prompt_queue.full", { limit: PROMPT_QUEUE_LIMIT })).catch(() => {});
    return false;
  }

  const item: QueuedPrompt = {
    id: String(nextQueueId++),
    sessionId,
    ctx,
    text,
    deps,
    fileParts,
    options,
    ackChatId: ctx.chat!.id,
    ackMessageId: null,
    enqueuedAt: Date.now(),
    retries: 0,
  };

  queue.push(item);

  try {
    const ack = await ctx.reply(t("prompt_queue.queued", { position: queue.length }), {
      reply_markup: buildCancelKeyboard(item.id),
      reply_parameters: ctx.message ? { message_id: ctx.message.message_id } : undefined,
    });
    item.ackMessageId = ack.message_id;
  } catch (err) {
    // The prompt stays queued even if the acknowledgement could not be posted.
    logger.warn(`[PromptQueue] Failed to send ack message (session=${sessionId})`, err);
  }

  logger.info(
    `[PromptQueue] Queued prompt while session busy (session=${sessionId}, depth=${queue.length}, id=${item.id})`,
  );
  return true;
}

/** Schedules a drain attempt, collapsing repeated requests into one timer. */
export function scheduleQueueFlush(sessionId: string, delayMs: number = FLUSH_DELAY_MS): void {
  if (getQueueDepth(sessionId) === 0) {
    return;
  }

  const existingTimer = flushTimers.get(sessionId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  flushTimers.set(
    sessionId,
    setTimeout(() => {
      flushTimers.delete(sessionId);
      void flushQueuedPrompt(sessionId);
    }, delayMs),
  );
}

/**
 * Dispatches the oldest queued prompt. One at a time: the next drain is
 * triggered by the following idle event, mirroring the OpenCode TUI.
 */
async function flushQueuedPrompt(sessionId: string): Promise<void> {
  const queue = queuesBySession.get(sessionId);
  const item = queue?.shift();
  if (!item) {
    return;
  }

  // The session may have been switched, reset or detached while this prompt
  // waited. Replaying it into whatever session is active now would send the
  // user's instruction to the wrong place, so drop it instead. Put it back at
  // the head first so the summary notice from clearPromptQueue counts it too.
  const activeSession = getCurrentSession();
  if (!activeSession || activeSession.id !== sessionId) {
    logger.info(
      `[PromptQueue] Dropping queued prompt, session no longer active (queued=${sessionId}, active=${activeSession?.id ?? "none"}, id=${item.id})`,
    );
    queue?.unshift(item);
    await clearPromptQueue(sessionId, "session_no_longer_active");
    return;
  }

  await updateAck(item, t("prompt_queue.running"));

  logger.info(
    `[PromptQueue] Dispatching queued prompt (session=${sessionId}, id=${item.id}, waitedMs=${Date.now() - item.enqueuedAt})`,
  );

  try {
    // Imported lazily: prompt.ts depends on this module for the busy path.
    const { processUserPrompt } = await import("./prompt.js");
    await processUserPrompt(item.ctx, item.text, item.deps, item.fileParts, {
      ...item.options,
      queueItem: item,
    });
  } catch (err) {
    logger.error(`[PromptQueue] Failed to dispatch queued prompt (id=${item.id})`, err);
    await updateAck(item, t("prompt_queue.failed"));
  }
}

/**
 * Drops every queued prompt for a session (or all sessions when `sessionId` is
 * null). Called whenever the session, project or worktree changes: a queued
 * prompt must never be replayed into a different session than it was written for.
 */
export async function clearPromptQueue(sessionId: string | null, reason: string): Promise<void> {
  const targets = sessionId === null ? Array.from(queuesBySession.keys()) : [sessionId];

  // Old "queued" bubbles are left untouched: they scroll out of view and
  // editing them in place goes unnoticed. Instead post a single fresh summary
  // at the bottom of the chat so the user actually sees what was dropped.
  let clearedCount = 0;
  let notifier: QueuedPrompt | null = null;

  for (const target of targets) {
    const queue = queuesBySession.get(target);
    queuesBySession.delete(target);

    const timer = flushTimers.get(target);
    if (timer) {
      clearTimeout(timer);
      flushTimers.delete(target);
    }

    if (!queue?.length) {
      continue;
    }

    logger.info(
      `[PromptQueue] Cleared ${queue.length} queued prompt(s) (session=${target}, reason=${reason})`,
    );

    clearedCount += queue.length;
    notifier ??= queue[0];
  }

  if (clearedCount > 0 && notifier) {
    try {
      await notifier.ctx.api.sendMessage(
        notifier.ackChatId,
        t("prompt_queue.cleared", { count: clearedCount }),
      );
    } catch (err) {
      logger.debug(`[PromptQueue] Failed to send queue-cleared notice: ${String(err)}`);
    }
  }
}

/** Removes a single queued prompt in response to its inline cancel button. */
export async function cancelQueuedPrompt(id: string): Promise<boolean> {
  for (const [sessionId, queue] of queuesBySession.entries()) {
    const index = queue.findIndex((entry) => entry.id === id);
    if (index === -1) {
      continue;
    }

    const [item] = queue.splice(index, 1);
    await updateAck(item, t("prompt_queue.cancelled"));
    logger.info(`[PromptQueue] Cancelled queued prompt (session=${sessionId}, id=${id})`);
    return true;
  }

  return false;
}

/**
 * Handles a queued prompt whose asynchronous start failed after it had already
 * been dispatched (its ack was flipped to "running"). Marks the bubble failed
 * and advances the rest of the queue, which would otherwise stall until the
 * next idle or reconciliation because the failed start emits no idle event.
 */
export async function failDispatchedQueuedPrompt(item: QueuedPrompt): Promise<void> {
  await updateAck(item, t("prompt_queue.failed"));
  scheduleQueueFlush(item.sessionId);
}

/**
 * Removes the newest queued prompt (LIFO) for a session — backs the /unqueue
 * command, whose reply lands at the bottom of the chat where the inline cancel
 * button on a scrolled-away bubble no longer is. Returns the removed entry, or
 * null when the queue is empty.
 */
export async function unqueueLatestPrompt(sessionId: string): Promise<QueuedPrompt | null> {
  const queue = queuesBySession.get(sessionId);
  const item = queue?.pop();
  if (!queue || !item) {
    return null;
  }

  if (queue.length === 0) {
    queuesBySession.delete(sessionId);
    const timer = flushTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      flushTimers.delete(sessionId);
    }
  }

  await updateAck(item, t("prompt_queue.cancelled"));
  logger.info(`[PromptQueue] Unqueued latest prompt (session=${sessionId}, id=${item.id})`);
  return item;
}

/** Test helper: clears all queues and timers without touching Telegram. */
export function __resetPromptQueueForTests(): void {
  for (const timer of flushTimers.values()) {
    clearTimeout(timer);
  }
  flushTimers.clear();
  queuesBySession.clear();
  nextQueueId = 1;
}
