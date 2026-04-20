import type { Context } from "grammy";
import { foregroundSessionState } from "../../scheduled-task/foreground-state.js";
import { attachManager } from "../../attach/manager.js";
import { t } from "../../i18n/index.js";

export function isForegroundBusy(): boolean {
  return foregroundSessionState.isBusy() || attachManager.isBusy();
}

export async function replyBusyBlocked(ctx: Context): Promise<void> {
  const message = t("bot.session_busy");

  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery({ text: message }).catch(() => {});
    return;
  }

  if (ctx.chat) {
    await ctx.reply(message).catch(() => {});
  }
}
