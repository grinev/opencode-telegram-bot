import { AsyncLocalStorage } from "node:async_hooks";
import type { Api } from "grammy";
import { t } from "../i18n/index.js";
import {
  telegramOutageNoticeService,
  type TelegramOutageNoticeKind,
} from "../app/services/telegram-outage-notice-service.js";
import { logger } from "../utils/logger.js";

export interface FlushTelegramOutageNoticesOptions {
  api: Api;
  chatId: number;
}

const unretriedSend = new AsyncLocalStorage<true>();

const NOTICE_TEXT: Record<
  TelegramOutageNoticeKind,
  "bot.assistant_reply_undelivered" | "bot.stale_messages_skipped" | "bot.busy_messages_skipped"
> = {
  undelivered: "bot.assistant_reply_undelivered",
  skipped: "bot.stale_messages_skipped",
  busy: "bot.busy_messages_skipped",
};

export function isUnretriedTelegramSend(): boolean {
  return unretriedSend.getStore() === true;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForSendSlot(): Promise<void> {
  while (true) {
    const waitMs = telegramOutageNoticeService.msUntilAllowedSend();
    if (waitMs <= 0) {
      return;
    }
    await wait(waitMs);
  }
}

async function sendNotice(
  options: FlushTelegramOutageNoticesOptions,
  kind: TelegramOutageNoticeKind,
): Promise<boolean> {
  await waitForSendSlot();

  try {
    await unretriedSend.run(true, () => options.api.sendMessage(options.chatId, t(NOTICE_TEXT[kind])));
    telegramOutageNoticeService.noteChatSendSucceeded();
    telegramOutageNoticeService.reportNoticeResult(kind, true);
    return true;
  } catch (error) {
    logger.error(`[OutageNotice] Failed to send ${kind} notice`, error);
    telegramOutageNoticeService.reportNoticeResult(kind, false);
    return false;
  }
}

export async function flushTelegramOutageNotices(
  options: FlushTelegramOutageNoticesOptions,
): Promise<void> {
  const due = telegramOutageNoticeService.takeDueNotices();
  if (!due) {
    return;
  }

  try {
    if (due.undelivered) {
      await sendNotice(options, "undelivered");
    }
    if (due.skipped) {
      await sendNotice(options, "skipped");
    }
    if (due.busy) {
      await sendNotice(options, "busy");
    }
  } finally {
    telegramOutageNoticeService.finishFlush();
  }
}
