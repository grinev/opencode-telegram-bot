import { Context, InlineKeyboard } from "grammy";
import { getStoredModel } from "../../app/services/model-selection-service.js";
import {
  formatVariantForDisplay,
  getAvailableVariants,
  getCurrentVariant,
} from "../../app/services/variant-selection-service.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { replyWithInlineMenu } from "./inline-menu.js";

/**
 * Build inline keyboard with available variants
 * @param currentVariant Current variant for highlighting
 * @param providerID Provider ID
 * @param modelID Model ID
 * @returns InlineKeyboard with variant selection buttons
 */
export async function buildVariantSelectionMenu(
  currentVariant: string,
  providerID: string,
  modelID: string,
): Promise<InlineKeyboard> {
  const keyboard = new InlineKeyboard();
  const variants = await getAvailableVariants(providerID, modelID);

  if (variants.length === 0) {
    logger.warn("[VariantHandler] No variants found");
    return keyboard;
  }

  // Filter only active variants (not disabled)
  const activeVariants = variants.filter((v) => !v.disabled);

  if (activeVariants.length === 0) {
    logger.warn("[VariantHandler] No active variants found");
    // If no active variants, show default at least
    keyboard.text(`✅ ${formatVariantForDisplay("default")}`, "variant:default").row();
    return keyboard;
  }

  // Add button for each variant (one per row)
  activeVariants.forEach((variant) => {
    const isActive = variant.id === currentVariant;
    const label = formatVariantForDisplay(variant.id);
    const labelWithCheck = isActive ? `✅ ${label}` : label;

    keyboard.text(labelWithCheck, `variant:${variant.id}`).row();
  });

  return keyboard;
}

/**
 * Show variant selection menu
 * @param ctx grammY context
 */
export async function showVariantSelectionMenu(ctx: Context): Promise<void> {
  try {
    const currentModel = getStoredModel();

    if (!currentModel.providerID || !currentModel.modelID) {
      await ctx.reply(t("variant.select_model_first"));
      return;
    }

    const currentVariant = getCurrentVariant();
    const keyboard = await buildVariantSelectionMenu(
      currentVariant,
      currentModel.providerID,
      currentModel.modelID,
    );

    if (keyboard.inline_keyboard.length === 0) {
      await ctx.reply(t("variant.menu.empty"));
      return;
    }

    const displayName = formatVariantForDisplay(currentVariant);
    const text = t("variant.menu.current", { name: displayName });

    await replyWithInlineMenu(ctx, {
      menuKind: "variant",
      text,
      keyboard,
    });
  } catch (err) {
    logger.error("[VariantHandler] Error showing variant menu:", err);
    await ctx.reply(t("variant.menu.error"));
  }
}
