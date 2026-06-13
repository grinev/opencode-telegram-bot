import type { CommandContext, Context } from "grammy";
import { config } from "../../config.js";
import { interactionManager } from "../../app/managers/interaction-manager.js";
import { getCurrentSession } from "../../app/services/session-service.js";
import { loadUserMessages } from "../../app/services/message-history-service.js";
import { isForegroundBusy } from "../../app/services/run-control-service.js";
import { getCurrentProject } from "../../app/stores/settings-store.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { replyBusyBlocked } from "../messages/busy-blocked-renderer.js";
import { buildMessagesListKeyboard, formatMessagesSelectText } from "../menus/message-history-menu.js";

export async function messagesCommand(ctx: CommandContext<Context>): Promise<void> {
  try {
    if (isForegroundBusy()) {
      await replyBusyBlocked(ctx);
      return;
    }

    const currentProject = getCurrentProject();
    if (!currentProject) {
      await ctx.reply(t("messages.project_not_selected"));
      return;
    }

    const currentSession = getCurrentSession();
    if (!currentSession) {
      await ctx.reply(t("messages.session_not_selected"));
      return;
    }

    if (currentSession.directory !== currentProject.worktree) {
      await ctx.reply(t("messages.session_project_mismatch"));
      return;
    }

    const messages = await loadUserMessages(currentSession.id, currentSession.directory);
    if (messages.length === 0) {
      await ctx.reply(t("messages.empty"));
      return;
    }

    const pageSize = config.bot.messagesListLimit;
    const keyboard = buildMessagesListKeyboard(messages, 0, pageSize);
    const message = await ctx.reply(formatMessagesSelectText(0), {
      reply_markup: keyboard,
    });

    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "messages",
        stage: "list",
        messageId: message.message_id,
        projectDirectory: currentProject.worktree,
        sessionId: currentSession.id,
        messages,
        page: 0,
      },
    });
  } catch (error) {
    logger.error("[Messages] Error fetching messages list:", error);
    await ctx.reply(t("messages.fetch_error"));
  }
}
