import { CommandContext, Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { getCurrentProject } from "../../settings/manager.js";
import { getProjects } from "../../project/manager.js";
import { syncSessionDirectoryCache } from "../../session/cache-manager.js";

import {
  appendInlineMenuCancelButton,
  ensureActiveInlineMenu,
  replyWithInlineMenu,
} from "../handlers/inline-menu.js";
import { switchToProject } from "../utils/switch-project.js";
import { clearAllInteractionState } from "../../interaction/cleanup.js";
import { isForegroundBusy, replyBusyBlocked } from "../utils/busy-guard.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { config } from "../../config.js";
import { ProjectInfo } from "../../settings/manager.js";

const MAX_INLINE_BUTTON_LABEL_LENGTH = 64;
const PROJECT_PAGE_CALLBACK_PREFIX = "projects:page:";

interface ProjectsPaginationRange {
  page: number;
  totalPages: number;
  startIndex: number;
  endIndex: number;
}

function formatProjectButtonLabel(label: string, isActive: boolean): string {
  const prefix = isActive ? "✅ " : "";
  const availableLength = MAX_INLINE_BUTTON_LABEL_LENGTH - prefix.length;

  if (label.length <= availableLength) {
    return `${prefix}${label}`;
  }

  return `${prefix}${label.slice(0, Math.max(0, availableLength - 3))}...`;
}

export function getProjectFolderName(worktree: string): string {
  const normalized = worktree.replace(/[\\/]+$/g, "");

  if (!normalized) {
    return worktree;
  }

  const segments = normalized.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? normalized;
}

export function buildProjectButtonLabel(index: number, worktree: string): string {
  const folderName = getProjectFolderName(worktree);
  return `${index + 1}. ${folderName} [${worktree}]`;
}

export function parseProjectPageCallback(data: string): number | null {
  if (!data.startsWith(PROJECT_PAGE_CALLBACK_PREFIX)) {
    return null;
  }

  const rawPage = data.slice(PROJECT_PAGE_CALLBACK_PREFIX.length);
  if (!/^\d+$/.test(rawPage)) {
    return null;
  }

  return Number.parseInt(rawPage, 10);
}

export function calculateProjectsPaginationRange(
  totalProjects: number,
  page: number,
  pageSize: number,
): ProjectsPaginationRange {
  const safePageSize = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(totalProjects / safePageSize));
  const normalizedPage = Math.min(Math.max(0, page), totalPages - 1);
  const startIndex = normalizedPage * safePageSize;
  const endIndex = Math.min(startIndex + safePageSize, totalProjects);

  return {
    page: normalizedPage,
    totalPages,
    startIndex,
    endIndex,
  };
}

function buildProjectsMenuText(
  currentProjectName: string | null,
  page: number,
  totalPages: number,
): string {
  const baseText = currentProjectName
    ? t("projects.select_with_current", {
        project: currentProjectName,
      })
    : t("projects.select");

  if (totalPages <= 1) {
    return baseText;
  }

  return `${baseText}\n\n${t("projects.page_indicator", {
    current: String(page + 1),
    total: String(totalPages),
  })}`;
}

function buildProjectsKeyboard(projects: ProjectInfo[], page: number): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const currentProject = getCurrentProject();
  const pageSize = config.bot.projectsListLimit;
  const {
    page: normalizedPage,
    totalPages,
    startIndex,
    endIndex,
  } = calculateProjectsPaginationRange(projects.length, page, pageSize);

  projects.slice(startIndex, endIndex).forEach((project, index) => {
    const isActive =
      currentProject &&
      (project.id === currentProject.id || project.worktree === currentProject.worktree);
    const label = buildProjectButtonLabel(startIndex + index, project.worktree);
    const labelWithCheck = formatProjectButtonLabel(label, Boolean(isActive));
    keyboard.text(labelWithCheck, `project:${project.id}`).row();
  });

  if (totalPages > 1) {
    if (normalizedPage > 0) {
      keyboard.text(
        t("projects.prev_page"),
        `${PROJECT_PAGE_CALLBACK_PREFIX}${normalizedPage - 1}`,
      );
    }

    if (normalizedPage < totalPages - 1) {
      keyboard.text(
        t("projects.next_page"),
        `${PROJECT_PAGE_CALLBACK_PREFIX}${normalizedPage + 1}`,
      );
    }
  }

  return keyboard;
}

