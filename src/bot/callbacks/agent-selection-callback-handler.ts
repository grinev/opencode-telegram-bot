import { Context } from "grammy";
import type { AppContainer } from "../../app/bootstrap/app-container.js";
import {
  applyAgentConfiguredSettings,
  selectAgent,
} from "../../app/services/agent-selection-service.js";
import { getStoredModel } from "../../app/services/model-selection-service.js";
import { formatVariantForButton } from "../../app/services/variant-selection-service.js";
import { getAgentDisplayName } from "../../app/types/agent.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { failure, switched } from "./feedback.js";
import { createMainKeyboard } from "../keyboards/main-reply-keyboard.js";
import { clearActiveInlineMenu, ensureActiveInlineMenu } from "../menus/inline-menu.js";

/**
 * Handle agent selection callback
 * @param ctx grammY context
 * @returns true if handled, false otherwise
 */
export type AgentSelectDeps = Pick<
  AppContainer,
  "interactionManager" | "keyboardManager" | "pinnedMessageManager"
>;

export async function handleAgentSelect(ctx: Context, deps: AgentSelectDeps): Promise<boolean> {
  const callbackQuery = ctx.callbackQuery;

  if (!callbackQuery?.data || !callbackQuery.data.startsWith("agent:")) {
    return false;
  }

  const isActiveMenu = await ensureActiveInlineMenu(ctx, "agent", deps);
  if (!isActiveMenu) {
    return true;
  }

  logger.debug(`[AgentHandler] Received callback: ${callbackQuery.data}`);

  try {
    if (ctx.chat) {
      deps.keyboardManager.initialize(ctx.api, ctx.chat.id);
    }

    if (deps.pinnedMessageManager.getContextLimit() === 0) {
      await deps.pinnedMessageManager.refreshContextLimit();
    }

    const agentName = callbackQuery.data.replace("agent:", "");

    selectAgent(agentName);
    const settingsApplied = await applyAgentConfiguredSettings(agentName);

    deps.keyboardManager.updateAgent(agentName);

    const currentModel = getStoredModel();
    const contextInfo =
      deps.pinnedMessageManager.getContextInfo() ??
      (deps.pinnedMessageManager.getContextLimit() > 0
        ? { tokensUsed: 0, tokensLimit: deps.pinnedMessageManager.getContextLimit() }
        : null);

    deps.keyboardManager.updateModel(currentModel);
    if (contextInfo) {
      deps.keyboardManager.updateContext(contextInfo.tokensUsed, contextInfo.tokensLimit);
    }

    const state = deps.keyboardManager.getState();
    const variantName =
      state?.variantName ?? formatVariantForButton(currentModel.variant || "default");
    const keyboard = createMainKeyboard(
      agentName,
      currentModel,
      contextInfo ?? undefined,
      variantName,
    );
    const displayName = getAgentDisplayName(agentName);

    clearActiveInlineMenu("agent_selected", deps);

    await switched(ctx, t("agent.changed_message", { name: displayName }), keyboard);

    if (settingsApplied) {
      await deps.pinnedMessageManager.refresh();
    }

    return true;
  } catch (err) {
    clearActiveInlineMenu("agent_select_error", deps);
    logger.error("[AgentHandler] Error handling agent select:", err);
    await failure(ctx, "agent.change_error_callback");
    return true;
  }
}
