import { CommandContext, Context } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { getCurrentSession } from "../../session/manager.js";
import { getCurrentProject } from "../../settings/manager.js";
import { fetchCurrentAgent } from "../../agent/manager.js";
import { getAgentDisplayName } from "../../agent/types.js";
import { fetchCurrentModel } from "../../model/manager.js";
import { processManager } from "../../process/manager.js";
import { keyboardManager } from "../../keyboard/manager.js";
import { pinnedMessageManager } from "../../pinned/manager.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { sendMessageWithMarkdownFallback } from "../utils/send-with-markdown-fallback.js";

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

    // Add process management information
    if (processManager.isRunning()) {
      const uptime = processManager.getUptime();
      const uptimeStr = uptime ? Math.floor(uptime / 1000) : 0;
      message += `${t("status.line.managed_yes")}\n`;
      message += `${t("status.line.pid", { pid: processManager.getPID() ?? "-" })}\n`;
      message += `${t("status.line.uptime_sec", { seconds: uptimeStr })}\n`;
    } else {
      message += `${t("status.line.managed_no")}\n`;
    }

    // Add agent mode information
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
      const projectName = currentProject.name || currentProject.worktree;
      message += `\n${t("status.project_selected", { project: projectName })}\n`;
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

    if (ctx.chat) {
      if (!pinnedMessageManager.isInitialized()) {
        pinnedMessageManager.initialize(ctx.api, ctx.chat.id);
      }
      // Fetch context limit if not yet loaded (e.g. fresh bot start)
      if (pinnedMessageManager.getContextLimit() === 0) {
        await pinnedMessageManager.refreshContextLimit();
      }
      keyboardManager.initialize(ctx.api, ctx.chat.id);
    }
    // Sync current context (tokens used + limit) into keyboard state
    const contextInfo = pinnedMessageManager.getContextInfo();
    if (contextInfo) {
      keyboardManager.updateContext(contextInfo.tokensUsed, contextInfo.tokensLimit);
    }
    const keyboard = keyboardManager.getKeyboard();
    if (ctx.chat) {
      await sendMessageWithMarkdownFallback({
        api: ctx.api,
        chatId: ctx.chat.id,
        text: message,
        options: { reply_markup: keyboard },
        parseMode: "Markdown",
      });
    } else {
      await ctx.reply(message, { reply_markup: keyboard });
    }
  } catch (error) {
    logger.error("[Bot] Error checking server status:", error);
    await ctx.reply(t("status.server_unavailable"));
  }
}
