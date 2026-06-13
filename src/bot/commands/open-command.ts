import type { CommandContext, Context } from "grammy";
import { getBrowserRoots } from "../../app/services/file-browser-service.js";
import { interactionManager } from "../../app/managers/interaction-manager.js";
import { isForegroundBusy } from "../../app/services/run-control-service.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { buildOpenRootsKeyboard, clearOpenPathIndex, renderOpenBrowseView } from "../menus/file-browser-menu.js";
import { replyBusyBlocked } from "../messages/busy-blocked-renderer.js";

export async function openCommand(ctx: CommandContext<Context>): Promise<void> {
  try {
    if (isForegroundBusy()) {
      await replyBusyBlocked(ctx);
      return;
    }

    clearOpenPathIndex();

    const roots = getBrowserRoots();
    let text: string;
    let keyboard;

    if (roots.length === 1) {
      const view = await renderOpenBrowseView(roots[0]);
      if ("error" in view) {
        await ctx.reply(t("open.scan_error", { error: view.error }));
        return;
      }
      text = view.text;
      keyboard = view.keyboard;
    } else {
      text = t("open.select_root");
      keyboard = buildOpenRootsKeyboard();
    }

    const message = await ctx.reply(text, { reply_markup: keyboard });

    interactionManager.start({
      kind: "inline",
      expectedInput: "callback",
      metadata: {
        menuKind: "open",
        messageId: message.message_id,
      },
    });
  } catch (error) {
    logger.error("[Bot] Error opening directory browser:", error);
    await ctx.reply(t("open.open_error"));
  }
}
