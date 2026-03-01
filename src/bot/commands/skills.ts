import { CommandContext, Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { getCurrentSession } from "../../session/manager.js";
import { opencodeClient } from "../../opencode/client.js";
import {
  appendInlineMenuCancelButton,
  ensureActiveInlineMenu,
  replyWithInlineMenu,
} from "../handlers/inline-menu.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import type { Command } from "@opencode-ai/sdk/v2";

const MAX_INLINE_BUTTON_LABEL_LENGTH = 64;
const SKILLS_PAGE_CALLBACK_PREFIX = "skills:page:";
const SKILLS_RUN_CALLBACK_PREFIX = "skills:run:";

interface SkillsPaginationRange {
  page: number;
  totalPages: number;
  startIndex: number;
  endIndex: number;
}

function formatSkillButtonLabel(name: string, description: string | undefined): string {
  const baseLabel = description ? `${name} — ${description}` : name;
  const availableLength = MAX_INLINE_BUTTON_LABEL_LENGTH;

  if (baseLabel.length <= availableLength) {
    return baseLabel;
  }

  return `${baseLabel.slice(0, Math.max(0, availableLength - 3))}...`;
}

export function parseSkillsPageCallback(data: string): number | null {
  if (!data.startsWith(SKILLS_PAGE_CALLBACK_PREFIX)) {
    return null;
  }

  const rawPage = data.slice(SKILLS_PAGE_CALLBACK_PREFIX.length);
  if (!/^\d+$/.test(rawPage)) {
    return null;
  }

  return Number.parseInt(rawPage, 10);
}

export function parseSkillsRunCallback(data: string): number | null {
  if (!data.startsWith(SKILLS_RUN_CALLBACK_PREFIX)) {
    return null;
  }

  const rawIndex = data.slice(SKILLS_RUN_CALLBACK_PREFIX.length);
  if (!/^\d+$/.test(rawIndex)) {
    return null;
  }

  return Number.parseInt(rawIndex, 10);
}

export function calculateSkillsPaginationRange(
  totalSkills: number,
  page: number,
  pageSize: number,
): SkillsPaginationRange {
  const safePageSize = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(totalSkills / safePageSize));
  const normalizedPage = Math.min(Math.max(0, page), totalPages - 1);
  const startIndex = normalizedPage * safePageSize;
  const endIndex = Math.min(startIndex + safePageSize, totalSkills);

  return {
    page: normalizedPage,
    totalPages,
    startIndex,
    endIndex,
  };
}

function buildSkillsMenuText(page: number, totalPages: number): string {
  const baseText = t("skills.select");

  if (totalPages <= 1) {
    return baseText;
  }

  return `${baseText}\n\n${t("skills.page_indicator", {
    current: String(page + 1),
    total: String(totalPages),
  })}`;
}

function buildSkillsKeyboard(commands: Command[], page: number): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const pageSize = 10;
  const {
    page: normalizedPage,
    totalPages,
    startIndex,
    endIndex,
  } = calculateSkillsPaginationRange(commands.length, page, pageSize);

  commands.slice(startIndex, endIndex).forEach((command, index) => {
    const label = formatSkillButtonLabel(command.name, command.description);
    const globalIndex = startIndex + index;
    keyboard.text(label, `${SKILLS_RUN_CALLBACK_PREFIX}${globalIndex}`).row();
  });

  if (totalPages > 1) {
    if (normalizedPage > 0) {
      keyboard.text(t("skills.prev_page"), `${SKILLS_PAGE_CALLBACK_PREFIX}${normalizedPage - 1}`);
    }

    if (normalizedPage < totalPages - 1) {
      keyboard.text(t("skills.next_page"), `${SKILLS_PAGE_CALLBACK_PREFIX}${normalizedPage + 1}`);
    }
  }

  return keyboard;
}

function buildSkillsMenuView(
  commands: Command[],
  page: number,
): { text: string; keyboard: InlineKeyboard } {
  const pageSize = 10;
  const { page: normalizedPage, totalPages } = calculateSkillsPaginationRange(
    commands.length,
    page,
    pageSize,
  );

  return {
    text: buildSkillsMenuText(normalizedPage, totalPages),
    keyboard: buildSkillsKeyboard(commands, normalizedPage),
  };
}

