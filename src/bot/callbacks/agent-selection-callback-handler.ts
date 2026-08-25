import { Context } from "grammy";
import { config } from "../../config.js";
import { selectAgent } from "../../app/services/agent-selection-service.js";
import { getStoredModel } from "../../app/services/model-selection-service.js";
import { formatVariantForButton } from "../../app/services/variant-selection-service.js";
import { getAgentDisplayName } from "../../app/types/agent.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { failure, switched } from "./feedback.js";
import { createMainKeyboard } from "../keyboards/main-reply-keyboard.js";
import { keyboardManager } from "../keyboards/keyboard-manager.js";
import { pinnedMessageManager } from "../pinned/pinned-message-manager.js";
import { clearActiveInlineMenu, ensureActiveInlineMenu } from "../menus/inline-menu.js";

/**
 * Handle agent selection callback
 * @param ctx grammY context
 * @returns true if handled, false otherwise
 */
export async function handleAgentSelect(ctx: Context): Promise<boolean> {
  const callbackQuery = ctx.callbackQuery;

  if (!callbackQuery?.data || !callbackQuery.data.startsWith("agent:")) {
    return false;
  }

  const isActiveMenu = await ensureActiveInlineMenu(ctx, "agent");
  if (!isActiveMenu) {
    return true;
  }

  logger.debug(`[AgentHandler] Received callback: ${callbackQuery.data}`);

  try {
    // Single-slot reply keyboard: never re-arm it from one operator's callback
    // in multi-operator mode (same suppression as /start and /status).
    const soloOperator = config.telegram.allowedUserIds.length <= 1;
    if (ctx.chat && soloOperator) {
      keyboardManager.initialize(ctx.api, ctx.chat.id);
    }

    if (pinnedMessageManager.getContextLimit() === 0) {
      await pinnedMessageManager.refreshContextLimit();
    }

    const agentName = callbackQuery.data.replace("agent:", "");

    // Select agent and persist
    selectAgent(agentName);

    // Update keyboard manager state
    keyboardManager.updateAgent(agentName);

    // Update Reply Keyboard with new agent, current model, and context
    const currentModel = getStoredModel();
    const contextInfo =
      pinnedMessageManager.getContextInfo() ??
      (pinnedMessageManager.getContextLimit() > 0
        ? { tokensUsed: 0, tokensLimit: pinnedMessageManager.getContextLimit() }
        : null);

    keyboardManager.updateModel(currentModel);
    if (contextInfo) {
      keyboardManager.updateContext(contextInfo.tokensUsed, contextInfo.tokensLimit);
    }

    const state = keyboardManager.getState();
    const variantName =
      state?.variantName ?? formatVariantForButton(currentModel.variant || "default");
    const keyboard = createMainKeyboard(
      agentName,
      currentModel,
      contextInfo ?? undefined,
      variantName,
    );
    const displayName = getAgentDisplayName(agentName);

    clearActiveInlineMenu("agent_selected");

    // Send confirmation message with updated keyboard, then drop the inline menu
    await switched(ctx, t("agent.changed_message", { name: displayName }), keyboard);

    return true;
  } catch (err) {
    clearActiveInlineMenu("agent_select_error");
    logger.error("[AgentHandler] Error handling agent select:", err);
    await failure(ctx, "agent.change_error_callback");
    return true;
  }
}
