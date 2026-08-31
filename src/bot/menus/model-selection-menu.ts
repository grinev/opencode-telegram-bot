import { Context, InlineKeyboard } from "grammy";
import {
  fetchCurrentModel,
  getModelSelectionLists,
} from "../../app/services/model-selection-service.js";
import type {
  FavoriteModel,
  ModelInfo,
  ModelSelectionLists,
  ProviderInfo,
} from "../../app/types/model.js";
import { config } from "../../config.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { replyWithInlineMenu } from "./inline-menu.js";

export const MODEL_SEARCH_CALLBACK = "model:search";
export const MODEL_SEARCH_AGAIN_CALLBACK = "model:search:again";
export const MODEL_SEARCH_CANCEL_CALLBACK = "model:search:cancel";
export const MODEL_LIST_CALLBACK_PREFIX = "model:list:";
export const MODEL_ROOT_CALLBACK = "model:root";
export const MODEL_PROVIDERS_CALLBACK_PREFIX = "model:providers:";
export const MODEL_PROVIDER_CALLBACK_PREFIX = "model:provider:";
export const MODEL_PROVIDER_MODEL_CALLBACK_PREFIX = "model:pick:";

interface ModelsPaginationRange {
  page: number;
  totalPages: number;
  startIndex: number;
  endIndex: number;
}

type ModelListKind = "favorites" | "recent";

export function buildModelListCallback(kind: ModelListKind, index: number): string {
  return `${MODEL_LIST_CALLBACK_PREFIX}${kind}:${index}`;
}

function parseIndex(value: string): number | null {
  if (!/^\d+$/.test(value)) {
    return null;
  }

  return Number.parseInt(value, 10);
}

export function parseProvidersPageCallback(data: string): number | null {
  if (!data.startsWith(MODEL_PROVIDERS_CALLBACK_PREFIX)) {
    return null;
  }

  return parseIndex(data.slice(MODEL_PROVIDERS_CALLBACK_PREFIX.length));
}

export function parseProviderCallback(
  data: string,
): { providerIndex: number; page: number } | null {
  if (!data.startsWith(MODEL_PROVIDER_CALLBACK_PREFIX)) {
    return null;
  }

  const parts = data.slice(MODEL_PROVIDER_CALLBACK_PREFIX.length).split(":");
  if (parts.length !== 2) {
    return null;
  }

  const providerIndexText = parts[0];
  const pageText = parts[1];
  if (providerIndexText === undefined || pageText === undefined) {
    return null;
  }
  const providerIndex = parseIndex(providerIndexText);
  const page = parseIndex(pageText);

  if (providerIndex === null || page === null) {
    return null;
  }

  return { providerIndex, page };
}

export function parseProviderModelCallback(data: string): number | null {
  if (!data.startsWith(MODEL_PROVIDER_MODEL_CALLBACK_PREFIX)) {
    return null;
  }

  return parseIndex(data.slice(MODEL_PROVIDER_MODEL_CALLBACK_PREFIX.length));
}

