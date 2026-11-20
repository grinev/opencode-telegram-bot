import { Context } from "grammy";
import { getStoredModel } from "../../app/services/model-selection-service.js";
import { opencodeClient } from "../../opencode/client.js";
import { fetchSessionTitle, getCurrentSession } from "../../app/services/session-service.js";
import { formatSessionTitle } from "../../app/formatters/session-title-formatter.js";
import { logger } from "../../utils/logger.js";
import { safeBackgroundTask } from "../../utils/safe-background-task.js";
import { t } from "../../i18n/index.js";
import { alert, failure } from "./feedback.js";
import {
  appendInlineMenuCancelButton,
  clearActiveInlineMenu,
  ensureActiveInlineMenu,
  type InlineMenuDeps,
} from "../menus/inline-menu.js";
import { buildCompactConfirmationMenu } from "../menus/context-control-menu.js";

// A manual compaction runs in the background now, so a second confirm could start
// another one while the first is still running.
const compactingSessions = new Set<string>();

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
  const title = formatSessionTitle(await fetchSessionTitle(session));
  await ctx.editMessageText(t("context.confirm_text", { title }), {
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

    if (compactingSessions.has(session.id)) {
      clearActiveInlineMenu("context_compact_already_running", deps);
      await ctx.answerCallbackQuery({ text: t("context.callback_compacting") });
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
    const chatId = ctx.chat!.id;
    const api = ctx.api;
    const progressMessageId = progressMessage.message_id;

    logger.debug(
      `[ContextHandler] Calling summarize with sessionID=${session.id}, directory=${session.directory}, model=${storedModel.providerID}/${storedModel.modelID}`,
    );

    // The compaction can run for minutes on a large context: keep it out of the update
    // loop, or every command waits behind it and is then dropped as stale.
    const showResult = (text: string) =>
      api.editMessageText(chatId, progressMessageId, text).catch(() => undefined);
    compactingSessions.add(session.id);
    safeBackgroundTask({
      taskName: "session.summarize",
      task: () =>
        opencodeClient.session.summarize({
          sessionID: session.id,
          directory: session.directory,
          providerID: storedModel.providerID,
          modelID: storedModel.modelID,
        }),
      onSuccess: async ({ error }) => {
        compactingSessions.delete(session.id);
        if (error) {
          logger.error("[ContextHandler] Compact failed:", error);
          await showResult(t("context.error"));
          return;
        }
        logger.info(`[ContextHandler] Session compacted: ${session.id}`);
        await showResult(t("context.success"));
      },
      onError: async (error) => {
        compactingSessions.delete(session.id);
        logger.error("[ContextHandler] Compact failed:", error);
        await showResult(t("context.error"));
      },
    });

    return true;
  } catch (err) {
    clearActiveInlineMenu("context_compact_error", deps);
    logger.error("[ContextHandler] Compact exception:", err);
    await failure(ctx, "context.error");
    await ctx.deleteMessage().catch(() => {});
    return true;
  }
}
