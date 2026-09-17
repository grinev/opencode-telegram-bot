import { Context } from "grammy";
import type { AppContainer } from "../../app/bootstrap/app-container.js";
import { getStoredAgent, resolveProjectAgent } from "../../app/services/agent-selection-service.js";
import { getStoredModel } from "../../app/services/model-selection-service.js";
import {
  formatVariantForButton,
  formatVariantForDisplay,
  setCurrentVariant,
} from "../../app/services/variant-selection-service.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { failure, notify, switched } from "./feedback.js";
import { createMainKeyboard } from "../keyboards/main-reply-keyboard.js";
import { clearActiveInlineMenu, ensureActiveInlineMenu } from "../menus/inline-menu.js";

/**
 * Handle variant selection callback
 * @param ctx grammY context
 * @returns true if handled, false otherwise
 */
export type VariantSelectDeps = Pick<AppContainer, "keyboardManager" | "pinnedMessageManager">;

export async function handleVariantSelect(ctx: Context, deps: VariantSelectDeps): Promise<boolean> {
  const callbackQuery = ctx.callbackQuery;

  if (!callbackQuery?.data || !callbackQuery.data.startsWith("variant:")) {
    return false;
  }

  const isActiveMenu = await ensureActiveInlineMenu(ctx, "variant");
  if (!isActiveMenu) {
    return true;
  }

  logger.debug(`[VariantHandler] Received callback: ${callbackQuery.data}`);

  try {
    if (ctx.chat) {
      deps.keyboardManager.initialize(ctx.api, ctx.chat.id);
    }

    if (deps.pinnedMessageManager.getContextLimit() === 0) {
      await deps.pinnedMessageManager.refreshContextLimit();
    }

    // Parse callback data: "variant:variantId"
    const variantId = callbackQuery.data.replace("variant:", "");

    // Get current model
    const currentModel = getStoredModel();

    if (!currentModel.providerID || !currentModel.modelID) {
      logger.error("[VariantHandler] No model selected");
      await notify(ctx, "variant.model_not_selected_callback");
      return true;
    }

    // Set variant
    setCurrentVariant(variantId);

    // Re-read model after variant update
    const updatedModel = getStoredModel();

    // Update keyboard manager state
    deps.keyboardManager.updateModel(updatedModel);
    deps.keyboardManager.updateVariant(variantId);

    // Build keyboard with correct context info
    const currentAgent = await resolveProjectAgent(getStoredAgent());
    const contextInfo =
      deps.pinnedMessageManager.getContextInfo() ??
      (deps.pinnedMessageManager.getContextLimit() > 0
        ? { tokensUsed: 0, tokensLimit: deps.pinnedMessageManager.getContextLimit() }
        : null);

    deps.keyboardManager.updateAgent(currentAgent);

    if (contextInfo) {
      deps.keyboardManager.updateContext(contextInfo.tokensUsed, contextInfo.tokensLimit);
    }

    const variantName = formatVariantForButton(variantId);
    const keyboard = createMainKeyboard(
      currentAgent,
      updatedModel,
      contextInfo ?? undefined,
      variantName,
    );

    // Send confirmation message with updated keyboard
    const displayName = formatVariantForDisplay(variantId);

    clearActiveInlineMenu("variant_selected");

    // Send confirmation message with updated keyboard, then drop the inline menu
    await switched(ctx, t("variant.changed_message", { name: displayName }), keyboard);
    await deps.pinnedMessageManager.refresh();

    return true;
  } catch (err) {
    clearActiveInlineMenu("variant_select_error");
    logger.error("[VariantHandler] Error handling variant select:", err);
    await failure(ctx, "variant.change_error_callback");
    return true;
  }
}
