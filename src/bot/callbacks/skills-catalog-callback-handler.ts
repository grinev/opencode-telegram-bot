import type { Context } from "grammy";
import { config } from "../../config.js";
import type { SkillCatalogItem } from "../../app/services/skills-catalog-service.js";
import { getCurrentProject } from "../../app/stores/settings-store.js";
import { interactionManager } from "../../app/managers/interaction-manager.js";
import type { InteractionState } from "../../app/types/interaction.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { processUserPrompt, type ProcessPromptDeps } from "../handlers/prompt.js";
import {
  buildSkillsConfirmKeyboard,
  buildSkillsListKeyboard,
  calculateSkillsPaginationRange,
  formatExecutingSkillMessage,
  formatSkillsSelectText,
  parseSkillPageCallback,
  parseSkillSelectCallback,
  SKILLS_CALLBACK_CANCEL,
  SKILLS_CALLBACK_EXECUTE,
  SKILLS_CALLBACK_PREFIX,
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

export function clearSkillsInteraction(reason: string): void {
  const metadata = parseSkillsMetadata(interactionManager.getSnapshot());
  if (metadata) {
    interactionManager.clear(reason);
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
  await processUserPrompt(ctx, promptText, deps);
}

export async function handleSkillsCallback(
  ctx: Context,
  deps: ProcessPromptDeps,
): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith(SKILLS_CALLBACK_PREFIX)) {
    return false;
  }

  const metadata = parseSkillsMetadata(interactionManager.getSnapshot());
  const callbackMessageId = getCallbackMessageId(ctx);

  if (!metadata || callbackMessageId === null || metadata.messageId !== callbackMessageId) {
    await ctx.answerCallbackQuery({ text: t("skills.inactive_callback"), show_alert: true });
    return true;
  }

  try {
    if (data === SKILLS_CALLBACK_CANCEL) {
      clearSkillsInteraction("skills_cancelled");
      await ctx.answerCallbackQuery({ text: t("skills.cancelled_callback") });
      await ctx.deleteMessage().catch(() => {});
      return true;
    }

    if (data === SKILLS_CALLBACK_EXECUTE) {
      if (metadata.stage !== "confirm") {
        await ctx.answerCallbackQuery({ text: t("skills.inactive_callback"), show_alert: true });
        return true;
      }

      clearSkillsInteraction("skills_execute_clicked");
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
        await ctx.answerCallbackQuery({ text: t("callback.processing_error"), show_alert: true });
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
      await ctx.editMessageText(formatSkillsSelectText(normalizedPage), {
        reply_markup: keyboard,
      });
      await ctx.answerCallbackQuery();

      interactionManager.transition({
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
      await ctx.answerCallbackQuery({ text: t("callback.processing_error"), show_alert: true });
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

    interactionManager.transition({
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
    clearSkillsInteraction("skills_callback_error");
    await ctx.answerCallbackQuery({ text: t("callback.processing_error") }).catch(() => {});
    return true;
  }
}