export function calculateModelsPaginationRange(
  totalItems: number,
  page: number,
  pageSize: number,
): ModelsPaginationRange {
  const safePageSize = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const normalizedPage = Math.min(Math.max(0, page), totalPages - 1);
  const startIndex = normalizedPage * safePageSize;
  const endIndex = Math.min(startIndex + safePageSize, totalItems);

  return {
    page: normalizedPage,
    totalPages,
    startIndex,
    endIndex,
  };
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

  // Search and providers buttons — always present as first row
  keyboard
    .text(t("model.search.button"), MODEL_SEARCH_CALLBACK)
    .text(t("model.providers.button"), `${MODEL_PROVIDERS_CALLBACK_PREFIX}0`)
    .row();

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
 * Build the root model menu view (favorites and recent models).
 */
export async function buildModelRootMenuView(
  currentModel: ModelInfo | undefined,
  modelLists: ModelSelectionLists,
): Promise<{ text: string; keyboard: InlineKeyboard }> {
  return {
    text: buildModelSelectionMenuText(modelLists),
    keyboard: await buildModelSelectionMenu(currentModel, modelLists),
  };
}

function appendPaginationRow(
  keyboard: InlineKeyboard,
  page: number,
  totalPages: number,
  buildCallback: (page: number) => string,
): void {
  if (totalPages <= 1) {
    return;
  }

  if (page > 0) {
    keyboard.text(t("model.providers.prev_page"), buildCallback(page - 1));
  }

  if (page < totalPages - 1) {
    keyboard.text(t("model.providers.next_page"), buildCallback(page + 1));
  }

  keyboard.row();
}

function appendPageIndicator(
  text: string,
  page: number,
  totalPages: number,
  indicatorKey: "model.providers.page_indicator" | "model.provider_models.page_indicator",
): string {
  if (totalPages <= 1) {
    return text;
  }

  return `${text}\n\n${t(indicatorKey, {
    current: String(page + 1),
    total: String(totalPages),
  })}`;
}

/**
 * Build the providers list view.
 */
export function buildProvidersMenuView(
  providers: ProviderInfo[],
  page: number,
): { text: string; keyboard: InlineKeyboard; page: number } {
  const keyboard = new InlineKeyboard();
  const {
    page: normalizedPage,
    totalPages,
    startIndex,
    endIndex,
  } = calculateModelsPaginationRange(providers.length, page, config.bot.modelsListLimit);

  providers.slice(startIndex, endIndex).forEach((provider, index) => {
    const label = `${provider.name} (${provider.modelCount})`;
    keyboard.text(label, `${MODEL_PROVIDER_CALLBACK_PREFIX}${startIndex + index}:0`).row();
  });

  appendPaginationRow(
    keyboard,
    normalizedPage,
    totalPages,
    (targetPage) => `${MODEL_PROVIDERS_CALLBACK_PREFIX}${targetPage}`,
  );

  keyboard.text(t("model.button.back"), MODEL_ROOT_CALLBACK);

  const baseText =
    providers.length === 0 ? t("model.providers.empty") : t("model.providers.title");

  return {
    text: appendPageIndicator(
      baseText,
      normalizedPage,
      totalPages,
      "model.providers.page_indicator",
    ),
    keyboard,
    page: normalizedPage,
  };
}

/**
 * Build the models list view for a single provider.
 */
export function buildProviderModelsMenuView(
  provider: ProviderInfo,
  providerIndex: number,
  models: FavoriteModel[],
  page: number,
  providersPage: number,
  currentModel?: ModelInfo,
): { text: string; keyboard: InlineKeyboard; page: number; pageModels: FavoriteModel[] } {
  const keyboard = new InlineKeyboard();
  const {
    page: normalizedPage,
    totalPages,
    startIndex,
    endIndex,
  } = calculateModelsPaginationRange(models.length, page, config.bot.modelsListLimit);
  const pageModels = models.slice(startIndex, endIndex);

  pageModels.forEach((model, index) => {
    const isActive =
      currentModel &&
      model.providerID === currentModel.providerID &&
      model.modelID === currentModel.modelID;
    const label = isActive ? `✅ ${model.modelID}` : model.modelID;

    keyboard.text(label, `${MODEL_PROVIDER_MODEL_CALLBACK_PREFIX}${index}`).row();
  });

  appendPaginationRow(
    keyboard,
    normalizedPage,
    totalPages,
    (targetPage) => `${MODEL_PROVIDER_CALLBACK_PREFIX}${providerIndex}:${targetPage}`,
  );

  keyboard.text(t("model.button.back"), `${MODEL_PROVIDERS_CALLBACK_PREFIX}${providersPage}`);

  const baseText =
    models.length === 0
      ? t("model.provider_models.empty", { provider: provider.name })
      : t("model.provider_models.title", { provider: provider.name });

  return {
    text: appendPageIndicator(
      baseText,
      normalizedPage,
      totalPages,
      "model.provider_models.page_indicator",
    ),
    keyboard,
    page: normalizedPage,
    pageModels,
  };
}

/**
 * Show model selection menu
 */
export async function showModelSelectionMenu(ctx: Context): Promise<void> {
  try {
    const currentModel = fetchCurrentModel();
    const modelLists = await getModelSelectionLists();
    const { text, keyboard } = await buildModelRootMenuView(currentModel, modelLists);

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
