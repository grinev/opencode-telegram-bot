import { Context } from "grammy";
import type { AppContainer } from "../../app/bootstrap/app-container.js";
import { opencodeClient } from "../../opencode/client.js";
import { getCurrentSession, updateSelectedSessionTitle } from "../../app/services/session-service.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { cancelPrompt } from "./feedback.js";
import { RENAME_CANCEL_CALLBACK } from "../menus/rename-menu.js";

function getCallbackMessageId(ctx: Context): number | null {
  const message = ctx.callbackQuery?.message;
  if (!message || !("message_id" in message)) {
    return null;
  }

  const messageId = (message as { message_id?: number }).message_id;
  return typeof messageId === "number" ? messageId : null;
}

export type RenameCallbackDeps = Pick<
  AppContainer,
  "interactionManager" | "keyboardManager" | "renameManager"
>;

function clearRenameInteraction(deps: RenameCallbackDeps, reason: string): void {
  const state = deps.interactionManager.getSnapshot();
  if (state?.kind === "rename") {
    deps.interactionManager.clear(reason);
  }
}

export async function handleRenameCancel(ctx: Context, deps: RenameCallbackDeps): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || data !== RENAME_CANCEL_CALLBACK) {
    return false;
  }

  logger.debug("[RenameHandler] Cancel callback received");

  if (!deps.renameManager.isWaitingForName()) {
    clearRenameInteraction(deps, "rename_cancel_inactive");
    await ctx.answerCallbackQuery({ text: t("rename.inactive_callback"), show_alert: true });
    return true;
  }

  const interactionState = deps.interactionManager.getSnapshot();
  if (interactionState?.kind !== "rename") {
    deps.renameManager.clear();
    await ctx.answerCallbackQuery({ text: t("rename.inactive_callback"), show_alert: true });
    return true;
  }

  const callbackMessageId = getCallbackMessageId(ctx);
  if (!deps.renameManager.isActiveMessage(callbackMessageId)) {
    await ctx.answerCallbackQuery({ text: t("rename.inactive_callback"), show_alert: true });
    return true;
  }

  clearRenameInteraction(deps, "rename_cancelled");
  deps.renameManager.clear();

  await cancelPrompt(ctx, "rename.cancelled");

  return true;
}

export async function handleRenameTextAnswer(
  ctx: Context,
  deps: RenameCallbackDeps,
): Promise<boolean> {
  if (!deps.renameManager.isWaitingForName()) {
    return false;
  }

  const text = ctx.message?.text;
  if (text === undefined) {
    return false;
  }

  if (text.startsWith("/")) {
    return false;
  }

  const interactionState = deps.interactionManager.getSnapshot();
  if (interactionState?.kind !== "rename") {
    deps.renameManager.clear();
    await ctx.reply(t("rename.inactive"));
    return true;
  }

  const sessionInfo = deps.renameManager.getSessionInfo();
  if (!sessionInfo) {
    clearRenameInteraction(deps, "rename_missing_session_info");
    deps.renameManager.clear();
    // Answer here: returning false would send the new title to OpenCode as a prompt.
    await ctx.reply(t("rename.inactive"));
    return true;
  }

  const newTitle = text.trim();
  if (!newTitle) {
    await ctx.reply(t("rename.empty_title"));
    return true;
  }

  logger.info(`[RenameHandler] Renaming session ${sessionInfo.sessionId} to: ${newTitle}`);

  deps.renameManager.submitTitle(newTitle);
  const messageId = deps.renameManager.getMessageId();
  try {
    const { data: updatedSession, error } = await opencodeClient.session.update({
      sessionID: sessionInfo.sessionId,
      directory: sessionInfo.directory,
      title: newTitle,
    });

    if (error || !updatedSession) {
      throw error || new Error("Failed to update session");
    }

    const selected = getCurrentSession();
    if (selected?.id === sessionInfo.sessionId && selected.directory === sessionInfo.directory) {
      updateSelectedSessionTitle(selected.id, updatedSession.title || newTitle);
    }

    if (messageId && ctx.chat) {
      await ctx.api.deleteMessage(ctx.chat.id, messageId).catch(() => {});
    }

    const keyboard = deps.keyboardManager.getKeyboard();
    await ctx.reply(t("rename.success", { title: newTitle }), keyboard ? { reply_markup: keyboard } : undefined);

    logger.info(`[RenameHandler] Session renamed successfully: ${newTitle}`);
  } catch (error) {
    logger.error("[RenameHandler] Error renaming session:", error);
    const keyboard = deps.keyboardManager.getKeyboard();
    await ctx.reply(t("rename.error"), keyboard ? { reply_markup: keyboard } : undefined);
  }

  clearRenameInteraction(deps, "rename_completed");
  deps.renameManager.clear();
  return true;
}
