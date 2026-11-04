import type { Context } from "grammy";
import type { AppContainer } from "../../app/bootstrap/app-container.js";
import { getListedProjects, getProjects } from "../../app/services/project-service.js";
import {
  isForegroundBusy,
  type ForegroundBusyDeps,
} from "../../app/services/run-control-service.js";
import {
  switchToProject,
  type ProjectSwitchDeps,
} from "../../app/services/project-switch-service.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { alert, cancelMenu, failure } from "./feedback.js";
import {
  appendInlineMenuCancelButton,
  ensureActiveInlineMenu,
  type InlineMenuDeps,
} from "../menus/inline-menu.js";
import {
  buildProjectsMenuView,
  parseProjectPageCallback,
  buildProjectSearchView,
  filterProjectsForSearch,
  PROJECT_SEARCH_CALLBACK,
  PROJECT_SEARCH_PAGE_PREFIX,
  PROJECT_SEARCH_RESULT_PREFIX,
  PROJECT_SEARCH_AGAIN,
  PROJECT_SEARCH_CANCEL,
} from "../menus/project-selection-menu.js";
import { replyBusyBlocked } from "../messages/busy-blocked-renderer.js";
import {
  createProjectSwitchPresentation,
  type ProjectSwitchPresentationDeps,
} from "../services/project-switch-presentation.js";

export type ProjectSelectDeps = Pick<AppContainer, "ensureEventSubscription"> &
  ForegroundBusyDeps &
  InlineMenuDeps &
  ProjectSwitchDeps &
  ProjectSwitchPresentationDeps;

