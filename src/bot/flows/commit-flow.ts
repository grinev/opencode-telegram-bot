import type { Context } from "grammy";
import { generateCommitMessage } from "../../app/services/commit-message-service.js";
import { hasChanges } from "../../app/services/git-service.js";
import { isForegroundBusy } from "../../app/services/run-control-service.js";
import { getCurrentProject } from "../../app/stores/settings-store.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { showCommitConfirmation } from "../menus/commit-menu.js";
import { replyBusyBlocked } from "../messages/busy-blocked-renderer.js";

export async function runCommitFlow(ctx: Context) {
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

    let changed: boolean;
    try {
      changed = await hasChanges(currentProject.worktree);
    } catch (error) {
      logger.debug("[Bot] Commit flow failed to read git status:", error);
      await ctx.reply(t("worktree.not_git_repo"));
      return;
    }

    if (!changed) {
      await ctx.reply(t("commit.no_changes"));
      return;
    }

    const generatingMessage = await ctx.reply(t("commit.generating"));
    const result = await generateCommitMessage(currentProject.worktree);
    await ctx.api
      .deleteMessage(generatingMessage.chat.id, generatingMessage.message_id)
      .catch(() => {});

    await showCommitConfirmation(ctx, currentProject.worktree, result.message, result.generated);
  } catch (error) {
    logger.error("[Bot] Error preparing commit:", error);
    await ctx.reply(t("commit.error"));
  }
}
