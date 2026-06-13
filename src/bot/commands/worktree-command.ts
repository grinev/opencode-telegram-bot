import type { CommandContext, Context } from "grammy";
import { getGitWorktreeContext } from "../../app/services/worktree-service.js";
import { isForegroundBusy } from "../../app/services/run-control-service.js";
import { getCurrentProject } from "../../app/stores/settings-store.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { replyWithInlineMenu } from "../menus/inline-menu.js";
import { buildWorktreeMenuView } from "../menus/worktree-selection-menu.js";
import { replyBusyBlocked } from "../messages/busy-blocked-renderer.js";

async function loadCurrentWorktreeContext() {
  const currentProject = getCurrentProject();
  if (!currentProject) {
    return { currentProject: null, context: null };
  }

  const context = await getGitWorktreeContext(currentProject.worktree);
  return { currentProject, context };
}

export async function worktreeCommand(ctx: CommandContext<Context>) {
  try {
    if (isForegroundBusy()) {
      await replyBusyBlocked(ctx);
      return;
    }

    const { currentProject, context } = await loadCurrentWorktreeContext();

    if (!currentProject) {
      await ctx.reply(t("worktree.project_not_selected"));
      return;
    }

    if (!context) {
      await ctx.reply(t("worktree.not_git_repo"));
      return;
    }

    if (context.worktrees.length === 0) {
      await ctx.reply(t("worktree.empty"));
      return;
    }

    const { text, keyboard } = buildWorktreeMenuView(context.worktrees, 0);

    await replyWithInlineMenu(ctx, {
      menuKind: "worktree",
      text,
      keyboard,
    });
  } catch (error) {
    logger.error("[Bot] Error loading worktrees:", error);
    await ctx.reply(t("worktree.fetch_error"));
  }
}
