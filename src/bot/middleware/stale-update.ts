import type { Context, NextFunction } from "grammy";
import { telegramOutageNoticeService } from "../../app/services/telegram-outage-notice-service.js";
import {
  BUSY_CANCEL_MS,
  STALE_THRESHOLD_MS,
  updateBusyWindowService,
} from "../../app/services/update-busy-window-service.js";
import { flushTelegramOutageNotices } from "../telegram-outage-notices.js";
import { logger } from "../../utils/logger.js";

// Telegram keeps undelivered updates for up to 24 hours, so a message can reach
// the bot long after it was sent - after a restart, or after long polling was
// interrupted by a network outage. Acting on such a message is unwanted: it
// would start tasks the user no longer expects to run.
const MAX_MESSAGE_AGE_SECONDS = STALE_THRESHOLD_MS / 1000;
// A message the bot delayed itself is executed after the handler, but only within this
// window: the chat has had feedback by then (the 5-second busy notice or streaming
// progress), and older commands are dropped with an honest notice instead of being
// executed late.
const BUSY_CANCEL_SECONDS = BUSY_CANCEL_MS / 1000;

export async function staleUpdateMiddleware(ctx: Context, next: NextFunction): Promise<void> {
  // Only `ctx.message` carries the time the user acted. `ctx.msg` also resolves
  // to `ctx.callbackQuery.message`, which is the bot's own message holding the
  // buttons - using it here would drop every press under an older message.
  const message = ctx.message;
  if (!message) {
    await next();
    return;
  }

  const ageSeconds = Math.floor(Date.now() / 1000) - message.date;
  const chatId = ctx.chat?.id;
  const canNotify = typeof chatId === "number" && ctx.api !== undefined;

  if (ageSeconds <= BUSY_CANCEL_SECONDS) {
    telegramOutageNoticeService.closeBurst();
    if (canNotify) {
      await flushTelegramOutageNotices({ api: ctx.api, chatId });
    }
    await next();
    return;
  }

  // The bot was busy when this message arrived: Telegram delivered it, the update loop
  // was held by a long handler. That is not an outage, so it gets its own notice.
  const delayedByBusyBot = updateBusyWindowService.covers(message.date * 1000);
  if (delayedByBusyBot) {
    telegramOutageNoticeService.markMessagesSkipped("busy");
    logger.warn(
      `[StaleUpdate] Ignored a message delayed by a long handler: ageSeconds=${ageSeconds}, updateId=${ctx.update.update_id}, messageId=${message.message_id}`,
    );
    if (canNotify) {
      await flushTelegramOutageNotices({ api: ctx.api, chatId });
    }
    return;
  }

  if (ageSeconds > MAX_MESSAGE_AGE_SECONDS) {
    telegramOutageNoticeService.markMessagesSkipped("outage");
    logger.warn(
      `[StaleUpdate] Ignored stale message: ageSeconds=${ageSeconds}, updateId=${ctx.update.update_id}, messageId=${message.message_id}`,
    );
    if (canNotify) {
      await flushTelegramOutageNotices({ api: ctx.api, chatId });
    }
    return;
  }

  // Delayed without a recorded busy window: the transport was slow, or the delay came from
  // a backlog of shorter handlers. Execute it.
  telegramOutageNoticeService.closeBurst();
  if (canNotify) {
    await flushTelegramOutageNotices({ api: ctx.api, chatId });
  }
  await next();
}
