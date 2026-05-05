import { CommandContext, Context, InlineKeyboard } from "grammy";
import { config } from "../../config.js";
import { getGitWorktreeContext, type GitWorktreeEntry } from "../../git/worktree.js";
import { clearAllInteractionState } from "../../interaction/cleanup.js";
import { getProjectByWorktree } from "../../project/manager.js";
import { upsertSessionDirectory } from "../../session/cache-manager.js";
import { getCurrentProject } from "../../settings/manager.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import {
  appendInlineMenuCancelButton,
  ensureActiveInlineMenu,
  replyWithInlineMenu,
} from "../handlers/inline-menu.js";
import { switchToProject } from "../utils/switch-project.js";
import { isForegroundBusy, replyBusyBlocked } from "../utils/busy-guard.js";
import { buildProjectButtonLabel, calculateProjectsPaginationRange } from "./projects.js";

const MAX_INLINE_BUTTON_LABEL_LENGTH = 64;
const WORKTREE_CALLBACK_PREFIX = "worktree:";
const WORKTREE_PAGE_CALLBACK_PREFIX = "worktree:page:";

interface WorktreeCallbackDeps {
  ensureEventSubscription?: (directory: string) => Promise<void>;
}

function formatWorktreeButtonLabel(label: string, isActive: boolean): string {
  const prefix = isActive ? "✅ " : "";
  const availableLength = MAX_INLINE_BUTTON_LABEL_LENGTH - prefix.length;

  if (label.length <= availableLength) {
    return `${prefix}${label}`;
  }

  return `${prefix}${label.slice(0, Math.max(0, availableLength - 3))}...`;
}

function buildWorktreeButtonLabel(index: number, entry: GitWorktreeEntry): string {
  return buildProjectButtonLabel(index, entry.path);
}

function parseWorktreePageCallback(data: string): number | null {
  if (!data.startsWith(WORKTREE_PAGE_CALLBACK_PREFIX)) {
    return null;
  }

  const rawPage = data.slice(WORKTREE_PAGE_CALLBACK_PREFIX.length);
  if (!/^\d+$/.test(rawPage)) {
    return null;
  }

  return Number.parseInt(rawPage, 10);
}

function parseWorktreeIndexCallback(data: string): number | null {
  if (
    !data.startsWith(WORKTREE_CALLBACK_PREFIX) ||
    data.startsWith(WORKTREE_PAGE_CALLBACK_PREFIX)
  ) {
    return null;
  }

  const rawIndex = data.slice(WORKTREE_CALLBACK_PREFIX.length);
  if (!/^\d+$/.test(rawIndex)) {
    return null;
  }

  return Number.parseInt(rawIndex, 10);
}

function buildWorktreeMenuText(page: number, totalPages: number): string {
  const baseText = t("worktree.select_with_current");

  if (totalPages <= 1) {
    return baseText;
  }

  return `${baseText}\n\n${t("projects.page_indicator", {
    current: String(page + 1),
    total: String(totalPages),
  })}`;
}

function buildWorktreeKeyboard(worktrees: GitWorktreeEntry[], page: number): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const pageSize = config.bot.projectsListLimit;
  const {
    page: normalizedPage,
    totalPages,
    startIndex,
    endIndex,
  } = calculateProjectsPaginationRange(worktrees.length, page, pageSize);

  worktrees.slice(startIndex, endIndex).forEach((entry, index) => {
    const label = buildWorktreeButtonLabel(startIndex + index, entry);
    keyboard
      .text(
        formatWorktreeButtonLabel(label, entry.isCurrent),
        `${WORKTREE_CALLBACK_PREFIX}${startIndex + index}`,
      )
      .row();
  });

  if (totalPages > 1) {
    if (normalizedPage > 0) {
      keyboard.text(
        t("projects.prev_page"),
        `${WORKTREE_PAGE_CALLBACK_PREFIX}${normalizedPage - 1}`,
      );
    }

    if (normalizedPage < totalPages - 1) {
      keyboard.text(
        t("projects.next_page"),
        `${WORKTREE_PAGE_CALLBACK_PREFIX}${normalizedPage + 1}`,
      );
    }
  }

  return keyboard;
}

function buildWorktreeMenuView(
  worktrees: GitWorktreeEntry[],
  page: number,
): { text: string; keyboard: InlineKeyboard } {
  const { page: normalizedPage, totalPages } = calculateProjectsPaginationRange(
    worktrees.length,
    page,
    config.bot.projectsListLimit,
  );

  return {
    text: buildWorktreeMenuText(normalizedPage, totalPages),
    keyboard: buildWorktreeKeyboard(worktrees, normalizedPage),
  };
}

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
    const replyKeyboard = deps.ensureEventSubscription
      ? await switchToProject(ctx, selectedProjectInfo, "worktree_switched", {
          ensureEventSubscription: deps.ensureEventSubscription,
        })
      : await switchToProject(ctx, selectedProjectInfo, "worktree_switched");

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
