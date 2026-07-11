import { Context, InlineKeyboard } from "grammy";
import {
  fetchCurrentModel,
  getModelSelectionLists,
} from "../../app/services/model-selection-service.js";
import type { FavoriteModel, ModelInfo, ModelSelectionLists } from "../../app/types/model.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { replyWithInlineMenu } from "./inline-menu.js";

export const MODEL_SEARCH_CALLBACK = "model:search";
export const MODEL_SEARCH_AGAIN_CALLBACK = "model:search:again";
export const MODEL_SEARCH_CANCEL_CALLBACK = "model:search:cancel";
export const MODEL_LIST_CALLBACK_PREFIX = "model:list:";

type ModelListKind = "favorites" | "recent";

export function buildModelListCallback(kind: ModelListKind, index: number): string {
  return `${MODEL_LIST_CALLBACK_PREFIX}${kind}:${index}`;
}

function buildModelSelectionMenuText(modelLists: ModelSelectionLists): string {
  const lines = [t("model.menu.select"), t("model.menu.favorites_title")];

  if (modelLists.favorites.length === 0) {
    lines.push(t("model.menu.favorites_empty"));
  }

  lines.push(t("model.menu.recent_title"));

  if (modelLists.recent.length === 0) {
    lines.push(t("model.menu.recent_empty"));
  }

  return lines.join("\n");
}

/**
 * Build inline keyboard with favorite and recent models, plus a search button at the top.
 */
export async function buildModelSelectionMenu(
  currentModel?: ModelInfo,
  modelLists?: ModelSelectionLists,
): Promise<InlineKeyboard> {
  const keyboard = new InlineKeyboard();
  const lists = modelLists ?? (await getModelSelectionLists());
  const favorites = lists.favorites;
  const recent = lists.recent;

  // Search button — always present as first row
  keyboard.text(t("model.search.button"), MODEL_SEARCH_CALLBACK).row();

  if (favorites.length === 0 && recent.length === 0) {
    logger.warn("[ModelHandler] No model choices found in favorites/recent");
    return keyboard;
  }

  const addButton = (
    model: FavoriteModel,
    prefix: string,
    kind: ModelListKind,
    index: number,
  ): void => {
    const isActive =
      currentModel &&
      model.providerID === currentModel.providerID &&
      model.modelID === currentModel.modelID;

    const label = `${prefix} ${model.providerID}/${model.modelID}`;
    const labelWithCheck = isActive ? `✅ ${label}` : label;

    keyboard.text(labelWithCheck, buildModelListCallback(kind, index)).row();
  };

  favorites.forEach((model, index) => addButton(model, "⭐", "favorites", index));
  recent.forEach((model, index) => addButton(model, "🕘", "recent", index));

  return keyboard;
}

/**
 * Show model selection menu
 */
export async function showModelSelectionMenu(ctx: Context): Promise<void> {
  try {
    const currentModel = fetchCurrentModel();
    const modelLists = await getModelSelectionLists();
    const keyboard = await buildModelSelectionMenu(currentModel, modelLists);

    // keyboard always has at least the search button, so length > 0
    const text = buildModelSelectionMenuText(modelLists);

    await replyWithInlineMenu(ctx, {
      menuKind: "model",
      text,
      keyboard,
      metadata: { modelLists },
    });
  } catch (err) {
    logger.error("[ModelHandler] Error showing model menu:", err);
    await ctx.reply(t("model.menu.error"));
  }
}
