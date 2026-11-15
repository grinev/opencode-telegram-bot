import type { Context } from "grammy";
import type { AppContainer } from "../../app/bootstrap/app-container.js";
import { config } from "../../config.js";
import { loadSkillsCatalog, type SkillCatalogItem } from "../../app/services/skills-catalog-service.js";
import { isForegroundBusy } from "../../app/services/run-control-service.js";
import { DEFAULT_ALLOWED_INTERACTION_COMMANDS } from "../../app/managers/interaction-manager.js";
import { replyBusyBlocked } from "../messages/busy-blocked-renderer.js";
import { getCurrentProject } from "../../app/stores/settings-store.js";
import type { InteractionState } from "../../app/types/interaction.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { cancelMenu } from "./feedback.js";
import { processUserPrompt, type ProcessPromptDeps } from "../handlers/prompt.js";
import { createIncomingPrompt } from "../../app/types/prompt.js";
import {
  buildSkillsConfirmKeyboard,
  buildSkillsListKeyboard,
  buildSkillsSearchView,
  calculateSkillsPaginationRange,
  formatExecutingSkillMessage,
  formatSkillsSelectText,
  filterSkillsForSearch,
  parseSkillPageCallback,
  parseSkillSelectCallback,
  SKILLS_CALLBACK_CANCEL,
  SKILLS_CALLBACK_EXECUTE,
  SKILLS_CALLBACK_PREFIX,
  SKILLS_CALLBACK_SEARCH,
  SKILLS_SEARCH_QUERY_MAX_LENGTH,
} from "../menus/skills-catalog-menu.js";

interface SkillsListMetadata {
  flow: "skills";
  stage: "list";
  messageId: number;
  projectDirectory: string;
  skills: SkillCatalogItem[];
  page: number;
}

interface SkillsConfirmMetadata {
  flow: "skills";
  stage: "confirm";
  messageId: number;
  projectDirectory: string;
  skillName: string;
}

export type SkillsMetadata = SkillsListMetadata | SkillsConfirmMetadata;

export interface ExecuteSkillParams {
  projectDirectory: string;
  skillName: string;
  argumentsText: string;
}

function getCallbackMessageId(ctx: Context): number | null {
  const message = ctx.callbackQuery?.message;
  if (!message || !("message_id" in message)) {
    return null;
  }

  const messageId = (message as { message_id?: number }).message_id;
  return typeof messageId === "number" ? messageId : null;
}

function parseSkillItems(value: unknown): SkillCatalogItem[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const skills: SkillCatalogItem[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      return null;
    }

    const skillName = (item as { name?: unknown }).name;
    if (typeof skillName !== "string" || !skillName.trim()) {
      return null;
    }

    const description = (item as { description?: unknown }).description;
    skills.push({
      name: skillName,
      description: typeof description === "string" ? description : undefined,
    });
  }

  return skills;
}

export function parseSkillsMetadata(state: InteractionState | null): SkillsMetadata | null {
  if (!state || state.kind !== "custom") {
    return null;
  }

  const flow = state.metadata.flow;
  const stage = state.metadata.stage;
  const messageId = state.metadata.messageId;
  const projectDirectory = state.metadata.projectDirectory;

  if (flow !== "skills" || typeof messageId !== "number" || typeof projectDirectory !== "string") {
    return null;
  }

  if (stage === "list") {
    const skills = parseSkillItems(state.metadata.skills);
    if (!skills) {
      return null;
    }

    const page =
      typeof state.metadata.page === "number" && Number.isInteger(state.metadata.page)
        ? Math.max(0, state.metadata.page)
        : 0;

    return {
      flow,
      stage,
      messageId,
      projectDirectory,
      skills,
      page,
    };
  }

  if (stage === "confirm") {
    const skillName = state.metadata.skillName;
    if (typeof skillName !== "string" || !skillName.trim()) {
      return null;
    }

    return {
      flow,
      stage,
      messageId,
      projectDirectory,
      skillName,
    };
  }

  return null;
}

export type SkillsCallbackDeps = ProcessPromptDeps & Pick<AppContainer, "interactionManager">;

