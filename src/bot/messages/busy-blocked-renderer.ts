import type { Context } from "grammy";
import { t } from "../../i18n/index.js";

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