function buildProjectsMenuView(
  projects: ProjectInfo[],
  page: number,
): { text: string; keyboard: InlineKeyboard } {
  const currentProject = getCurrentProject();
  const pageSize = config.bot.projectsListLimit;
  const { page: normalizedPage, totalPages } = calculateProjectsPaginationRange(
    projects.length,
    page,
    pageSize,
  );
  const currentProjectName = currentProject?.name || currentProject?.worktree || null;

  return {
    text: buildProjectsMenuText(currentProjectName, normalizedPage, totalPages),
    keyboard: buildProjectsKeyboard(projects, normalizedPage),
  };
}

export async function projectsCommand(ctx: CommandContext<Context>) {
  try {
    if (isForegroundBusy()) {
      await replyBusyBlocked(ctx);
      return;
    }

    await syncSessionDirectoryCache();
    const projects = await getProjects();

    if (projects.length === 0) {
      await ctx.reply(t("projects.empty"));
      return;
    }

    const { text, keyboard } = buildProjectsMenuView(projects, 0);

    await replyWithInlineMenu(ctx, {
      menuKind: "project",
      text,
      keyboard,
    });
  } catch (error) {
    logger.error("[Bot] Error fetching projects:", error);
    await ctx.reply(t("projects.fetch_error"));
  }
}

export async function handleProjectSelect(ctx: Context): Promise<boolean> {
  const callbackQuery = ctx.callbackQuery;
  if (!callbackQuery?.data) {
    return false;
  }

  if (isForegroundBusy()) {
    await replyBusyBlocked(ctx);
    return true;
  }

  const page = parseProjectPageCallback(callbackQuery.data);
  if (page !== null) {
    const isActiveMenu = await ensureActiveInlineMenu(ctx, "project");
    if (!isActiveMenu) {
      return true;
    }

    try {
      const projects = await getProjects();
      if (projects.length === 0) {
        await ctx.answerCallbackQuery();
        await ctx.reply(t("projects.empty"));
        return true;
      }

      const { text, keyboard } = buildProjectsMenuView(projects, page);
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(text, {
        reply_markup: appendInlineMenuCancelButton(keyboard, "project"),
      });
    } catch (error) {
      logger.error("[Bot] Error switching projects page:", error);
      await ctx.answerCallbackQuery({ text: t("projects.page_load_error") });
    }

    return true;
  }

  if (!callbackQuery.data.startsWith("project:")) {
    return false;
  }

  const projectId = callbackQuery.data.replace("project:", "");

  const isActiveMenu = await ensureActiveInlineMenu(ctx, "project");
  if (!isActiveMenu) {
    return true;
  }

  try {
    const projects = await getProjects();
    const selectedProject = projects.find((p) => p.id === projectId);

    if (!selectedProject) {
      throw new Error(`Project with id ${projectId} not found`);
    }

    const projectName = selectedProject.name || selectedProject.worktree;

    logger.info(`[Bot] Project selected: ${projectName} (id: ${projectId})`);

    const keyboard = await switchToProject(ctx, selectedProject, "project_switched");

    await ctx.answerCallbackQuery();
    await ctx.reply(t("projects.selected", { project: projectName }), {
      reply_markup: keyboard,
    });

    await ctx.deleteMessage();
  } catch (error) {
    clearAllInteractionState("project_select_error");
    logger.error("[Bot] Error selecting project:", error);
    await ctx.answerCallbackQuery();
    await ctx.reply(t("projects.select_error"));
  }

  return true;
}
