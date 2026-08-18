import { Context } from "grammy";
import { getCurrentSession } from "../../app/services/session-service.js";
import { t } from "../../i18n/index.js";
import {
  getRememberedAssistantResponse,
  sendAssistantResponseDocument,
} from "../services/assistant-response-export-service.js";

export async function lastfileCommand(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  const sessionId = getCurrentSession()?.id;
  if (!chatId || !sessionId) {
    await ctx.reply(t("bot.lastfile_empty"));
    return;
  }

  const response = getRememberedAssistantResponse(chatId, sessionId);
  if (!response) {
    await ctx.reply(t("bot.lastfile_empty"));
    return;
  }

  try {
    await sendAssistantResponseDocument(ctx.api, chatId, response);
  } catch {
    await ctx.reply(t("bot.lastfile_error"));
  }
}
