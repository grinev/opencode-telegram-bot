import { Context, InlineKeyboard } from "grammy";
import { getCurrentSession, setCurrentSession } from "../../session/manager.js";
import { interactionManager } from "../../interaction/manager.js";
import { opencodeClient } from "../../opencode/client.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";

const RENAME_CANCEL_CALLBACK = "session:rename:cancel";

export const RENAME_FLOW = "rename";

export function buildRenameCancelKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text(t("inline.button.cancel"), RENAME_CANCEL_CALLBACK);
}

export async function renameCommand(ctx: Context): Promise<void> {
  const session = getCurrentSession();

  if (!session) {
    await ctx.reply(t("session.rename.no_session"));
    return;
  }

  const keyboard = buildRenameCancelKeyboard();
  const message = await ctx.reply(t("session.rename.prompt"), {
    reply_markup: keyboard,
  });

  interactionManager.start({
    kind: "custom",
    expectedInput: "mixed",
    allowedCommands: ["/stop"],
    metadata: {
      flow: RENAME_FLOW,
      messageId: message.message_id,
    },
  });

  logger.debug(`[Rename] Started rename flow for session "${session.title}" (id=${session.id})`);
}

export async function handleRenameTextInput(ctx: Context): Promise<boolean> {
  const state = interactionManager.getSnapshot();
  if (!state || state.kind !== "custom" || state.metadata.flow !== RENAME_FLOW) {
    return false;
  }

  const text = ctx.message?.text?.trim();

  if (!text) {
    await ctx.reply(t("session.rename.empty"));
    return true;
  }

  const session = getCurrentSession();
  if (!session) {
    // Session disappeared during rename flow — abort gracefully
    interactionManager.clear("rename_session_gone");
    await ctx.reply(t("session.rename.no_session"));
    return true;
  }

  try {
    const result = await opencodeClient.session.update({
      sessionID: session.id,
      directory: session.directory,
      title: text,
    });

    if (result.error) {
      logger.error("[Rename] SDK returned error:", result.error);
      await ctx.reply(t("session.rename.error"));
      return true;
    }

    setCurrentSession({ ...session, title: text });
    interactionManager.clear("rename_completed");

    const promptMessageId = state.metadata.messageId;
    if (typeof promptMessageId === "number") {
      await ctx.api.deleteMessage(ctx.chat!.id, promptMessageId).catch(() => {});
    }

    await ctx.reply(t("session.rename.success", { title: text }));
    logger.info(`[Rename] Session renamed: "${session.title}" -> "${text}" (id=${session.id})`);
  } catch (err) {
    logger.error("[Rename] Failed to rename session:", err);
    await ctx.reply(t("session.rename.error"));
  }

  return true;
}

export async function handleRenameCancelCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (data !== RENAME_CANCEL_CALLBACK) {
    return false;
  }

  const state = interactionManager.getSnapshot();
  if (!state || state.kind !== "custom" || state.metadata.flow !== RENAME_FLOW) {
    await ctx.answerCallbackQuery({ text: t("inline.inactive_callback"), show_alert: true });
    return true;
  }

  interactionManager.clear("rename_cancelled");

  await ctx.answerCallbackQuery({ text: t("inline.cancelled_callback") }).catch(() => {});
  await ctx.deleteMessage().catch(() => {});

  logger.debug("[Rename] Rename flow cancelled by user");

  return true;
}
