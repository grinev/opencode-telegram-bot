import type { CommandContext, Context } from "grammy";
import { getChangedFiles } from "../../app/services/git-service.js";
import { isForegroundBusy } from "../../app/services/run-control-service.js";
import { getCurrentProject } from "../../app/stores/settings-store.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { buildDiffMenuView } from "../menus/diff-menu.js";
import { replyWithInlineMenu } from "../menus/inline-menu.js";
import { replyBusyBlocked } from "../messages/busy-blocked-renderer.js";

export async function diffCommand(ctx: CommandContext<Context>) {
  try {
    if (isForegroundBusy()) {
      await replyBusyBlocked(ctx);
      return;
    }

    const currentProject = getCurrentProject();
    if (!currentProject) {
      await ctx.reply(t("worktree.project_not_selected"));
      return;
    }

    let files;
    try {
      files = await getChangedFiles(currentProject.worktree);
    } catch (error) {
      logger.debug("[Bot] /diff failed to read git status:", error);
      await ctx.reply(t("worktree.not_git_repo"));
      return;
    }

    if (files.length === 0) {
      await ctx.reply(t("diff.no_changes"));
      return;
    }

    const { text, keyboard } = buildDiffMenuView(files);

    await replyWithInlineMenu(ctx, {
      menuKind: "diff",
      text,
      keyboard,
      metadata: {
        dir: currentProject.worktree,
        files,
      },
    });
  } catch (error) {
    logger.error("[Bot] Error building diff menu:", error);
    await ctx.reply(t("diff.file_error"));
  }
}
