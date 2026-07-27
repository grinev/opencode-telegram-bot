import type { Context } from "grammy";
import { cancelQueuedPrompt, PROMPT_QUEUE_CANCEL_PREFIX } from "../handlers/prompt-queue.js";
import { t } from "../../i18n/index.js";

/** Handles the inline "cancel" button attached to a queued-prompt acknowledgement. */
export async function handlePromptQueueCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data?.startsWith(PROMPT_QUEUE_CANCEL_PREFIX)) {
    return false;
  }

  const id = data.slice(PROMPT_QUEUE_CANCEL_PREFIX.length);
  const cancelled = await cancelQueuedPrompt(id);

  await ctx
    .answerCallbackQuery({
      text: cancelled ? t("prompt_queue.cancelled") : t("prompt_queue.cancel_too_late"),
    })
    .catch(() => {});

  return true;
}
