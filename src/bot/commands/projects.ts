import { CommandContext, Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { setCurrentProject, getCurrentProject } from "../../settings/manager.js";
import { getProjects } from "../../project/manager.js";
import { syncSessionDirectoryCache } from "../../session/cache-manager.js";
import { clearSession } from "../../session/manager.js";
import { summaryAggregator } from "../../summary/aggregator.js";
import { pinnedMessageManager } from "../../pinned/manager.js";
import { keyboardManager } from "../../keyboard/manager.js";
import { getStoredAgent } from "../../agent/manager.js";
import { getStoredModel } from "../../model/manager.js";
import { formatVariantForButton } from "../../variant/manager.js";
import { clearAllInteractionState } from "../../interaction/cleanup.js";
import { createMainKeyboard } from "../utils/keyboard.js";
import { ensureActiveInlineMenu, replyWithInlineMenu } from "../handlers/inline-menu.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";

const MAX_INLINE_BUTTON_LABEL_LENGTH = 64;
const MAX_PROJECTS_TO_SHOW = 10;

function formatProjectButtonLabel(label: string, isActive: boolean): string {
  const prefix = isActive ? "✅ " : "";
  const availableLength = MAX_INLINE_BUTTON_LABEL_LENGTH - prefix.length;

  if (label.length <= availableLength) {
    return `${prefix}${label}`;
  }

  return `${prefix}${label.slice(0, Math.max(0, availableLength - 3))}...`;
}

export async function projectsCommand(ctx: CommandContext<Context>) {
  try {
    await syncSessionDirectoryCache();
    const projects = await getProjects();
    const projectsToShow = projects.slice(0, MAX_PROJECTS_TO_SHOW);

    if (projectsToShow.length === 0) {
      await ctx.reply(t("projects.empty"));
      return;
    }

    const keyboard = new InlineKeyboard();
    const currentProject = getCurrentProject();

    projectsToShow.forEach((project, index) => {
      const isActive =
        currentProject &&
        (project.id === currentProject.id || project.worktree === currentProject.worktree);
      const label = project.name
        ? `${index + 1}. ${project.name}`
        : `${index + 1}. ${project.worktree}`;
      const labelWithCheck = formatProjectButtonLabel(label, Boolean(isActive));
      keyboard.text(labelWithCheck, `project:${project.id}`).row();
    });

    const text = currentProject
      ? t("projects.select_with_current", {
          project: currentProject.name || currentProject.worktree,
        })
      : t("projects.select");

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
  if (!callbackQuery?.data || !callbackQuery.data.startsWith("project:")) {
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

    logger.info(
      `[Bot] Project selected: ${selectedProject.name || selectedProject.worktree} (id: ${projectId})`,
    );

    setCurrentProject(selectedProject);
    clearSession();
    summaryAggregator.clear();
    clearAllInteractionState("project_switched");

    // Clear pinned message when switching projects
    try {
      await pinnedMessageManager.clear();
    } catch (err) {
      logger.error("[Bot] Error clearing pinned message:", err);
    }

    // Initialize keyboard manager if not already
    if (ctx.chat) {
      keyboardManager.initialize(ctx.api, ctx.chat.id);
    }

    // Refresh context limit for current model
    await pinnedMessageManager.refreshContextLimit();
    const contextLimit = pinnedMessageManager.getContextLimit();

    // Reset context to 0 (no session selected) with current model's limit
    keyboardManager.updateContext(0, contextLimit);

    // Get current state for keyboard (with context = 0)
    const currentAgent = getStoredAgent();
    const currentModel = getStoredModel();
    const contextInfo = { tokensUsed: 0, tokensLimit: contextLimit };
    const variantName = formatVariantForButton(currentModel.variant || "default");
    const keyboard = createMainKeyboard(currentAgent, currentModel, contextInfo, variantName);

    const projectName = selectedProject.name || selectedProject.worktree;

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
