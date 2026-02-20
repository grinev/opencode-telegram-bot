import { Context, InlineKeyboard } from "grammy";
import { selectModel, getFavoriteModels, fetchCurrentModel } from "../../model/manager.js";
import { formatModelForDisplay } from "../../model/types.js";
import type { ModelInfo } from "../../model/types.js";
import { formatVariantForButton } from "../../variant/manager.js";
import { logger } from "../../utils/logger.js";
import { createMainKeyboard } from "../utils/keyboard.js";
import { getStoredAgent } from "../../agent/manager.js";
import { pinnedMessageManager } from "../../pinned/manager.js";
import { keyboardManager } from "../../keyboard/manager.js";
import {
  clearActiveInlineMenu,
  ensureActiveInlineMenu,
  replyWithInlineMenu,
} from "./inline-menu.js";
import { t } from "../../i18n/index.js";

/**
 * Handle model selection callback
 * @param ctx grammY context
 * @returns true if handled, false otherwise
 */
export async function handleModelSelect(ctx: Context): Promise<boolean> {
  const callbackQuery = ctx.callbackQuery;

  if (!callbackQuery?.data || !callbackQuery.data.startsWith("model:")) {
    return false;
  }

  const isActiveMenu = await ensureActiveInlineMenu(ctx, "model");
  if (!isActiveMenu) {
    return true;
  }

  logger.debug(`[ModelHandler] Received callback: ${callbackQuery.data}`);

  try {
    if (ctx.chat) {
      keyboardManager.initialize(ctx.api, ctx.chat.id);
    }

    // Parse callback data: "model:providerID:modelID"
    const parts = callbackQuery.data.split(":");
    if (parts.length < 3) {
      logger.error(`[ModelHandler] Invalid callback data format: ${callbackQuery.data}`);
      clearActiveInlineMenu("model_select_invalid_callback");
      await ctx.answerCallbackQuery({ text: t("model.change_error_callback") }).catch(() => {});
      return true;
    }

    const providerID = parts[1];
    const modelID = parts.slice(2).join(":"); // Handle model IDs that may contain ":"

    const modelInfo: ModelInfo = {
      providerID,
      modelID,
      variant: "default", // Reset to default when switching models
    };

    // Select model and persist
    selectModel(modelInfo);

    // Update keyboard manager state (may not be initialized if no session selected)
    keyboardManager.updateModel(modelInfo);

    // Refresh context limit for new model
    await pinnedMessageManager.refreshContextLimit();

    // Update Reply Keyboard with new model and context
    const currentAgent = getStoredAgent();
    const contextInfo =
      pinnedMessageManager.getContextInfo() ??
      (pinnedMessageManager.getContextLimit() > 0
        ? { tokensUsed: 0, tokensLimit: pinnedMessageManager.getContextLimit() }
        : null);

    if (contextInfo) {
      keyboardManager.updateContext(contextInfo.tokensUsed, contextInfo.tokensLimit);
    }

    const variantName = formatVariantForButton(modelInfo.variant || "default");
    const keyboard = createMainKeyboard(
      currentAgent,
      modelInfo,
      contextInfo ?? undefined,
      variantName,
    );
    const displayName = formatModelForDisplay(modelInfo.providerID, modelInfo.modelID);

    clearActiveInlineMenu("model_selected");

    // Send confirmation message with updated keyboard
    await ctx.answerCallbackQuery({ text: t("model.changed_callback", { name: displayName }) });
    await ctx.reply(t("model.changed_message", { name: displayName }), {
      reply_markup: keyboard,
    });

    // Delete the inline menu message
    await ctx.deleteMessage().catch(() => {});

    return true;
  } catch (err) {
    clearActiveInlineMenu("model_select_error");
    logger.error("[ModelHandler] Error handling model select:", err);
    await ctx.answerCallbackQuery({ text: t("model.change_error_callback") }).catch(() => {});
    return false;
  }
}

/**
 * Build inline keyboard with favorite models
 * @param currentModel Current model for highlighting
 * @returns InlineKeyboard with model selection buttons
 */
export async function buildModelSelectionMenu(currentModel?: ModelInfo): Promise<InlineKeyboard> {
  const keyboard = new InlineKeyboard();
  const favorites = await getFavoriteModels();

  if (favorites.length === 0) {
    logger.warn("[ModelHandler] No favorite models found");
    return keyboard;
  }

  // Add button for each favorite model
  favorites.forEach((model) => {
    const isActive =
      currentModel &&
      model.providerID === currentModel.providerID &&
      model.modelID === currentModel.modelID;

    // Inline buttons use full model ID without truncation
    const label = `${model.providerID}/${model.modelID}`;
    const labelWithCheck = isActive ? `✅ ${label}` : label;

    keyboard.text(labelWithCheck, `model:${model.providerID}:${model.modelID}`).row();
  });

  return keyboard;
}

/**
 * Show model selection menu
 * @param ctx grammY context
 */
export async function showModelSelectionMenu(ctx: Context): Promise<void> {
  try {
    const currentModel = fetchCurrentModel();
    const keyboard = await buildModelSelectionMenu(currentModel);

    if (keyboard.inline_keyboard.length === 0) {
      await ctx.reply(t("model.menu.empty"));
      return;
    }

    const displayName = formatModelForDisplay(currentModel.providerID, currentModel.modelID);

    const text = t("model.menu.current", { name: displayName });

    await replyWithInlineMenu(ctx, {
      menuKind: "model",
      text,
      keyboard,
    });
  } catch (err) {
    logger.error("[ModelHandler] Error showing model menu:", err);
    await ctx.reply(t("model.menu.error"));
  }
}
