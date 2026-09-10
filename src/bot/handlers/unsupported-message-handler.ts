import type { Context } from "grammy";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";

const UNSUPPORTED_CONTENT_FIELDS = [
  "video",
  "sticker",
  "animation",
  "video_note",
  "location",
  "contact",
  "poll",
] as const;

export async function handleUnsupportedMessage(ctx: Context): Promise<boolean> {
  return handleUnsupportedMessages([ctx]);
}

export async function handleUnsupportedMessages(contexts: Context[]): Promise<boolean> {
  const unsupportedContexts = contexts.filter((ctx) => getUnsupportedFields(ctx).length > 0);
  const replyContext = unsupportedContexts[0];
  if (!replyContext) {
    return false;
  }

  const types = Array.from(
    new Set(unsupportedContexts.flatMap((ctx) => getUnsupportedFields(ctx))),
  );
  const carriedFields = Array.from(
    new Set(
      unsupportedContexts.flatMap((ctx) =>
        ctx.message ? Object.keys(ctx.message).sort() : [],
      ),
    ),
  );

  logger.warn(
    `[Bot] Unsupported Telegram message: types=${types.join(",")}, fields=${carriedFields.join(",")}, chatId=${replyContext.chat?.id ?? "unknown"}, messageId=${replyContext.message?.message_id ?? "unknown"}`,
  );
  await replyContext.reply(t("bot.message_type_unsupported"));
  return true;
}

function getUnsupportedFields(ctx: Context): string[] {
  const message = ctx.message;
  if (!message) {
    return [];
  }

  return UNSUPPORTED_CONTENT_FIELDS.filter((field) => field in message);
}
