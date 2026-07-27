import { CommandContext, Context } from "grammy";
import { getCurrentSession } from "../../app/services/session-service.js";
import { getQueueDepth, unqueueLatestPrompt } from "../handlers/prompt-queue.js";
import { t } from "../../i18n/index.js";

/** Longest slice of the removed prompt echoed back for confirmation. */
const PREVIEW_LENGTH = 80;

function previewText(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > PREVIEW_LENGTH ? `${trimmed.slice(0, PREVIEW_LENGTH - 1)}…` : trimmed;
}

/** Removes the most recently queued prompt for the current session. */
export async function unqueueCommand(ctx: CommandContext<Context>): Promise<void> {
  const currentSession = getCurrentSession();
  if (!currentSession) {
    await ctx.reply(t("unqueue.empty"));
    return;
  }

  const item = await unqueueLatestPrompt(currentSession.id);
  if (!item) {
    await ctx.reply(t("unqueue.empty"));
    return;
  }

  await ctx.reply(
    t("unqueue.removed", {
      remaining: getQueueDepth(currentSession.id),
      preview: previewText(item.text),
    }),
  );
}