export function clearSkillsInteraction(
  deps: Pick<AppContainer, "interactionManager">,
  reason: string,
): void {
  const metadata = parseSkillsMetadata(deps.interactionManager.getSnapshot());
  if (metadata) {
    deps.interactionManager.clear(reason);
  }
}

export async function executeSkill(
  ctx: Context,
  deps: ProcessPromptDeps,
  params: ExecuteSkillParams,
): Promise<void> {
  const currentProject = getCurrentProject();
  if (!currentProject) {
    await ctx.reply(t("bot.project_not_selected"));
    return;
  }

  if (currentProject.worktree !== params.projectDirectory) {
    logger.warn(
      `[Skills] Project changed between selection and execution. listedProject=${params.projectDirectory}, currentProject=${currentProject.worktree}. Using current project.`,
    );
  }

  const args = params.argumentsText.trim();
  const executingMessage = formatExecutingSkillMessage(params.skillName, args);
  await ctx.reply(executingMessage.text, { entities: executingMessage.entities });

  const promptText = args ? `/${params.skillName} ${args}` : `/${params.skillName}`;
  // Running a skill stays as it was in a project folder that no longer exists.
  await processUserPrompt(ctx, createIncomingPrompt(promptText), deps, {
    skipProjectFolderCheck: true,
  });
}

export async function handleSkillsCallback(
  ctx: Context,
  deps: SkillsCallbackDeps,
): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith(SKILLS_CALLBACK_PREFIX)) {
    return false;
  }

  if (data === SKILLS_CALLBACK_SEARCH || data.startsWith(`${SKILLS_CALLBACK_SEARCH}:`)) {
    return handleSkillsSearchCallback(ctx, deps);
  }

  const metadata = parseSkillsMetadata(deps.interactionManager.getSnapshot());
  const callbackMessageId = getCallbackMessageId(ctx);

  if (!metadata || callbackMessageId === null || metadata.messageId !== callbackMessageId) {
    await ctx.answerCallbackQuery({ text: t("skills.inactive_callback"), show_alert: true });
    return true;
  }

  try {
    if (data === SKILLS_CALLBACK_CANCEL) {
      clearSkillsInteraction(deps, "skills_cancelled");
      await cancelMenu(ctx);
      return true;
    }

    if (data === SKILLS_CALLBACK_EXECUTE) {
      if (metadata.stage !== "confirm") {
        await ctx.answerCallbackQuery({ text: t("skills.inactive_callback"), show_alert: true });
        return true;
      }

      clearSkillsInteraction(deps, "skills_execute_clicked");
      await ctx.answerCallbackQuery({ text: t("skills.execute_callback") });
      await ctx.deleteMessage().catch(() => {});

      await executeSkill(ctx, deps, {
        projectDirectory: metadata.projectDirectory,
        skillName: metadata.skillName,
        argumentsText: "",
      });
      return true;
    }

    const page = parseSkillPageCallback(data);
    if (page !== null) {
      if (metadata.stage !== "list") {
        await ctx.answerCallbackQuery({ text: t("callback.processing_error") });
        return true;
      }

      const pageSize = config.bot.commandsListLimit;
      const { page: normalizedPage, totalPages } = calculateSkillsPaginationRange(
        metadata.skills.length,
        page,
        pageSize,
      );

      if (page >= totalPages || page < 0) {
        await ctx.answerCallbackQuery({ text: t("skills.page_empty_callback") });
        return true;
      }

      const keyboard = buildSkillsListKeyboard(metadata.skills, normalizedPage, pageSize);
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(formatSkillsSelectText(normalizedPage), {
        reply_markup: keyboard,
      });

      deps.interactionManager.transition({
        expectedInput: "callback",
        metadata: {
          flow: "skills",
          stage: "list",
          messageId: metadata.messageId,
          projectDirectory: metadata.projectDirectory,
          skills: metadata.skills,
          page: normalizedPage,
        },
      });

      return true;
    }

    const skillIndex = parseSkillSelectCallback(data);
    if (skillIndex === null || metadata.stage !== "list") {
      await ctx.answerCallbackQuery({ text: t("callback.processing_error") });
      return true;
    }

    const selectedSkill = metadata.skills[skillIndex];
    if (!selectedSkill) {
      await ctx.answerCallbackQuery({ text: t("skills.inactive_callback"), show_alert: true });
      return true;
    }

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(t("skills.confirm", { skill: `/${selectedSkill.name}` }), {
      reply_markup: buildSkillsConfirmKeyboard(),
    });

    deps.interactionManager.transition({
      expectedInput: "mixed",
      metadata: {
        flow: "skills",
        stage: "confirm",
        messageId: metadata.messageId,
        projectDirectory: metadata.projectDirectory,
        skillName: selectedSkill.name,
      },
    });

    return true;
  } catch (error) {
    logger.error("[Skills] Error handling skill callback:", error);
    clearSkillsInteraction(deps, "skills_callback_error");
    await ctx.answerCallbackQuery({ text: t("callback.processing_error") }).catch(() => {});
    return true;
  }
}

