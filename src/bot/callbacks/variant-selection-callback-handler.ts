import { Context } from "grammy";
import { getStoredAgent, resolveProjectAgent } from "../../app/services/agent-selection-service.js";
import { getStoredModel } from "../../app/services/model-selection-service.js";
import {
  formatVariantForButton,
  formatVariantForDisplay,
  setCurrentVariant,
} from "../../app/services/variant-selection-service.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { createMainKeyboard } from "../keyboards/main-reply-keyboard.js";
import { keyboardManager } from "../keyboards/keyboard-manager.js";
import { pinnedMessageManager } from "../pinned/pinned-message-manager.js";
import { clearActiveInlineMenu, ensureActiveInlineMenu } from "../menus/inline-menu.js";

/**
 * Handle variant selection callback
 * @param ctx grammY context
 * @returns true if handled, false otherwise
 */
export async function handleVariantSelect(ctx: Context): Promise<boolean> {
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
      keyboardManager.initialize(ctx.api, ctx.chat.id);
    }

    if (pinnedMessageManager.getContextLimit() === 0) {
      await pinnedMessageManager.refreshContextLimit();
    }

    // Parse callback data: "variant:variantId"
    const variantId = callbackQuery.data.replace("variant:", "");

    // Get current model
    const currentModel = getStoredModel();

    if (!currentModel.providerID || !currentModel.modelID) {
      logger.error("[VariantHandler] No model selected");
      await ctx.answerCallbackQuery({ text: t("variant.model_not_selected_callback") });
      return false;
    }

    // Set variant
    setCurrentVariant(variantId);

    // Re-read model after variant update
    const updatedModel = getStoredModel();

    // Update keyboard manager state
    keyboardManager.updateModel(updatedModel);
    keyboardManager.updateVariant(variantId);

    // Build keyboard with correct context info
    const currentAgent = await resolveProjectAgent(getStoredAgent());
    const contextInfo =
      pinnedMessageManager.getContextInfo() ??
      (pinnedMessageManager.getContextLimit() > 0
        ? { tokensUsed: 0, tokensLimit: pinnedMessageManager.getContextLimit() }
        : null);

    keyboardManager.updateAgent(currentAgent);

    if (contextInfo) {
      keyboardManager.updateContext(contextInfo.tokensUsed, contextInfo.tokensLimit);
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

    await ctx.answerCallbackQuery({ text: t("variant.changed_callback", { name: displayName }) });
    await ctx.reply(t("variant.changed_message", { name: displayName }), {
      reply_markup: keyboard,
    });

    // Delete the inline menu message
    await ctx.deleteMessage().catch(() => {});

    return true;
  } catch (err) {
    clearActiveInlineMenu("variant_select_error");
    logger.error("[VariantHandler] Error handling variant select:", err);
    await ctx.answerCallbackQuery({ text: t("variant.change_error_callback") }).catch(() => {});
    return false;
  }
}
