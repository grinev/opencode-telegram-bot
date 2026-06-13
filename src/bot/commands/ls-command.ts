import type { CommandContext, Context } from "grammy";
import { getProjectRoot, isWithinProjectRoot } from "../../app/services/file-browser-service.js";
import { interactionManager } from "../../app/managers/interaction-manager.js";
import { isForegroundBusy } from "../../app/services/run-control-service.js";
import { t } from "../../i18n/index.js";
import { clearLsPathIndex, renderLsBrowseView } from "../menus/file-browser-menu.js";
import { replyBusyBlocked } from "../messages/busy-blocked-renderer.js";
import { rememberLsDirectory, resolveInitialLsDirectory } from "../callbacks/file-browser-callback-handler.js";

export async function lsCommand(ctx: CommandContext<Context>): Promise<void> {
  if (isForegroundBusy()) {
    await replyBusyBlocked(ctx);
    return;
  }

  clearLsPathIndex();

  const projectRoot = getProjectRoot();
  if (!projectRoot) {
    await ctx.reply(t("bot.project_not_selected"));
    return;
  }

  const args = typeof ctx.match === "string" ? ctx.match.trim() : undefined;
  const targetDir = args || resolveInitialLsDirectory(ctx.from?.id);
  if (!targetDir) {
    await ctx.reply(t("bot.project_not_selected"));
    return;
  }

  if (!isWithinProjectRoot(targetDir)) {
    await ctx.reply(`❌ ${t("ls.access_denied")}`);
    return;
  }

  const view = await renderLsBrowseView(targetDir);
  if ("error" in view) {
    await ctx.reply(`❌ ${view.error}`);
    return;
  }

  rememberLsDirectory(ctx.from?.id, targetDir);

  if (!view.hasActions) {
    await ctx.reply(view.text, { parse_mode: "HTML" });
    return;
  }

  const message = await ctx.reply(view.text, { parse_mode: "HTML", reply_markup: view.keyboard });
  interactionManager.start({
    kind: "inline",
    expectedInput: "callback",
    metadata: {
      menuKind: "ls",
      messageId: message.message_id,
    },
  });
}
