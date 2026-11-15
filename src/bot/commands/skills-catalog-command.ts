import type { CommandContext, Context } from "grammy";
import type { AppContainer } from "../../app/bootstrap/app-container.js";
import { config } from "../../config.js";
import { loadSkillsCatalog } from "../../app/services/skills-catalog-service.js";
import { getCurrentProject } from "../../app/stores/settings-store.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { isForegroundBusy } from "../../app/services/run-control-service.js";
import { replyBusyBlocked } from "../messages/busy-blocked-renderer.js";
import { buildSkillsListKeyboard, formatSkillsSelectText } from "../menus/skills-catalog-menu.js";

export type SkillsCommandDeps = Pick<
  AppContainer,
  "attachManager" | "foregroundSessionState" | "interactionManager"
>;

export async function skillsCommand(
  ctx: CommandContext<Context>,
  deps: SkillsCommandDeps,
): Promise<void> {
  try {
    if (isForegroundBusy(deps)) {
      await replyBusyBlocked(ctx);
      return;
    }

    const currentProject = getCurrentProject();
    if (!currentProject) {
      await ctx.reply(t("bot.project_not_selected"));
      return;
    }

    const skills = await loadSkillsCatalog(currentProject.worktree);
    if (skills.length === 0) {
      await ctx.reply(t("skills.empty"));
      return;
    }

    const pageSize = config.bot.commandsListLimit;
    const keyboard = buildSkillsListKeyboard(skills, 0, pageSize);
    const message = await ctx.reply(formatSkillsSelectText(0), {
      reply_markup: keyboard,
    });

    deps.interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "skills",
        stage: "list",
        messageId: message.message_id,
        projectDirectory: currentProject.worktree,
        skills,
        page: 0,
      },
    });
  } catch (error) {
    logger.error("[Skills] Error fetching skills list:", error);
    await ctx.reply(t("skills.fetch_error"));
  }
}
