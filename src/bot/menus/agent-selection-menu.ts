import { Context, InlineKeyboard } from "grammy";
import { fetchCurrentAgent, getAvailableAgents } from "../../app/services/agent-selection-service.js";
import { getAgentDisplayName } from "../../app/types/agent.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { replyWithInlineMenu } from "./inline-menu.js";

/**
 * Build inline keyboard with available agents
 * @param currentAgent Current agent name for highlighting
 * @returns InlineKeyboard with agent selection buttons
 */
export async function buildAgentSelectionMenu(currentAgent?: string): Promise<InlineKeyboard> {
  const keyboard = new InlineKeyboard();
  const agents = await getAvailableAgents();

  if (agents.length === 0) {
    logger.warn("[AgentHandler] No available agents found");
    return keyboard;
  }

  // Add button for each agent
  agents.forEach((agent) => {
    const isActive = agent.name === currentAgent;
    const label = isActive
      ? `✅ ${getAgentDisplayName(agent.name)}`
      : getAgentDisplayName(agent.name);

    keyboard.text(label, `agent:${agent.name}`).row();
  });

  return keyboard;
}

/**
 * Show agent selection menu
 * @param ctx grammY context
 */
export async function showAgentSelectionMenu(ctx: Context): Promise<void> {
  try {
    const currentAgent = await fetchCurrentAgent();
    const keyboard = await buildAgentSelectionMenu(currentAgent);

    if (keyboard.inline_keyboard.length === 0) {
      await ctx.reply(t("agent.menu.empty"));
      return;
    }

    const text = currentAgent
      ? t("agent.menu.current", { name: getAgentDisplayName(currentAgent) })
      : t("agent.menu.select");

    await replyWithInlineMenu(ctx, {
      menuKind: "agent",
      text,
      keyboard,
    });
  } catch (err) {
    logger.error("[AgentHandler] Error showing agent menu:", err);
    await ctx.reply(t("agent.menu.error"));
  }
}