export async function skillsCommand(ctx: CommandContext<Context>) {
  try {
    const currentSession = getCurrentSession();

    if (!currentSession) {
      await ctx.reply(t("skills.no_session"));
      return;
    }

    const { data: commandsData, error } = await opencodeClient.command.list({
      directory: currentSession.directory,
    });

    if (error || !commandsData) {
      await ctx.reply(t("skills.fetch_error"));
      return;
    }

    if (commandsData.length === 0) {
      await ctx.reply(t("skills.empty"));
      return;
    }

    const { text, keyboard } = buildSkillsMenuView(commandsData, 0);

    await replyWithInlineMenu(ctx, {
      menuKind: "skill",
      text,
      keyboard,
    });
  } catch (error) {
    logger.error("[Bot] Error fetching skills:", error);
    await ctx.reply(t("skills.fetch_error"));
  }
}

export async function handleSkillsSelect(ctx: Context): Promise<boolean> {
  const callbackQuery = ctx.callbackQuery;
  if (!callbackQuery?.data) {
    return false;
  }

  const page = parseSkillsPageCallback(callbackQuery.data);
  const runIndex = parseSkillsRunCallback(callbackQuery.data);

  if (page !== null) {
    const isActiveMenu = await ensureActiveInlineMenu(ctx, "skill");
    if (!isActiveMenu) {
      return true;
    }

    try {
      const currentSession = getCurrentSession();

      if (!currentSession) {
        await ctx.answerCallbackQuery();
        await ctx.reply(t("skills.no_session"));
        return true;
      }

      const { data: commandsData, error } = await opencodeClient.command.list({
        directory: currentSession.directory,
      });

      if (error || !commandsData) {
        await ctx.answerCallbackQuery({ text: t("skills.fetch_error") });
        return true;
      }

      if (commandsData.length === 0) {
        await ctx.answerCallbackQuery();
        await ctx.reply(t("skills.empty"));
        return true;
      }

      const { text, keyboard } = buildSkillsMenuView(commandsData, page);
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(text, {
        reply_markup: appendInlineMenuCancelButton(keyboard, "skill"),
      });
    } catch (error) {
      logger.error("[Bot] Error switching skills page:", error);
      await ctx.answerCallbackQuery({ text: t("skills.page_load_error") });
    }

    return true;
  }

  if (runIndex === null) {
    return false;
  }

  const isActiveMenu = await ensureActiveInlineMenu(ctx, "skill");
  if (!isActiveMenu) {
    return true;
  }

  try {
    const currentSession = getCurrentSession();

    if (!currentSession) {
      await ctx.answerCallbackQuery();
      await ctx.reply(t("skills.no_session"));
      return true;
    }

    const { data: commandsData, error } = await opencodeClient.command.list({
      directory: currentSession.directory,
    });

    if (error || !commandsData) {
      await ctx.answerCallbackQuery({ text: t("skills.fetch_error") });
      return true;
    }

    const selectedCommand = commandsData[runIndex];

    if (!selectedCommand) {
      await ctx.answerCallbackQuery({ text: t("skills.not_found") });
      return true;
    }

    logger.info(`[Bot] Running skill: ${selectedCommand.name} (session=${currentSession.id})`);

    await ctx.answerCallbackQuery({ text: t("skills.run_started") });

    const { error: runError } = await opencodeClient.session.command({
      sessionID: currentSession.id,
      directory: currentSession.directory,
      command: selectedCommand.name,
      arguments: "",
    });

    if (runError) {
      logger.error("[Bot] Error running skill:", runError);
      await ctx.reply(t("skills.run_error"));
      return true;
    }

    await ctx.reply(t("skills.run_success", { skill: selectedCommand.name }));

    await ctx.deleteMessage();
  } catch (error) {
    logger.error("[Bot] Error running skill:", error);
    await ctx.answerCallbackQuery();
    await ctx.reply(t("skills.run_error"));
  }

  return true;
}
