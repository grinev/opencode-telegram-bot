import type { Context, NextFunction } from "grammy";
import { telegramOutageNoticeService } from "../../app/services/telegram-outage-notice-service.js";
import { updateBusyWindowService } from "../../app/services/update-busy-window-service.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";

const BUSY_NOTICE_DELAY_MS = 5000;

/**
 * Records a handler that outlived the busy-cancel window, and tells the chat when a handler
 * blocks silently for too long: a message delayed by the bot itself is not an outage, and
 * the user must not be left without feedback long enough to resend it.
 */
export async function updateBusyWindowMiddleware(ctx: Context, next: NextFunction): Promise<void> {
  const startedAt = Date.now();
  const chatId = ctx.chat?.id;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let completed = false;

  if (typeof chatId === "number" && ctx.api) {
    const api = ctx.api;
    const checkSilence = (): void => {
      timer = null;
      if (completed) {
        return;
      }

      const sinceLastSend = telegramOutageNoticeService.msSinceLastChatSend();
      if (sinceLastSend !== null && sinceLastSend < BUSY_NOTICE_DELAY_MS) {
        // The chat already shows progress; look again once the gap is long enough.
        timer = setTimeout(checkSilence, BUSY_NOTICE_DELAY_MS - sinceLastSend);
        return;
      }

      void api.sendMessage(chatId, t("bot.busy_operation")).catch((error) => {
        logger.warn("[UpdateBusyWindow] Failed to send the busy notice:", error);
      });
    };
    timer = setTimeout(checkSilence, BUSY_NOTICE_DELAY_MS);
  }

  try {
    await next();
  } finally {
    completed = true;
    if (timer !== null) {
      clearTimeout(timer);
    }
    updateBusyWindowService.record(startedAt, Date.now());
  }
}
