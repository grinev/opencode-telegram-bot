import { InlineKeyboard } from "grammy";
import { config } from "../../config.js";
import { t } from "../../i18n/index.js";
import type { GitWorktreeEntry } from "../../app/types/worktree.js";
import {
  buildProjectButtonLabel,
  calculateProjectsPaginationRange,
} from "./project-selection-menu.js";

const MAX_INLINE_BUTTON_LABEL_LENGTH = 64;
export const WORKTREE_CALLBACK_PREFIX = "worktree:";
const WORKTREE_PAGE_CALLBACK_PREFIX = "worktree:page:";

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

export function parseWorktreePageCallback(data: string): number | null {
  if (!data.startsWith(WORKTREE_PAGE_CALLBACK_PREFIX)) {
    return null;
  }

  const rawPage = data.slice(WORKTREE_PAGE_CALLBACK_PREFIX.length);
  if (!/^\d+$/.test(rawPage)) {
    return null;
  }

  return Number.parseInt(rawPage, 10);
}

export function parseWorktreeIndexCallback(data: string): number | null {
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

export function buildWorktreeMenuView(
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
