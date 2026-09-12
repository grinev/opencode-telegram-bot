import type { CommandContext, Context } from "grammy";
import { isForegroundBusy } from "../../app/services/run-control-service.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { showModelSelectionMenu } from "../menus/model-selection-menu.js";
import { replyBusyBlocked } from "../messages/busy-blocked-renderer.js";

export async function modelsCommand(ctx: CommandContext<Context>): Promise<void> {
  try {
    if (isForegroundBusy()) {
      await replyBusyBlocked(ctx);
      return;
    }

    await showModelSelectionMenu(ctx);
  } catch (error) {
    logger.error("[ModelsCommand] Error showing model menu:", error);
    await ctx.reply(t("model.menu.error"));
  }
}
