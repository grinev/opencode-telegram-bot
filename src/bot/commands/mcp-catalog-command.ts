import type { CommandContext, Context } from "grammy";
import { interactionManager } from "../../app/managers/interaction-manager.js";
import { loadMcpCatalog } from "../../app/services/mcp-catalog-service.js";
import { getCurrentProject } from "../../app/stores/settings-store.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { buildMcpsListKeyboard } from "../menus/mcp-catalog-menu.js";

export async function mcpsCommand(ctx: CommandContext<Context>): Promise<void> {
  try {
    const currentProject = getCurrentProject();
    if (!currentProject) {
      await ctx.reply(t("bot.project_not_selected"));
      return;
    }

    const servers = await loadMcpCatalog(currentProject.worktree);
    if (servers.length === 0) {
      await ctx.reply(t("mcps.empty"));
      return;
    }

    const keyboard = buildMcpsListKeyboard(servers);
    const message = await ctx.reply(t("mcps.select"), {
      reply_markup: keyboard,
    });

    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "mcps",
        stage: "list",
        messageId: message.message_id,
        projectDirectory: currentProject.worktree,
        servers,
      },
    });
  } catch (error) {
    logger.error("[Mcps] Error fetching MCP servers list:", error);
    await ctx.reply(t("mcps.fetch_error"));
  }
}
