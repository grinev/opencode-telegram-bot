import { CommandContext, Context } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { getCurrentSession } from "../../session/manager.js";
import { getCurrentProject } from "../../settings/manager.js";
import { fetchCurrentAgent } from "../../agent/manager.js";
import { getAgentDisplayName } from "../../agent/types.js";
import { fetchCurrentModel } from "../../model/manager.js";
import { formatModelForDisplay } from "../../model/types.js";
import { processManager } from "../../process/manager.js";
import { keyboardManager } from "../../keyboard/manager.js";
import { pinnedMessageManager } from "../../pinned/manager.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { sendMessageWithMarkdownFallback } from "../utils/send-with-markdown-fallback.js";
import { createDmKeyboard } from "../utils/keyboard.js";
import { getScopeFromContext, getScopeKeyFromContext, getThreadSendOptions } from "../scope.js";

export async function statusCommand(ctx: CommandContext<Context>) {
  try {
    const scopeKey = getScopeKeyFromContext(ctx);
    const scope = getScopeFromContext(ctx);
    const usePinned = ctx.chat?.type !== "private";
    const isPrivateChat = ctx.chat?.type === "private";
    const { data, error } = await opencodeClient.global.health();

    if (error || !data) {
      throw error || new Error("No data received from server");
    }

    if (isPrivateChat) {
      const [projectsResult, sessionsResult] = await Promise.all([
        opencodeClient.project.list(),
        opencodeClient.session.list({ limit: 200 }),
      ]);

      const projectCount = projectsResult.data?.length ?? 0;
      const sessionCount = sessionsResult.data?.length ?? 0;

      const healthLabel = data.healthy ? t("status.health.healthy") : t("status.health.unhealthy");
      let dmMessage = `📊 ${t("status.dm.title")}\n\n`;
      dmMessage += `${t("status.line.health", { health: healthLabel })}\n`;
      if (data.version) {
        dmMessage += `${t("status.line.version", { version: data.version })}\n`;
      }

      if (processManager.isRunning()) {
        const uptime = processManager.getUptime();
        const uptimeStr = uptime ? Math.floor(uptime / 1000) : 0;
        dmMessage += `${t("status.line.managed_yes")}\n`;
        dmMessage += `${t("status.line.pid", { pid: processManager.getPID() ?? "-" })}\n`;
        dmMessage += `${t("status.line.uptime_sec", { seconds: uptimeStr })}\n`;
      } else {
        dmMessage += `${t("status.line.managed_no")}\n`;
      }

      dmMessage += `\n${t("status.global_overview")}\n`;
      dmMessage += `${t("status.global_projects", { count: projectCount })}\n`;
      dmMessage += `${t("status.global_sessions", { count: sessionCount })}\n\n`;
      dmMessage += t("status.dm.hint");

      await ctx.reply(dmMessage, { reply_markup: createDmKeyboard() });
      return;
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
    const currentAgent = await fetchCurrentAgent(scopeKey);
    const agentDisplay = currentAgent
      ? getAgentDisplayName(currentAgent)
      : t("status.agent_not_set");
    message += `${t("status.line.mode", { mode: agentDisplay })}\n`;

    // Add model information
    const currentModel = fetchCurrentModel(scopeKey);
    const modelDisplay = formatModelForDisplay(currentModel.providerID, currentModel.modelID);
    message += `${t("status.line.model", { model: modelDisplay })}\n`;

    const currentProject = getCurrentProject(scopeKey);
    if (currentProject) {
      const projectName = currentProject.name || currentProject.worktree;
      message += `\n${t("status.project_selected", { project: projectName })}\n`;
    } else {
      message += `\n${t("status.project_not_selected")}\n`;
      message += t("status.project_hint");
    }

    const currentSession = getCurrentSession(scopeKey);
    if (currentSession) {
      message += `\n${t("status.session_selected", { title: currentSession.title })}\n`;
    } else {
      message += `\n${t("status.session_not_selected")}\n`;
      message += t("status.session_hint");
    }

    if (ctx.chat) {
      if (usePinned && !pinnedMessageManager.isInitialized(scopeKey)) {
        pinnedMessageManager.initialize(ctx.api, ctx.chat.id, scopeKey, scope?.threadId ?? null);
      }
      if (usePinned && pinnedMessageManager.getContextLimit(scopeKey) === 0) {
        await pinnedMessageManager.refreshContextLimit(scopeKey);
      }
      keyboardManager.initialize(ctx.api, ctx.chat.id, scopeKey);
    }
    const contextInfo =
      (usePinned ? pinnedMessageManager.getContextInfo(scopeKey) : null) ??
      keyboardManager.getContextInfo(scopeKey);
    if (contextInfo) {
      keyboardManager.updateContext(contextInfo.tokensUsed, contextInfo.tokensLimit, scopeKey);
    } else if (usePinned && pinnedMessageManager.getContextLimit(scopeKey) > 0) {
      keyboardManager.updateContext(0, pinnedMessageManager.getContextLimit(scopeKey), scopeKey);
    }
    const keyboard = keyboardManager.getKeyboard(scopeKey);
    if (ctx.chat) {
      await sendMessageWithMarkdownFallback({
        api: ctx.api,
        chatId: ctx.chat.id,
        text: message,
        options: {
          reply_markup: keyboard,
          ...getThreadSendOptions(scope?.threadId ?? null),
        },
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
