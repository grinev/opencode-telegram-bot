import type { CommandContext, Context } from "grammy";
import type { AppContainer } from "../../app/bootstrap/app-container.js";
import { config } from "../../config.js";
import { loadCommandCatalog } from "../../app/services/command-catalog-service.js";
import { getCurrentProject } from "../../app/stores/settings-store.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { buildCommandsListKeyboard, formatCommandsSelectText } from "../menus/command-catalog-menu.js";

export type CommandsCommandDeps = Pick<AppContainer, "interactionManager">;

export async function commandsCommand(
  ctx: CommandContext<Context>,
  deps: CommandsCommandDeps,
): Promise<void> {
  try {
    const currentProject = getCurrentProject();
    if (!currentProject) {
      await ctx.reply(t("bot.project_not_selected"));
      return;
    }

    const commands = await loadCommandCatalog(currentProject.worktree);
    if (commands.length === 0) {
      await ctx.reply(t("commands.empty"));
      return;
    }

    const pageSize = config.bot.commandsListLimit;
    const keyboard = buildCommandsListKeyboard(commands, 0, pageSize);
    const message = await ctx.reply(formatCommandsSelectText(0), {
      reply_markup: keyboard,
    });

    deps.interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "commands",
        stage: "list",
        messageId: message.message_id,
        projectDirectory: currentProject.worktree,
        commands,
        page: 0,
      },
    });
  } catch (error) {
    logger.error("[Commands] Error fetching commands list:", error);
    await ctx.reply(t("commands.fetch_error"));
  }
}
