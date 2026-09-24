import type { CommandContext, Context } from "grammy";
import type { AppContainer } from "../../app/bootstrap/app-container.js";
import { loadRecentSessions } from "../../app/services/recent-sessions-service.js";
import { isForegroundBusy } from "../../app/services/run-control-service.js";
import { config } from "../../config.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { buildRecentMenu } from "../menus/recent-selection-menu.js";
import { replyWithInlineMenu } from "../menus/inline-menu.js";
import { replyBusyBlocked } from "../messages/busy-blocked-renderer.js";

export async function recentCommand(ctx: CommandContext<Context>, deps: Pick<AppContainer, "interactionManager" | "attachManager" | "foregroundSessionState">): Promise<void> {
  try {
    if (isForegroundBusy(deps)) {
      await replyBusyBlocked(ctx);
      return;
    }
    const rows = await loadRecentSessions(config.bot.sessionsListLimit);
    if (!rows.length) {
      await ctx.reply(t("recent.empty"));
      return;
    }
    const { text, keyboard } = buildRecentMenu(rows);
    await replyWithInlineMenu(ctx, {
      menuKind: "recent", text, keyboard,
      metadata: { sessionIds: rows.map(({ session }) => session.id), directories: rows.map(({ session }) => session.directory) },
    }, deps);
  } catch (error) {
    logger.error("[Recent] Failed to load sessions:", error);
    await ctx.reply(t("sessions.fetch_error"));
  }
}