type SkillsSearchDeps = Pick<
  AppContainer,
  "interactionManager" | "foregroundSessionState" | "attachManager"
>;

function skillsSearchState(deps: SkillsSearchDeps): Record<string, unknown> | null {
  const state = deps.interactionManager.getSnapshot();
  return state?.kind === "custom" && state.metadata.flow === "skills-search"
    ? state.metadata
    : null;
}

function sameSkillsSearch(deps: SkillsSearchDeps, state: Record<string, unknown>): boolean {
  const current = skillsSearchState(deps);
  return !!current && current.token === state.token && current.stage === state.stage;
}

function startSkillsSearch(deps: SkillsSearchDeps): void {
  deps.interactionManager.start({
    kind: "custom",
    expectedInput: "text",
    allowedCommands: [],
    metadata: { flow: "skills-search", stage: "input", token: Symbol("skills-search") },
  });
}

export async function handleSkillsSearchTextInput(
  ctx: Context,
  deps: SkillsSearchDeps,
): Promise<boolean> {
  const state = skillsSearchState(deps);
  if (!state || state.stage !== "input" || ctx.message?.text === undefined) return false;
  const query = ctx.message.text.slice(0, SKILLS_SEARCH_QUERY_MAX_LENGTH);
  if (!query.trim()) return true;
  try {
    const project = getCurrentProject();
    if (!project) throw new Error("Project no longer selected");
    const skills = filterSkillsForSearch(await loadSkillsCatalog(project.worktree), query);
    if (!sameSkillsSearch(deps, state)) return true;
    if (isForegroundBusy(deps)) {
      await replyBusyBlocked(ctx);
      return true;
    }
    const view = buildSkillsSearchView(skills, query, 0, config.bot.commandsListLimit);
    const sent = await ctx.reply(view.text, { reply_markup: view.keyboard });
    if (!sameSkillsSearch(deps, state)) return true;
    deps.interactionManager.transition({
      expectedInput: "callback",
      metadata: {
        ...state,
        stage: "results",
        query,
        skills,
        projectDirectory: project.worktree,
        messageId: sent.message_id,
      },
    });
  } catch (error) {
    logger.error("[Skills] Error searching skills:", error);
    if (sameSkillsSearch(deps, state)) {
      deps.interactionManager.clear("skills_search_error");
      await ctx.reply(t("skills.fetch_error"));
    }
  }
  return true;
}

