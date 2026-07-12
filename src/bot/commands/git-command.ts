import type { CommandContext, Context } from "grammy";
import { isForegroundBusy } from "../../app/services/run-control-service.js";
import { getCurrentProject } from "../../app/stores/settings-store.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { buildGitMenuView } from "../menus/git-menu.js";
import { replyWithInlineMenu } from "../menus/inline-menu.js";
import { replyBusyBlocked } from "../messages/busy-blocked-renderer.js";

export async function gitCommand(ctx: CommandContext<Context>) {
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

    const { text, keyboard } = buildGitMenuView();

    await replyWithInlineMenu(ctx, {
      menuKind: "git",
      text,
      keyboard,
    });
  } catch (error) {
    logger.error("[Bot] Error building git menu:", error);
    await ctx.reply(t("callback.processing_error"));
  }
}
