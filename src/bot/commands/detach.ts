import { CommandContext, Context } from "grammy";
import { getCurrentProject } from "../../settings/manager.js";
import { clearSession, getCurrentSession } from "../../session/manager.js";
import { detachAttachedSession } from "../../attach/service.js";
import { clearAllInteractionState } from "../../interaction/cleanup.js";
import { pinnedMessageManager } from "../../pinned/manager.js";
import { keyboardManager } from "../../keyboard/manager.js";
import { foregroundSessionState } from "../../scheduled-task/foreground-state.js";
import { assistantRunState } from "../assistant-run-state.js";
import { clearPromptResponseMode } from "../handlers/prompt.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";

export async function detachCommand(ctx: CommandContext<Context>): Promise<void> {
  try {
    const currentProject = getCurrentProject();
    if (!currentProject) {
      await ctx.reply(t("detach.project_not_selected"));
      return;
    }

    const currentSession = getCurrentSession();
    if (!currentSession) {
      await ctx.reply(t("detach.no_active_session"));
      return;
    }

    detachAttachedSession("detach_command");
    clearPromptResponseMode(currentSession.id);
    foregroundSessionState.markIdle(currentSession.id);
    assistantRunState.clearRun(currentSession.id, "detach_command");
    clearAllInteractionState("detach_command");
    clearSession();

    if (pinnedMessageManager.isInitialized()) {
      try {
        await pinnedMessageManager.clear();
      } catch (error) {
        logger.error("[Detach] Failed to clear pinned message:", error);
      }
    }

    if (ctx.chat) {
      keyboardManager.initialize(ctx.api, ctx.chat.id);
    }

    await pinnedMessageManager.refreshContextLimit();
    const contextLimit = pinnedMessageManager.getContextLimit();
    keyboardManager.updateContext(0, contextLimit);

    const keyboard = keyboardManager.getKeyboard();

    logger.info(
      `[Detach] Detached from session: id=${currentSession.id}, title="${currentSession.title}", project=${currentProject.worktree}`,
    );

    await ctx.reply(t("detach.success", { title: currentSession.title }), {
      ...(keyboard ? { reply_markup: keyboard } : {}),
    });
  } catch (error) {
    logger.error("[Detach] Failed to detach from current session:", error);
    await ctx.reply(t("detach.error"));
  }
}
