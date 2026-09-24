import { Context } from "grammy";
import { getStoredModel } from "../../app/services/model-selection-service.js";
import { opencodeClient } from "../../opencode/client.js";
import { getCurrentSession } from "../../app/services/session-service.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { alert, failure } from "./feedback.js";
import {
  appendInlineMenuCancelButton,
  clearActiveInlineMenu,
  ensureActiveInlineMenu,
  type InlineMenuDeps,
} from "../menus/inline-menu.js";
import { buildCompactConfirmationMenu } from "../menus/context-control-menu.js";

export async function handleCompactDetails(ctx: Context, deps: InlineMenuDeps): Promise<boolean> {
  if (ctx.callbackQuery?.data !== "compact:details") {
    return false;
  }

  if (!(await ensureActiveInlineMenu(ctx, "context", deps))) {
    return true;
  }

  if (deps.interactionManager.getSnapshot()?.metadata.stage !== "details") {
    await alert(ctx, "inline.inactive_callback");
    return true;
  }

  const session = getCurrentSession();
  if (!session) {
    clearActiveInlineMenu("context_session_missing", deps);
    await alert(ctx, "context.no_active_session");
    await ctx.deleteMessage().catch(() => {});
    return true;
  }

  await ctx.answerCallbackQuery();
  await ctx.editMessageText(t("context.confirm_text", { title: session.title }), {
    reply_markup: appendInlineMenuCancelButton(buildCompactConfirmationMenu(), "context"),
  });
  deps.interactionManager.transition({
    metadata: { ...deps.interactionManager.getSnapshot()?.metadata, stage: "confirm" },
  });
  return true;
}

/**
 * Handle compact confirmation callback
 * Calls OpenCode API to compact the session
 * @param ctx grammY context
 */
export async function handleCompactConfirm(
  ctx: Context,
  deps: InlineMenuDeps,
): Promise<boolean> {
  const callbackQuery = ctx.callbackQuery;

  if (!callbackQuery?.data || callbackQuery.data !== "compact:confirm") {
    return false;
  }

  const isActiveMenu = await ensureActiveInlineMenu(ctx, "context", deps);
  if (!isActiveMenu) {
    return true;
  }

  if (deps.interactionManager.getSnapshot()?.metadata.stage !== "confirm") {
    await alert(ctx, "inline.inactive_callback");
    return true;
  }

  logger.debug("[ContextHandler] Compact confirmed");

  try {
    const session = getCurrentSession();

    if (!session) {
      clearActiveInlineMenu("context_session_missing", deps);
      await alert(ctx, "context.no_active_session");
      await ctx.deleteMessage().catch(() => {});
      return true;
    }

    // Answer callback query and delete menu immediately
    await ctx.answerCallbackQuery({ text: t("context.callback_compacting") });
    clearActiveInlineMenu("context_compact_confirmed", deps);
    await ctx.deleteMessage().catch(() => {});

    // Send progress message
    const progressMessage = await ctx.reply(t("context.progress"));

    // Show typing indicator
    await ctx.api.sendChatAction(ctx.chat!.id, "typing");

    const storedModel = getStoredModel();

    logger.debug(
      `[ContextHandler] Calling summarize with sessionID=${session.id}, directory=${session.directory}, model=${storedModel.providerID}/${storedModel.modelID}`,
    );

    // Call summarize API (AI compaction)
    const { error } = await opencodeClient.session.summarize({
      sessionID: session.id,
      directory: session.directory,
      providerID: storedModel.providerID,
      modelID: storedModel.modelID,
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
    clearActiveInlineMenu("context_compact_error", deps);
    logger.error("[ContextHandler] Compact exception:", err);
    await failure(ctx, "context.error");
    await ctx.deleteMessage().catch(() => {});
    return true;
  }
}
