import { Keyboard } from "grammy";
import { getAgentDisplayName } from "../../agent/types.js";
import { formatModelForButton } from "../../model/types.js";
import type { ModelInfo } from "../../model/types.js";
import type { ContextInfo } from "../../keyboard/types.js";
import { t } from "../../i18n/index.js";

/**
 * Format token count for display (e.g., 150000 -> "150K", 1500000 -> "1.5M")
 */
function formatTokenCount(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  } else if (count >= 1000) {
    return `${Math.round(count / 1000)}K`;
  }
  return count.toString();
}

/**
 * Format context information for button
 */
function formatContextForButton(contextInfo: ContextInfo): string {
  const used = formatTokenCount(contextInfo.tokensUsed);
  const limit = formatTokenCount(contextInfo.tokensLimit);
  const percent = Math.round((contextInfo.tokensUsed / contextInfo.tokensLimit) * 100);
  return t("keyboard.context", { used, limit, percent });
}

/**
 * Create Reply Keyboard with agent, model, variant, and context indicators
 * @param currentAgent Current agent name (e.g., "build", "plan")
 * @param currentModel Current model info
 * @param contextInfo Optional context information (tokens used/limit)
 * @param variantName Optional variant display name (e.g., "💭 Default")
 * @returns Reply Keyboard with agent and context in row 1, model and variant in row 2
 */
export function createMainKeyboard(
  currentAgent: string,
  currentModel: ModelInfo,
  contextInfo?: ContextInfo,
  variantName?: string,
): Keyboard {
  const keyboard = new Keyboard();
  const agentText = getAgentDisplayName(currentAgent);

  // Format model with compact provider/model text and icon
  const modelText = formatModelForButton(currentModel.providerID, currentModel.modelID);

  // Context text - show "0" if no data available
  const contextText = contextInfo
    ? formatContextForButton(contextInfo)
    : t("keyboard.context_empty");

  // Variant text - default to "💭 Default" if not provided
  const variantText = variantName || t("keyboard.variant_default");

  // Row 1: agent and context buttons
  keyboard.text(agentText).text(contextText).row();

  // Row 2: model and variant buttons
  keyboard.text(modelText).text(variantText).row();

  return keyboard.resized().persistent();
}

/**
 * Create Reply Keyboard with agent mode indicator
 * @param currentAgent Current agent name (e.g., "build", "plan")
 * @returns Reply Keyboard with single button showing current mode
 * @deprecated Use createMainKeyboard instead
 */
export function createAgentKeyboard(currentAgent: string): Keyboard {
  const keyboard = new Keyboard();
  const displayName = getAgentDisplayName(currentAgent);

  // Single button with current agent mode
  keyboard.text(displayName).row();

  return keyboard.resized().persistent();
}

/**
 * Remove Reply Keyboard (for cleanup)
 */
export function removeKeyboard(): { remove_keyboard: true } {
  return { remove_keyboard: true };
}
