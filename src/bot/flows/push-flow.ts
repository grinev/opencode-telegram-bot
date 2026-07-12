import type { Context } from "grammy";
import { getRepoStatus, pushCurrentBranch } from "../../app/services/git-service.js";
import { isForegroundBusy } from "../../app/services/run-control-service.js";
import { getCurrentProject } from "../../app/stores/settings-store.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { replyBusyBlocked } from "../messages/busy-blocked-renderer.js";

const MAX_ERROR_LENGTH = 200;

function shortErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // execFile errors start with "Command failed: git push"; the stderr after
  // it is the part worth showing.
  const detail = message.replace(/^Command failed:.*\n?/, "").trim() || message;
  return detail.length > MAX_ERROR_LENGTH ? `${detail.slice(0, MAX_ERROR_LENGTH)}…` : detail;
}

export async function runPushFlow(ctx: Context) {
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
      logger.debug("[Bot] Push flow failed to read git status:", error);
      await ctx.reply(t("worktree.not_git_repo"));
      return;
    }

    if (status.detached) {
      await ctx.reply(t("git.push.detached"));
      return;
    }

    if (status.hasUpstream && status.ahead === 0) {
      await ctx.reply(t("git.push.nothing"));
      return;
    }

    const progressMessage = await ctx.reply(t("git.push.pushing"));

    try {
      await pushCurrentBranch(currentProject.worktree, status.branch, !status.hasUpstream);
    } catch (error) {
      logger.error("[Bot] Push failed:", error);
      await ctx.api
        .deleteMessage(progressMessage.chat.id, progressMessage.message_id)
        .catch(() => {});
      await ctx.reply(t("git.push.error", { error: shortErrorText(error) }));
      return;
    }

    await ctx.api
      .deleteMessage(progressMessage.chat.id, progressMessage.message_id)
      .catch(() => {});

    const successText = status.hasUpstream
      ? t("git.push.success", { count: String(status.ahead), branch: status.branch })
      : t("git.push.success_new", { branch: status.branch });
    await ctx.reply(successText);
  } catch (error) {
    logger.error("[Bot] Error running push flow:", error);
    await ctx.reply(t("git.push.error", { error: shortErrorText(error) })).catch(() => {});
  }
}
