import { CommandContext, Context } from "grammy";
import type { AppContainer } from "../../app/bootstrap/app-container.js";
import { getCurrentProject } from "../../app/stores/settings-store.js";
import { clearSession, getCurrentSession } from "../../app/services/session-service.js";
import { detachAttachedSession } from "../../app/services/attach-service.js";
import { clearPromptResponseMode } from "../handlers/prompt.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";

export type DetachCommandDeps = Pick<
  AppContainer,
  | "assistantRunState"
  | "foregroundSessionState"
  | "keyboardManager"
  | "pinnedMessageManager"
  | "resetInteractions"
>;

export async function detachCommand(
  ctx: CommandContext<Context>,
  deps: DetachCommandDeps,
): Promise<void> {
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
    deps.foregroundSessionState.markIdle(currentSession.id);
    deps.assistantRunState.clearRun(currentSession.id, "detach_command");
    deps.resetInteractions("detach_command");
    clearSession();

    if (deps.pinnedMessageManager.isInitialized()) {
      try {
        await deps.pinnedMessageManager.clear();
      } catch (error) {
        logger.error("[Detach] Failed to clear pinned message:", error);
      }
    }

    if (ctx.chat) {
      deps.keyboardManager.initialize(ctx.api, ctx.chat.id);
    }

    await deps.pinnedMessageManager.refreshContextLimit();
    const contextLimit = deps.pinnedMessageManager.getContextLimit();
    deps.keyboardManager.updateContext(0, contextLimit);

    const keyboard = deps.keyboardManager.getKeyboard();

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
