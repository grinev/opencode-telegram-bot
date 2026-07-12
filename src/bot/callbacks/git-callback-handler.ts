import type { Context } from "grammy";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { runCommitFlow } from "../flows/commit-flow.js";
import { runDiffFlow } from "../flows/diff-flow.js";
import { runPushFlow } from "../flows/push-flow.js";
import { runWorktreeFlow } from "../flows/worktree-flow.js";
import {
  GIT_COMMIT_CALLBACK,
  GIT_DIFF_CALLBACK,
  GIT_PUSH_CALLBACK,
  GIT_WORKTREE_CALLBACK,
} from "../menus/git-menu.js";
import { clearActiveInlineMenu, ensureActiveInlineMenu } from "../menus/inline-menu.js";

export async function handleGitCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (
    data !== GIT_DIFF_CALLBACK &&
    data !== GIT_COMMIT_CALLBACK &&
    data !== GIT_PUSH_CALLBACK &&
    data !== GIT_WORKTREE_CALLBACK
  ) {
    return false;
  }

  const isActiveMenu = await ensureActiveInlineMenu(ctx, "git");
  if (!isActiveMenu) {
    return true;
  }

  await ctx.answerCallbackQuery().catch(() => {});

  // The selected flow opens its own menu/interaction, so close this one first.
  clearActiveInlineMenu("git_action_selected");
  await ctx.deleteMessage().catch(() => {});

  try {
    if (data === GIT_DIFF_CALLBACK) {
      await runDiffFlow(ctx);
    } else if (data === GIT_COMMIT_CALLBACK) {
      await runCommitFlow(ctx);
    } else if (data === GIT_PUSH_CALLBACK) {
      await runPushFlow(ctx);
    } else {
      await runWorktreeFlow(ctx);
    }
  } catch (error) {
    logger.error("[GitHandler] Error handling git action:", error);
    await ctx.reply(t("callback.processing_error")).catch(() => {});
  }

  return true;
}
