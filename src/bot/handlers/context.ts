import { Context, InlineKeyboard } from "grammy";
import { getCurrentSession } from "../../session/manager.js";
import { opencodeClient } from "../../opencode/client.js";
import { getStoredModel } from "../../model/manager.js";
import {
  clearActiveInlineMenu,
  ensureActiveInlineMenu,
  replyWithInlineMenu,
} from "./inline-menu.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";

/**
 * Build inline keyboard with compact confirmation menu
 * @returns InlineKeyboard with confirmation button
 */
export function buildCompactConfirmationMenu(): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  keyboard.text(t("context.button.confirm"), "compact:confirm");

  return keyboard;
}

/**
 * Handle context button press (text message from Reply Keyboard)
 * Shows inline menu with compact confirmation
 * @param ctx grammY context
 */
export async function handleContextButtonPress(ctx: Context): Promise<void> {
  logger.debug("[ContextHandler] Context button pressed");

  const session = getCurrentSession();

  if (!session) {
    await ctx.reply(t("context.no_active_session"));
    return;
  }

  const keyboard = buildCompactConfirmationMenu();

  await replyWithInlineMenu(ctx, {
    menuKind: "context",
    text: t("context.confirm_text", { title: session.title }),
    keyboard,
  });
}

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
      await ctx.answerCallbackQuery({ text: t("context.callback_session_not_found") });
      await ctx.reply(t("context.no_active_session"));
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
    clearActiveInlineMenu("context_compact_error");
    logger.error("[ContextHandler] Compact exception:", err);
    await ctx.answerCallbackQuery({ text: t("callback.processing_error") }).catch(() => {});
    await ctx.reply(t("context.error"));
    await ctx.deleteMessage().catch(() => {});
    return false;
  }
}
