import { CommandContext, Context } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { getGitWorktreeContext } from "../../git/worktree.js";
import { getCurrentSession } from "../../session/manager.js";
import { getCurrentProject, isTtsEnabled } from "../../settings/manager.js";
import { fetchCurrentAgent } from "../../agent/manager.js";
import { getAgentDisplayName } from "../../agent/types.js";
import { fetchCurrentModel } from "../../model/manager.js";
import { keyboardManager } from "../../keyboard/manager.js";
import { pinnedMessageManager } from "../../pinned/manager.js";
import { getTelegramTargetFromContext } from "../../telegram/target.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { sendBotText } from "../utils/telegram-text.js";

export async function statusCommand(ctx: CommandContext<Context>) {
  try {
    const { data, error } = await opencodeClient.global.health();

    if (error || !data) {
      throw error || new Error("No data received from server");
    }

    let message = `${t("status.header_running")}\n\n`;
    const healthLabel = data.healthy ? t("status.health.healthy") : t("status.health.unhealthy");
    message += `${t("status.line.health", { health: healthLabel })}\n`;
    if (data.version) {
      message += `${t("status.line.version", { version: data.version })}\n`;
    }
    message += `${t("status.line.tts", {
      tts: isTtsEnabled() ? t("status.tts.on") : t("status.tts.off"),
    })}\n`;

    // Add agent information
    const currentAgent = await fetchCurrentAgent();
    const agentDisplay = currentAgent
      ? getAgentDisplayName(currentAgent)
      : t("status.agent_not_set");
    message += `${t("status.line.mode", { mode: agentDisplay })}\n`;

    // Add model information
    const currentModel = fetchCurrentModel();
    const modelDisplay = `🤖 ${currentModel.providerID}/${currentModel.modelID}`;
    message += `${t("status.line.model", { model: modelDisplay })}\n`;

    const currentProject = getCurrentProject();
    if (currentProject) {
      let projectDisplay = currentProject.worktree;
      let linkedWorktreePath: string | null = null;

      try {
        const worktreeContext = await getGitWorktreeContext(currentProject.worktree);
        if (worktreeContext) {
          projectDisplay = worktreeContext.branch
            ? `${worktreeContext.mainProjectPath}: ${worktreeContext.branch}`
            : worktreeContext.mainProjectPath;
          linkedWorktreePath = worktreeContext.isLinkedWorktree
            ? worktreeContext.activeWorktreePath
            : null;
        }
      } catch (error) {
        logger.debug("[Status] Could not resolve git worktree metadata", error);
      }

      message += `\n${t("status.project_selected", { project: projectDisplay })}\n`;
      if (linkedWorktreePath) {
        message += `${t("status.worktree_selected", { worktree: linkedWorktreePath })}\n`;
      }
    } else {
      message += `\n${t("status.project_not_selected")}\n`;
      message += t("status.project_hint");
    }

    const currentSession = getCurrentSession();
    if (currentSession) {
      message += `\n${t("status.session_selected", { title: currentSession.title })}\n`;
    } else {
      message += `\n${t("status.session_not_selected")}\n`;
      message += t("status.session_hint");
    }

    const target = getTelegramTargetFromContext(ctx);

    if (target) {
      if (!pinnedMessageManager.isInitialized()) {
        pinnedMessageManager.initialize(ctx.api, target);
      }
      // Fetch context limit if not yet loaded (e.g. fresh bot start)
      if (pinnedMessageManager.getContextLimit() === 0) {
        await pinnedMessageManager.refreshContextLimit();
      }
      keyboardManager.initialize(ctx.api, target);
    }
    // Sync current context (tokens used + limit) into keyboard state
    const contextInfo = pinnedMessageManager.getContextInfo();
    if (contextInfo) {
      keyboardManager.updateContext(contextInfo.tokensUsed, contextInfo.tokensLimit);
    }
    const keyboard = keyboardManager.getKeyboard();
    if (target) {
      await sendBotText({
        api: ctx.api,
        target,
        text: message,
        options: { reply_markup: keyboard },
      });
    } else {
      await ctx.reply(message, { reply_markup: keyboard });
    }
  } catch (error) {
    logger.error("[Bot] Error checking server status:", error);
    await ctx.reply(t("status.server_unavailable"));
  }
}
