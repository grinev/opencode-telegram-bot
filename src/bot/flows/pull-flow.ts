import type { Context } from "grammy";
import { getRepoStatus, pullCurrentBranch } from "../../app/services/git-service.js";
import { isForegroundBusy } from "../../app/services/run-control-service.js";
import { getCurrentProject } from "../../app/stores/settings-store.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { replyBusyBlocked } from "../messages/busy-blocked-renderer.js";
import { shortGitErrorText } from "./git-error-text.js";

export async function runPullFlow(ctx: Context) {
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

    let status;
    try {
      status = await getRepoStatus(currentProject.worktree);
    } catch (error) {
      logger.debug("[Bot] Pull flow failed to read git status:", error);
      await ctx.reply(t("worktree.not_git_repo"));
      return;
    }

    if (status.detached) {
      await ctx.reply(t("git.pull.detached"));
      return;
    }

    if (!status.hasUpstream) {
      await ctx.reply(t("git.pull.no_upstream"));
      return;
    }

    const progressMessage = await ctx.reply(t("git.pull.pulling"));

    let result;
    try {
      result = await pullCurrentBranch(currentProject.worktree);
    } catch (error) {
      logger.error("[Bot] Pull failed:", error);
      await ctx.api
        .deleteMessage(progressMessage.chat.id, progressMessage.message_id)
        .catch(() => {});
      await ctx.reply(t("git.pull.error", { error: shortGitErrorText(error) }));
      return;
    }

    await ctx.api
      .deleteMessage(progressMessage.chat.id, progressMessage.message_id)
      .catch(() => {});

    if (result.pulledCommits === 0) {
      await ctx.reply(t("git.pull.nothing"));
      return;
    }

    await ctx.reply(
      t("git.pull.success", {
        count: String(result.pulledCommits),
        branch: status.branch,
      }),
    );
  } catch (error) {
    logger.error("[Bot] Error running pull flow:", error);
    await ctx.reply(t("git.pull.error", { error: shortGitErrorText(error) })).catch(() => {});
  }
}
