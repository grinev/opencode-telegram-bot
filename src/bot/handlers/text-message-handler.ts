import type { Context } from "grammy";
import { interactionManager } from "../../app/managers/interaction-manager.js";
import { t } from "../../i18n/index.js";
import {
  clearCommandsInteraction,
  executeCommand,
  parseCommandsMetadata,
  type ExecuteCommandDeps,
} from "../callbacks/command-catalog-callback-handler.js";
import {
  clearSkillsInteraction,
  executeSkill,
  parseSkillsMetadata,
} from "../callbacks/skills-catalog-callback-handler.js";

export async function handleCommandTextArguments(
  ctx: Context,
  deps: ExecuteCommandDeps,
): Promise<boolean> {
  const text = ctx.message?.text;
  if (!text || text.startsWith("/")) {
    return false;
  }

  const metadata = parseCommandsMetadata(interactionManager.getSnapshot());
  if (!metadata || metadata.stage !== "confirm") {
    return false;
  }

  const argumentsText = text.trim();
  if (!argumentsText) {
    await ctx.reply(t("commands.arguments_empty"));
    return true;
  }

  clearCommandsInteraction("commands_arguments_submitted");

  if (ctx.chat) {
    await ctx.api.deleteMessage(ctx.chat.id, metadata.messageId).catch(() => {});
  }

  await executeCommand(ctx, deps, {
    projectDirectory: metadata.projectDirectory,
    commandName: metadata.commandName,
    argumentsText,
  });

  return true;
}

export async function handleSkillTextArguments(
  ctx: Context,
  deps: ExecuteCommandDeps,
): Promise<boolean> {
  const text = ctx.message?.text;
  if (!text || text.startsWith("/")) {
    return false;
  }

  const metadata = parseSkillsMetadata(interactionManager.getSnapshot());
  if (!metadata || metadata.stage !== "confirm") {
    return false;
  }

  const argumentsText = text.trim();
  if (!argumentsText) {
    await ctx.reply(t("skills.arguments_empty"));
    return true;
  }

  clearSkillsInteraction("skills_arguments_submitted");

  if (ctx.chat) {
    await ctx.api.deleteMessage(ctx.chat.id, metadata.messageId).catch(() => {});
  }

  await executeSkill(ctx, deps, {
    projectDirectory: metadata.projectDirectory,
    skillName: metadata.skillName,
    argumentsText,
  });

  return true;
}

export async function handleCatalogTextArguments(
  ctx: Context,
  deps: ExecuteCommandDeps,
): Promise<boolean> {
  const handledCommandArgs = await handleCommandTextArguments(ctx, deps);
  if (handledCommandArgs) {
    return true;
  }

  return handleSkillTextArguments(ctx, deps);
}
