import type { Context } from "grammy";
import { getRecentCommits } from "../../app/services/git-service.js";
import { isForegroundBusy } from "../../app/services/run-control-service.js";
import { getCurrentProject } from "../../app/stores/settings-store.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { buildLogMenuView } from "../menus/log-menu.js";
import { replyWithInlineMenu } from "../menus/inline-menu.js";
import { replyBusyBlocked } from "../messages/busy-blocked-renderer.js";

const LOG_COMMIT_LIMIT = 10;

export async function runLogFlow(ctx: Context) {
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

    let commits;
    try {
      commits = await getRecentCommits(currentProject.worktree, LOG_COMMIT_LIMIT);
    } catch (error) {
      logger.debug("[Bot] Log flow failed to read git history:", error);
      await ctx.reply(t("worktree.not_git_repo"));
      return;
    }

    if (commits.length === 0) {
      await ctx.reply(t("log.empty"));
      return;
    }

    const { text, keyboard } = buildLogMenuView(commits);

    await replyWithInlineMenu(ctx, {
      menuKind: "log",
      text,
      keyboard,
      metadata: {
        dir: currentProject.worktree,
        commits,
      },
    });
  } catch (error) {
    logger.error("[Bot] Error building log menu:", error);
    await ctx.reply(t("log.error"));
  }
}
