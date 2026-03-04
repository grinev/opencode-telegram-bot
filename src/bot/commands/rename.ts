import { CommandContext, Context, InlineKeyboard } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { getCurrentSession, setCurrentSession } from "../../session/manager.js";
import { renameManager } from "../../rename/manager.js";
import { interactionManager } from "../../interaction/manager.js";
import { pinnedMessageManager } from "../../pinned/manager.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { getScopeKeyFromContext } from "../scope.js";

function getCallbackMessageId(ctx: Context): number | null {
  const message = ctx.callbackQuery?.message;
  if (!message || !("message_id" in message)) {
    return null;
  }

  const messageId = (message as { message_id?: number }).message_id;
  return typeof messageId === "number" ? messageId : null;
}

export async function renameCommand(ctx: CommandContext<Context>): Promise<void> {
  try {
    const scopeKey = getScopeKeyFromContext(ctx);
    const currentSession = getCurrentSession(scopeKey);

    if (!currentSession) {
      await ctx.reply(t("rename.no_session"));
      return;
    }

    const keyboard = new InlineKeyboard().text(t("rename.button.cancel"), "rename:cancel");

    const message = await ctx.reply(t("rename.prompt", { title: currentSession.title }), {
      reply_markup: keyboard,
    });

    renameManager.startWaiting(
      currentSession.id,
      currentSession.directory,
      currentSession.title,
      scopeKey,
    );
    renameManager.setMessageId(message.message_id, scopeKey);
    interactionManager.start(
      {
        kind: "rename",
        expectedInput: "text",
        metadata: {
          sessionId: currentSession.id,
          messageId: message.message_id,
        },
      },
      scopeKey,
    );

    logger.info(`[RenameCommand] Waiting for new title for session: ${currentSession.id}`);
  } catch (error) {
    logger.error("[RenameCommand] Error starting rename flow:", error);
    await ctx.reply(t("rename.error"));
  }
}

export async function handleRenameCancel(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || data !== "rename:cancel") {
    return false;
  }

  const scopeKey = getScopeKeyFromContext(ctx);

  logger.debug("[RenameHandler] Cancel callback received");

  if (!renameManager.isWaitingForName(scopeKey)) {
    const state = interactionManager.getSnapshot(scopeKey);
    if (state?.kind === "rename") {
      interactionManager.clear("rename_cancel_inactive", scopeKey);
    }
    await ctx.answerCallbackQuery({ text: t("rename.inactive_callback"), show_alert: true });
    return true;
  }

  const interactionState = interactionManager.getSnapshot(scopeKey);
  if (interactionState?.kind !== "rename") {
    renameManager.clear(scopeKey);
    await ctx.answerCallbackQuery({ text: t("rename.inactive_callback"), show_alert: true });
    return true;
  }

  const callbackMessageId = getCallbackMessageId(ctx);
  if (!renameManager.isActiveMessage(callbackMessageId, scopeKey)) {
    await ctx.answerCallbackQuery({ text: t("rename.inactive_callback"), show_alert: true });
    return true;
  }

  renameManager.clear(scopeKey);
  interactionManager.clear("rename_cancelled", scopeKey);

  await ctx.answerCallbackQuery();
  await ctx.editMessageText(t("rename.cancelled")).catch(() => {});

  return true;
}

export async function handleRenameTextAnswer(ctx: Context): Promise<boolean> {
  const scopeKey = getScopeKeyFromContext(ctx);

  if (!renameManager.isWaitingForName(scopeKey)) {
    return false;
  }

  const text = ctx.message?.text;
  if (!text) {
    return false;
  }

  if (text.startsWith("/")) {
    return false;
  }

  const interactionState = interactionManager.getSnapshot(scopeKey);
  if (interactionState?.kind !== "rename") {
    renameManager.clear(scopeKey);
    await ctx.reply(t("rename.inactive"));
    return true;
  }

  const sessionInfo = renameManager.getSessionInfo(scopeKey);
  if (!sessionInfo) {
    renameManager.clear(scopeKey);
    interactionManager.clear("rename_missing_session_info", scopeKey);
    return false;
  }

  const newTitle = text.trim();
  if (!newTitle) {
    await ctx.reply(t("rename.empty_title"));
    return true;
  }

  logger.info(`[RenameHandler] Renaming session ${sessionInfo.sessionId} to: ${newTitle}`);

  try {
    const { data: updatedSession, error } = await opencodeClient.session.update({
      sessionID: sessionInfo.sessionId,
      directory: sessionInfo.directory,
      title: newTitle,
    });

    if (error || !updatedSession) {
      throw error || new Error("Failed to update session");
    }

    const nextSession = {
      id: sessionInfo.sessionId,
      title: newTitle,
      directory: sessionInfo.directory,
    };

    if (scopeKey === "global") {
      setCurrentSession(nextSession);
    } else {
      setCurrentSession(nextSession, scopeKey);
    }

    if (pinnedMessageManager.isInitialized()) {
      await pinnedMessageManager.onSessionChange(sessionInfo.sessionId, newTitle);
    }

    const messageId = renameManager.getMessageId(scopeKey);
    if (messageId && ctx.chat) {
      await ctx.api.deleteMessage(ctx.chat.id, messageId).catch(() => {});
    }

    await ctx.reply(t("rename.success", { title: newTitle }));

    logger.info(`[RenameHandler] Session renamed successfully: ${newTitle}`);
  } catch (error) {
    logger.error("[RenameHandler] Error renaming session:", error);
    await ctx.reply(t("rename.error"));
  }

  renameManager.clear(scopeKey);
  interactionManager.clear("rename_completed", scopeKey);
  return true;
}