export async function handleProjectSelect(ctx: Context, deps: ProjectSelectDeps): Promise<boolean> {
  const callbackQuery = ctx.callbackQuery;
  if (!callbackQuery?.data) {
    return false;
  }

  const page = parseProjectPageCallback(callbackQuery.data);
  const isProjectSelection = callbackQuery.data.startsWith("project:");

  if (page === null && !isProjectSelection) {
    return false;
  }

  if (isForegroundBusy(deps)) {
    await replyBusyBlocked(ctx);
    return true;
  }

  if (page !== null) {
    const isActiveMenu = await ensureActiveInlineMenu(ctx, "project", deps);
    if (!isActiveMenu) {
      return true;
    }

    try {
      const projects = await getListedProjects();
      if (projects.length === 0) {
        await alert(ctx, "projects.empty");
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

  const isActiveMenu = await ensureActiveInlineMenu(ctx, "project", deps);
  if (!isActiveMenu) {
    return true;
  }

  return selectProject(ctx, deps, projectId);
}

async function selectProject(
  ctx: Context,
  deps: ProjectSelectDeps,
  projectId: string,
  search?: Record<string, unknown>,
): Promise<boolean> {
  try {
    const projects = await getProjects();
    if (search && !isSameSearch(deps, search)) {
      await ctx.answerCallbackQuery().catch(() => {});
      return true;
    }
    const selectedProject = projects.find((p) => p.id === projectId);

    if (!selectedProject) {
      throw new Error(`Project with id ${projectId} not found`);
    }

    const projectName = selectedProject.name || selectedProject.worktree;

    logger.info(`[Bot] Project selected: ${projectName} (id: ${projectId})`);

    const keyboard = await switchToProject(ctx, selectedProject, "project_switched", {
      ...deps,
      presentation: createProjectSwitchPresentation(deps),
    });

    await ctx.answerCallbackQuery();
    await ctx.reply(t("projects.selected", { project: projectName }), {
      reply_markup: keyboard,
    });

    await ctx.deleteMessage();
  } catch (error) {
    if (search && !isSameSearch(deps, search)) {
      await ctx.answerCallbackQuery().catch(() => {});
      return true;
    }
    deps.resetInteractions("project_select_error");
    logger.error("[Bot] Error selecting project:", error);
    await failure(ctx, "projects.select_error");
  }

  return true;
}

function searchState(deps: ProjectSelectDeps) {
  const state = deps.interactionManager.getSnapshot();
  return state?.kind === "custom" && state.metadata.flow === "project-search"
    ? state.metadata
    : null;
}

function startSearch(deps: ProjectSelectDeps): void {
  deps.interactionManager.start({
    kind: "custom",
    expectedInput: "text",
    allowedCommands: [],
    metadata: { flow: "project-search", stage: "input", token: Symbol("project-search") },
  });
}

function isSameSearch(deps: ProjectSelectDeps, state: Record<string, unknown>): boolean {
  const active = searchState(deps);
  return !!active && active.stage === state.stage && active.token === state.token;
}

export async function handleProjectSearchTextInput(
  ctx: Context,
  deps: ProjectSelectDeps,
): Promise<boolean> {
  const state = searchState(deps);
  if (!state || state.stage !== "input" || ctx.message?.text === undefined) return false;
  const query = ctx.message.text;
  if (!query.trim()) return true;
  try {
    const projects = await filterProjectsForSearch(await getListedProjects(), query);
    const view = await buildProjectSearchView(projects, query, 0);
    if (!isSameSearch(deps, state)) return true;
    const sent = await ctx.reply(view.text, { reply_markup: view.keyboard });
    if (!isSameSearch(deps, state)) return true;
    deps.interactionManager.transition({
      expectedInput: "callback",
      metadata: {
        ...state,
        stage: "results",
        query,
        messageId: sent.message_id,
        ids: projects.map((p) => p.id),
      },
    });
  } catch (error) {
    logger.error("[Projects] Error searching projects:", error);
    if (isSameSearch(deps, state)) {
      deps.interactionManager.clear("project_search_error");
      await ctx.reply(t("projects.fetch_error"));
    }
  }
  return true;
}

export async function handleProjectSearchCallback(
  ctx: Context,
  deps: ProjectSelectDeps,
): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || (data !== PROJECT_SEARCH_CALLBACK && !data.startsWith("projects:search:")))
    return false;
  if (isForegroundBusy(deps)) {
    await replyBusyBlocked(ctx);
    return true;
  }
  if (data === PROJECT_SEARCH_CALLBACK) {
    if (!(await ensureActiveInlineMenu(ctx, "project", deps))) return true;
    const initial = deps.interactionManager.getSnapshot();
    await ctx.answerCallbackQuery().catch(() => {});
    await ctx.deleteMessage().catch(() => {});
    const current = deps.interactionManager.getSnapshot();
    if (current?.kind !== "inline" || current.metadata.messageId !== initial?.metadata.messageId)
      return true;
    startSearch(deps);
    await ctx.reply(t("projects.search.prompt"));
    return true;
  }
  const state = searchState(deps);
  if (
    !state ||
    state.stage !== "results" ||
    state.messageId !== ctx.callbackQuery?.message?.message_id
  ) {
    await ctx
      .answerCallbackQuery({ text: t("inline.inactive_callback"), show_alert: true })
      .catch(() => {});
    return true;
  }
  if (data === PROJECT_SEARCH_CANCEL) {
    deps.interactionManager.clear("project_search_cancelled");
    await cancelMenu(ctx);
    return true;
  }
  if (data === PROJECT_SEARCH_AGAIN) {
    await ctx.answerCallbackQuery().catch(() => {});
    await ctx.deleteMessage().catch(() => {});
    if (!isSameSearch(deps, state)) return true;
    startSearch(deps);
    await ctx.reply(t("projects.search.prompt"));
    return true;
  }
  if (data.startsWith(PROJECT_SEARCH_PAGE_PREFIX)) {
    const raw = data.slice(PROJECT_SEARCH_PAGE_PREFIX.length);
    if (!/^\d+$/.test(raw) || typeof state.query !== "string") return true;
    try {
      const projects = await filterProjectsForSearch(await getListedProjects(), state.query);
      const view = await buildProjectSearchView(projects, state.query, Number(raw));
      if (!isSameSearch(deps, state)) {
        await ctx.answerCallbackQuery().catch(() => {});
        return true;
      }
      await ctx.editMessageText(view.text, { reply_markup: view.keyboard });
      if (!isSameSearch(deps, state)) {
        await ctx.answerCallbackQuery().catch(() => {});
        return true;
      }
      deps.interactionManager.transition({
        expectedInput: "callback",
        metadata: { ...state, ids: projects.map((p) => p.id) },
      });
      await ctx.answerCallbackQuery();
    } catch (error) {
      logger.error("[Projects] Error switching search page:", error);
      await ctx.answerCallbackQuery({ text: t("projects.page_load_error") });
    }
    return true;
  }
  if (data.startsWith(PROJECT_SEARCH_RESULT_PREFIX)) {
    const raw = data.slice(PROJECT_SEARCH_RESULT_PREFIX.length);
    const id = /^\d+$/.test(raw) && Array.isArray(state.ids) ? state.ids[Number(raw)] : undefined;
    if (typeof id !== "string") {
      await failure(ctx, "projects.select_error");
      return true;
    }
    return selectProject(ctx, deps, id, state);
  }
  return true;
}