async function handleSkillsSearchCallback(
  ctx: Context,
  deps: SkillsCallbackDeps,
): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (isForegroundBusy(deps)) {
    await replyBusyBlocked(ctx);
    return true;
  }
  if (data === SKILLS_CALLBACK_SEARCH) {
    const metadata = parseSkillsMetadata(deps.interactionManager.getSnapshot());
    if (metadata?.stage !== "list" || metadata.messageId !== getCallbackMessageId(ctx)) {
      await ctx.answerCallbackQuery({ text: t("inline.inactive_callback"), show_alert: true });
      return true;
    }
    const initial = deps.interactionManager.getSnapshot();
    await ctx.answerCallbackQuery().catch(() => {});
    await ctx.deleteMessage().catch(() => {});
    const current = deps.interactionManager.getSnapshot();
    if (
      current?.metadata.flow !== "skills" ||
      current.metadata.stage !== "list" ||
      current.metadata.messageId !== initial?.metadata.messageId
    )
      return true;
    startSkillsSearch(deps);
    await ctx.reply(t("skills.search.prompt"));
    return true;
  }
  const state = skillsSearchState(deps);
  if (!state || state.stage !== "results" || state.messageId !== getCallbackMessageId(ctx)) {
    await ctx.answerCallbackQuery({ text: t("inline.inactive_callback"), show_alert: true });
    return true;
  }
  if (data === `${SKILLS_CALLBACK_SEARCH}:cancel`) {
    deps.interactionManager.clear("skills_search_cancelled");
    await cancelMenu(ctx);
    return true;
  }
  if (data === `${SKILLS_CALLBACK_SEARCH}:again`) {
    await ctx.answerCallbackQuery().catch(() => {});
    await ctx.deleteMessage().catch(() => {});
    if (!sameSkillsSearch(deps, state)) return true;
    startSkillsSearch(deps);
    await ctx.reply(t("skills.search.prompt"));
    return true;
  }
  if (data?.startsWith(`${SKILLS_CALLBACK_SEARCH}:page:`)) {
    const raw = data.slice(`${SKILLS_CALLBACK_SEARCH}:page:`.length);
    if (!/^\d+$/.test(raw) || typeof state.query !== "string") return true;
    try {
      const project = getCurrentProject();
      if (!project) throw new Error("Project no longer selected");
      const skills = filterSkillsForSearch(
        await loadSkillsCatalog(project.worktree),
        state.query,
      );
      if (!sameSkillsSearch(deps, state)) {
        await ctx.answerCallbackQuery().catch(() => {});
        return true;
      }
      if (isForegroundBusy(deps)) {
        await replyBusyBlocked(ctx);
        return true;
      }
      const view = buildSkillsSearchView(
        skills,
        state.query,
        Number(raw),
        config.bot.commandsListLimit,
      );
      await ctx.editMessageText(view.text, { reply_markup: view.keyboard });
      if (!sameSkillsSearch(deps, state)) {
        await ctx.answerCallbackQuery().catch(() => {});
        return true;
      }
      deps.interactionManager.transition({
        expectedInput: "callback",
        metadata: { ...state, skills, projectDirectory: project.worktree },
      });
      await ctx.answerCallbackQuery();
    } catch (error) {
      logger.error("[Skills] Error loading search page:", error);
      await ctx.answerCallbackQuery({ text: t("skills.page_load_error_callback") });
    }
    return true;
  }
  if (data?.startsWith(`${SKILLS_CALLBACK_SEARCH}:result:`)) {
    const raw = data.slice(`${SKILLS_CALLBACK_SEARCH}:result:`.length);
    const skills = parseSkillItems(state.skills);
    const selectedSkill = /^\d+$/.test(raw) ? skills?.[Number(raw)] : undefined;
    if (!selectedSkill || typeof state.projectDirectory !== "string") {
      await ctx.answerCallbackQuery({ text: t("inline.inactive_callback"), show_alert: true });
      return true;
    }
    try {
      await ctx.answerCallbackQuery();
      if (!sameSkillsSearch(deps, state)) return true;
      await ctx.editMessageText(t("skills.confirm", { skill: `/${selectedSkill.name}` }), {
        reply_markup: buildSkillsConfirmKeyboard(),
      });
      if (!sameSkillsSearch(deps, state)) return true;
      deps.interactionManager.transition({
        expectedInput: "mixed",
        allowedCommands: [...DEFAULT_ALLOWED_INTERACTION_COMMANDS],
        metadata: {
          flow: "skills",
          stage: "confirm",
          messageId: state.messageId,
          projectDirectory: state.projectDirectory,
          skillName: selectedSkill.name,
        },
      });
    } catch (error) {
      logger.error("[Skills] Error selecting search result:", error);
      if (sameSkillsSearch(deps, state)) {
        deps.interactionManager.clear("skills_search_select_error");
        await ctx.answerCallbackQuery({ text: t("callback.processing_error") }).catch(() => {});
      } else {
        await ctx.answerCallbackQuery().catch(() => {});
      }
    }
  }
  return true;
}
