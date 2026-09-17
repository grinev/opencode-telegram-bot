import { CommandContext, Context } from "grammy";
import type { AppContainer } from "../../app/bootstrap/app-container.js";
import { getCurrentSession } from "../../app/services/session-service.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { buildRenameCancelKeyboard } from "../menus/rename-menu.js";

export type RenameCommandDeps = Pick<AppContainer, "interactionManager" | "renameManager">;

export async function renameCommand(
  ctx: CommandContext<Context>,
  deps: RenameCommandDeps,
): Promise<void> {
  try {
    const currentSession = getCurrentSession();

    if (!currentSession) {
      await ctx.reply(t("rename.no_session"));
      return;
    }

    const message = await ctx.reply(t("rename.prompt", { title: currentSession.title }), {
      reply_markup: buildRenameCancelKeyboard(),
    });

    deps.renameManager.startWaiting(
      currentSession.id,
      currentSession.directory,
      currentSession.title,
    );
    deps.renameManager.setMessageId(message.message_id);
    deps.interactionManager.transition({
      expectedInput: "text",
      metadata: {
        sessionId: currentSession.id,
        messageId: message.message_id,
      },
    });

    logger.info(`[RenameCommand] Waiting for new title for session: ${currentSession.id}`);
  } catch (error) {
    logger.error("[RenameCommand] Error starting rename flow:", error);
    await ctx.reply(t("rename.error"));
  }
}
