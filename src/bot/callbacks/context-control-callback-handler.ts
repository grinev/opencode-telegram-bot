import { Context } from "grammy";
import { getStoredModel } from "../../app/services/model-selection-service.js";
import { opencodeV2 } from "../../opencode/client.js";
import { getCurrentSession } from "../../app/services/session-service.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { alert, failure } from "./feedback.js";
import { clearActiveInlineMenu, ensureActiveInlineMenu } from "../menus/inline-menu.js";

/**
 * Handle compact confirmation callback
 * Calls OpenCode API to compact the session
 * @param ctx grammY context
 */
export async function handleCompactConfirm(ctx: Context): Promise<boolean> {
  const callbackQuery = ctx.callbackQuery;

  if (!callbackQuery?.data || callbackQuery.data !== "compact:confirm") {
    return false;
  }

  const isActiveMenu = await ensureActiveInlineMenu(ctx, "context");
  if (!isActiveMenu) {
    return true;
  }

  logger.debug("[ContextHandler] Compact confirmed");

  try {
    const session = getCurrentSession();

    if (!session) {
      clearActiveInlineMenu("context_session_missing");
      await alert(ctx, "context.no_active_session");
      await ctx.deleteMessage().catch(() => {});
      return true;
    }

    // Answer callback query and delete menu immediately
    await ctx.answerCallbackQuery({ text: t("context.callback_compacting") });
    clearActiveInlineMenu("context_compact_confirmed");
    await ctx.deleteMessage().catch(() => {});

    // Send progress message
    const progressMessage = await ctx.reply(t("context.progress"));

    // Show typing indicator
    await ctx.api.sendChatAction(ctx.chat!.id, "typing");

    const storedModel = getStoredModel();

    logger.debug(
      `[ContextHandler] Calling summarize with sessionID=${session.id}, directory=${session.directory}, model=${storedModel.providerID}/${storedModel.modelID}`,
    );

    // Call compact API (AI compaction runs with the session's current model)
    const { error } = await opencodeV2.session.compact({
      sessionID: session.id,
    });

    if (error) {
      logger.error("[ContextHandler] Compact failed:", error);
      // Update progress message to show error
      await ctx.api
        .editMessageText(ctx.chat!.id, progressMessage.message_id, t("context.error"))
        .catch(() => {});
      return true;
    }

    logger.info(`[ContextHandler] Session compacted: ${session.id}`);
    // Update progress message to show success
    await ctx.api
      .editMessageText(ctx.chat!.id, progressMessage.message_id, t("context.success"))
      .catch(() => {});

    return true;
  } catch (err) {
    clearActiveInlineMenu("context_compact_error");
    logger.error("[ContextHandler] Compact exception:", err);
    await failure(ctx, "context.error");
    await ctx.deleteMessage().catch(() => {});
    return true;
  }
}
