import type { Context } from "grammy";
import { clearAllInteractionState } from "../../app/managers/interaction-manager.js";
import { getProjectByWorktree } from "../../app/services/project-service.js";
import { isForegroundBusy } from "../../app/services/run-control-service.js";
import { switchToProject } from "../../app/services/project-switch-service.js";
import { getGitWorktreeContext } from "../../app/services/worktree-service.js";
import { upsertSessionDirectory } from "../../app/services/session-cache-service.js";
import { getCurrentProject } from "../../app/stores/settings-store.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { appendInlineMenuCancelButton, ensureActiveInlineMenu } from "../menus/inline-menu.js";
import {
  buildWorktreeMenuView,
  parseWorktreeIndexCallback,
  parseWorktreePageCallback,
  WORKTREE_CALLBACK_PREFIX,
} from "../menus/worktree-selection-menu.js";
import { replyBusyBlocked } from "../messages/busy-blocked-renderer.js";
import { createProjectSwitchPresentation } from "../services/project-switch-presentation.js";

interface WorktreeCallbackDeps {
  ensureEventSubscription?: (directory: string) => Promise<void>;
}

async function loadCurrentWorktreeContext() {
  const currentProject = getCurrentProject();
  if (!currentProject) {
    return { currentProject: null, context: null };
  }

  const context = await getGitWorktreeContext(currentProject.worktree);
  return { currentProject, context };
}

export async function handleWorktreeCallback(
  ctx: Context,
  deps: WorktreeCallbackDeps = {},
): Promise<boolean> {
  const callbackQuery = ctx.callbackQuery;
  if (!callbackQuery?.data || !callbackQuery.data.startsWith(WORKTREE_CALLBACK_PREFIX)) {
    return false;
  }

  if (isForegroundBusy()) {
    await replyBusyBlocked(ctx);
    return true;
  }

  const page = parseWorktreePageCallback(callbackQuery.data);
  const index = parseWorktreeIndexCallback(callbackQuery.data);

  const isActiveMenu = await ensureActiveInlineMenu(ctx, "worktree");
  if (!isActiveMenu) {
    return true;
  }

  try {
    const { currentProject, context } = await loadCurrentWorktreeContext();

    if (!currentProject) {
      clearAllInteractionState("worktree_project_missing");
      await ctx.answerCallbackQuery();
      await ctx.reply(t("worktree.project_not_selected"));
      return true;
    }

    if (!context) {
      clearAllInteractionState("worktree_git_context_missing");
      await ctx.answerCallbackQuery({ text: t("worktree.not_git_repo_callback") });
      return true;
    }

    if (page !== null) {
      if (context.worktrees.length === 0) {
        await ctx.answerCallbackQuery({ text: t("worktree.page_empty_callback") });
        return true;
      }

      const { text, keyboard } = buildWorktreeMenuView(context.worktrees, page);
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(text, {
        reply_markup: appendInlineMenuCancelButton(keyboard, "worktree"),
      });
      return true;
    }

    if (index === null) {
      await ctx.answerCallbackQuery({ text: t("callback.processing_error") });
      return true;
    }

    const selectedWorktree = context.worktrees[index];
    if (!selectedWorktree) {
      await ctx.answerCallbackQuery({ text: t("worktree.selection_missing_callback") });
      return true;
    }

    if (selectedWorktree.isCurrent) {
      await ctx.answerCallbackQuery({ text: t("worktree.already_selected_callback") });
      return true;
    }

    logger.info(`[Bot] Worktree selected: ${selectedWorktree.path}`);

    await upsertSessionDirectory(selectedWorktree.path, Date.now());
    const projectInfo = await getProjectByWorktree(selectedWorktree.path);
    const selectedProjectInfo = { ...projectInfo, name: selectedWorktree.path };
    const replyKeyboard = await switchToProject(ctx, selectedProjectInfo, "worktree_switched", {
      ensureEventSubscription: deps.ensureEventSubscription,
      presentation: createProjectSwitchPresentation(),
    });

    await ctx.answerCallbackQuery();
    await ctx.reply(t("worktree.selected", { worktree: selectedWorktree.path }), {
      reply_markup: replyKeyboard,
    });
    await ctx.deleteMessage();
    return true;
  } catch (error) {
    logger.error("[Bot] Error handling worktree callback:", error);
    clearAllInteractionState("worktree_select_error");
    await ctx.answerCallbackQuery({ text: t("callback.processing_error") });
    await ctx.reply(t("worktree.select_error"));
    return true;
  }
}
