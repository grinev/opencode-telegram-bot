import { Context } from "grammy";
import { getStoredModel } from "../../app/services/model-selection-service.js";
import { fetchSessionTitle, getCurrentSession } from "../../app/services/session-service.js";
import type { AppContainer } from "../../app/bootstrap/app-container.js";
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
import { compactionResultText } from "../events/handlers/manual-compaction-handler.js";

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
  deps: InlineMenuDeps & Pick<AppContainer, "manualCompaction">,
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

    const model = getStoredModel();
    const attempt = deps.manualCompaction.reserve(session);
    if (!attempt) {
      clearActiveInlineMenu("context_compact_already_running", deps);
      await ctx.answerCallbackQuery({ text: t("context.callback_compacting") }).catch(() => {});
      await ctx.deleteMessage().catch(() => {});
      return true;
    }

    clearActiveInlineMenu("context_compact_confirmed", deps);
    await ctx.answerCallbackQuery({ text: t("context.callback_compacting") }).catch(() => {});
    await ctx.deleteMessage().catch(() => {});

    const chatId = ctx.chat!.id;
    const api = ctx.api;
    const progress = deps.manualCompaction.showProgress(attempt, async () => {
      const message = await ctx.reply(t("context.progress"));
      return {
        finish: (outcome) => api.editMessageText(chatId, message.message_id, compactionResultText(outcome)),
      };
    });
    safeBackgroundTask({
      taskName: "session.summarize",
      task: () => deps.manualCompaction.start(attempt, model),
    });
    await progress;
    return true;
  } catch (err) {
    clearActiveInlineMenu("context_compact_error", deps);
    logger.error("[ContextHandler] Compact exception:", err);
    await failure(ctx, "context.error");
    await ctx.deleteMessage().catch(() => {});
    return true;
  }
}
