import type { Context } from "grammy";
import { clearAllInteractionState } from "../../app/managers/interaction-manager.js";
import { getProjects } from "../../app/services/project-service.js";
import { isForegroundBusy } from "../../app/services/run-control-service.js";
import { switchToProject } from "../../app/services/project-switch-service.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { appendInlineMenuCancelButton, ensureActiveInlineMenu } from "../menus/inline-menu.js";
import { buildProjectsMenuView, parseProjectPageCallback } from "../menus/project-selection-menu.js";
import { replyBusyBlocked } from "../messages/busy-blocked-renderer.js";
import { createProjectSwitchPresentation } from "../services/project-switch-presentation.js";

interface ProjectSelectDeps {
  ensureEventSubscription?: (directory: string) => Promise<void>;
}

export async function handleProjectSelect(
  ctx: Context,
  deps: ProjectSelectDeps = {},
): Promise<boolean> {
  const callbackQuery = ctx.callbackQuery;
  if (!callbackQuery?.data) {
    return false;
  }

  const page = parseProjectPageCallback(callbackQuery.data);
  const isProjectSelection = callbackQuery.data.startsWith("project:");

  if (page === null && !isProjectSelection) {
    return false;
  }

  if (isForegroundBusy()) {
    await replyBusyBlocked(ctx);
    return true;
  }

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

      const { text, keyboard } = await buildProjectsMenuView(projects, page);
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

    const keyboard = await switchToProject(ctx, selectedProject, "project_switched", {
      ensureEventSubscription: deps.ensureEventSubscription,
      presentation: createProjectSwitchPresentation(),
    });

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
