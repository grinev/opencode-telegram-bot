import type { Api, RawApi } from "grammy";
import { logger } from "../../utils/logger.js";

type TelegramDeleteApi = Pick<Api<RawApi>, "deleteMessage">;

/**
 * Pace deletes at ~20 req/s so a large cleanup never trips Telegram flood
 * limits on its own. grammY's rate-limit retry transformer remains the final
 * safety net for 429s.
 */
const DELETE_PACE_DELAY_MS = 50;

const TOLERATED_DELETE_ERROR_FRAGMENTS = [
  "message to delete not found",
  "message can't be deleted",
  "message is too old",
  "message identifier is not specified",
] as const;

export interface DeleteAllResult {
  deleted: number;
  failed: number;
}

function isToleratedDeleteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return TOLERATED_DELETE_ERROR_FRAGMENTS.some((fragment) => message.includes(fragment));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Tracks Telegram message ids the bot rendered as conversation content per
 * chat, so a session switch can wipe the previous conversation view before
 * rendering the newly selected session's full history.
 *
 * Not tracked: pinned status messages, queued-message buttons, interaction
 * menus (questions/permissions), scheduled-task delivery cards, and the
 * /messages browser — those manage their own lifecycle.
 */
class ConversationMessageTracker {
  private readonly idsByChat = new Map<number, Set<number>>();

  track(chatId: number, messageId: number): void {
    if (!Number.isFinite(chatId) || !Number.isFinite(messageId)) {
      return;
    }

    const ids = this.idsByChat.get(chatId) ?? new Set<number>();
    ids.add(messageId);
    this.idsByChat.set(chatId, ids);
  }

  trackMany(chatId: number, messageIds: readonly number[]): void {
    for (const messageId of messageIds) {
      this.track(chatId, messageId);
    }
  }

  async deleteAll(
    api: TelegramDeleteApi,
    chatId: number,
    reason: string,
  ): Promise<DeleteAllResult> {
    const ids = this.idsByChat.get(chatId);
    const result: DeleteAllResult = { deleted: 0, failed: 0 };
    if (!ids || ids.size === 0) {
      return result;
    }

    // Copy then clear up-front so concurrent sends during deletion are still
    // captured for the NEXT cleanup instead of being lost mid-flight.
    const pending = [...ids];
    this.clear(chatId);

    let isFirst = true;
    for (const messageId of pending) {
      if (!isFirst) {
        await sleep(DELETE_PACE_DELAY_MS);
      }
      isFirst = false;

      try {
        await api.deleteMessage(chatId, messageId);
        result.deleted++;
      } catch (error) {
        if (isToleratedDeleteError(error)) {
          logger.debug(
            `[ConversationTracker] Skipped undeletable message ${messageId} in chat ${chatId}:`,
            error,
          );
        } else {
          logger.warn(
            `[ConversationTracker] Failed to delete message ${messageId} in chat ${chatId}:`,
            error,
          );
        }
        result.failed++;
      }
    }

    logger.debug(
      `[ConversationTracker] Cleanup done (${reason}): chat=${chatId}, deleted=${result.deleted}, failed=${result.failed}`,
    );
    return result;
  }

  clear(chatId: number): void {
    this.idsByChat.delete(chatId);
  }

  __resetForTests(): void {
    this.idsByChat.clear();
  }
}

export const conversationMessageTracker = new ConversationMessageTracker();
