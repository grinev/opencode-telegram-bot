import { getCurrentModel, setCurrentModel } from "../settings/manager.js";
import { config } from "../config.js";
import { opencodeClient } from "../opencode/client.js";
import { logger } from "../utils/logger.js";
import type { ModelInfo, FavoriteModel, ModelSelectionLists } from "./types.js";
import path from "node:path";

interface OpenCodeModelState {
  favorite?: Array<{ providerID?: string; modelID?: string }>;
  recent?: Array<{ providerID?: string; modelID?: string }>;
}

const MODEL_CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;
const SERVER_UNAVAILABLE_ERROR_MARKERS = [
  "fetch failed",
  "econnrefused",
  "connection refused",
  "connect refused",
];

let cachedValidModelKeys: Set<string> | null = null;
let modelCatalogCacheExpiresAt = 0;
let modelCatalogFetchInFlight: Promise<Set<string> | null> | null = null;

function getModelKey(providerID: string, modelID: string): string {
  return `${providerID}/${modelID}`;
}

function getEnvDefaultModel(): FavoriteModel | null {
  const providerID = config.opencode.model.provider;
  const modelID = config.opencode.model.modelId;

  if (!providerID || !modelID) {
    return null;
  }

  return { providerID, modelID };
}

function dedupeModels(models: FavoriteModel[]): FavoriteModel[] {
  const unique = new Map<string, FavoriteModel>();

  for (const model of models) {
    const key = `${model.providerID}/${model.modelID}`;
    if (!unique.has(key)) {
      unique.set(key, model);
    }
  }

  return Array.from(unique.values());
}

function filterModelsByCatalog(
  models: FavoriteModel[],
  validModelKeys: Set<string> | null,
): FavoriteModel[] {
  if (!validModelKeys) {
    return models;
  }

  return models.filter((model) => validModelKeys.has(getModelKey(model.providerID, model.modelID)));
}

function hasServerUnavailableMarker(value: string): boolean {
  const lower = value.toLowerCase();
  return SERVER_UNAVAILABLE_ERROR_MARKERS.some((marker) => lower.includes(marker));
}

function isServerUnavailableError(error: unknown): boolean {
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.pop();

    if (!current || seen.has(current)) {
      continue;
    }

    seen.add(current);

    if (typeof current === "string") {
      if (hasServerUnavailableMarker(current)) {
        return true;
      }

      continue;
    }

    if (current instanceof Error) {
      if (hasServerUnavailableMarker(`${current.name}: ${current.message}`)) {
        return true;
      }

      const errorWithCause = current as Error & { cause?: unknown };
      if (errorWithCause.cause) {
        queue.push(errorWithCause.cause);
      }

      continue;
    }

    if (typeof current === "object") {
      const value = current as {
        code?: unknown;
        message?: unknown;
        cause?: unknown;
      };

      if (typeof value.code === "string" && hasServerUnavailableMarker(value.code)) {
        return true;
      }

      if (typeof value.message === "string" && hasServerUnavailableMarker(value.message)) {
        return true;
      }

      if (value.cause) {
        queue.push(value.cause);
      }
    }
  }

  return false;
}

function logModelCatalogRefreshFailure(error: unknown, type: "error" | "exception"): void {
  if (isServerUnavailableError(error)) {
    logger.warn("[ModelManager] OpenCode server is not running; skipping model catalog refresh");
    return;
  }

  if (type === "error") {
    logger.warn("[ModelManager] Failed to refresh model catalog:", error);
    return;
  }

  logger.warn("[ModelManager] Error refreshing model catalog:", error);
}

async function getValidModelKeys(options?: { force?: boolean }): Promise<Set<string> | null> {
  if (!options?.force && cachedValidModelKeys && Date.now() < modelCatalogCacheExpiresAt) {
    logger.debug(
      `[ModelManager] Model catalog cache hit: models=${cachedValidModelKeys.size}, ttlMs=${modelCatalogCacheExpiresAt - Date.now()}`,
    );
    return cachedValidModelKeys;
  }

  if (modelCatalogFetchInFlight) {
    logger.debug("[ModelManager] Awaiting in-flight model catalog refresh");
    return modelCatalogFetchInFlight;
  }

  modelCatalogFetchInFlight = (async () => {
    try {
      logger.debug("[ModelManager] Refreshing model catalog from OpenCode API");
      const response = await opencodeClient.config.providers();

      if (response.error || !response.data) {
        logModelCatalogRefreshFailure(response.error, "error");

        if (cachedValidModelKeys) {
          logger.warn("[ModelManager] Using stale model catalog cache after refresh failure");
          return cachedValidModelKeys;
        }

        return null;
      }

      const validModelKeys = new Set<string>();

      for (const provider of response.data.providers) {
        for (const modelID of Object.keys(provider.models)) {
          validModelKeys.add(getModelKey(provider.id, modelID));
        }
      }

      cachedValidModelKeys = validModelKeys;
      modelCatalogCacheExpiresAt = Date.now() + MODEL_CATALOG_CACHE_TTL_MS;

      logger.debug(
        `[ModelManager] Model catalog refreshed: providers=${response.data.providers.length}, models=${validModelKeys.size}`,
      );

      return cachedValidModelKeys;
    } catch (err) {
      logModelCatalogRefreshFailure(err, "exception");

      if (cachedValidModelKeys) {
        logger.warn("[ModelManager] Using stale model catalog cache after refresh exception");
        return cachedValidModelKeys;
      }

      return null;
    } finally {
      modelCatalogFetchInFlight = null;
    }
  })();

  return modelCatalogFetchInFlight;
}

function normalizeFavoriteModels(state: OpenCodeModelState): FavoriteModel[] {
  if (!Array.isArray(state.favorite)) {
    return [];
  }

  return state.favorite
    .filter(
      (model): model is { providerID: string; modelID: string } =>
        typeof model?.providerID === "string" &&
        model.providerID.length > 0 &&
        typeof model.modelID === "string" &&
        model.modelID.length > 0,
    )
    .map((model) => ({
      providerID: model.providerID,
      modelID: model.modelID,
    }));
}

function normalizeRecentModels(state: OpenCodeModelState): FavoriteModel[] {
  if (!Array.isArray(state.recent)) {
    return [];
  }

  return state.recent
    .filter(
      (model): model is { providerID: string; modelID: string } =>
        typeof model?.providerID === "string" &&
        model.providerID.length > 0 &&
        typeof model.modelID === "string" &&
        model.modelID.length > 0,
    )
    .map((model) => ({
      providerID: model.providerID,
      modelID: model.modelID,
    }));
}

function getOpenCodeModelStatePath(): string {
  const xdgStateHome = process.env.XDG_STATE_HOME;

  if (xdgStateHome && xdgStateHome.trim().length > 0) {
    return path.join(xdgStateHome, "opencode", "model.json");
  }

  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  return path.join(homeDir, ".local", "state", "opencode", "model.json");
}

/**
 * Get favorite and recent models from OpenCode local state file.
 * Config model is always treated as favorite.
 */
export async function getModelSelectionLists(): Promise<ModelSelectionLists> {
  const envDefaultModel = getEnvDefaultModel();

  try {
    const fs = await import("fs/promises");

    const stateFilePath = getOpenCodeModelStatePath();
    const content = await fs.readFile(stateFilePath, "utf-8");
    const state = JSON.parse(content) as OpenCodeModelState;

    const rawFavorites = normalizeFavoriteModels(state);
    const rawRecent = normalizeRecentModels(state);
    const shouldValidateWithCatalog = rawFavorites.length > 0 || rawRecent.length > 0;
    const validModelKeys = shouldValidateWithCatalog ? await getValidModelKeys() : null;

    const validatedFavorites = filterModelsByCatalog(rawFavorites, validModelKeys);
    const validatedRecent = filterModelsByCatalog(rawRecent, validModelKeys);

    const favorites = envDefaultModel
      ? dedupeModels([...validatedFavorites, envDefaultModel])
      : validatedFavorites;

    if (rawFavorites.length === 0 && envDefaultModel) {
      logger.info(
        `[ModelManager] No favorites in ${stateFilePath}, using config model as favorite`,
      );
    }

    if (favorites.length === 0) {
      logger.warn(`[ModelManager] No favorites in ${stateFilePath}`);
    }

    const filteredOutFavorites = rawFavorites.length - validatedFavorites.length;
    const filteredOutRecent = rawRecent.length - validatedRecent.length;

    if (filteredOutFavorites > 0 || filteredOutRecent > 0) {
      logger.info(
        `[ModelManager] Filtered unavailable models from OpenCode state: favoritesRemoved=${filteredOutFavorites}, recentRemoved=${filteredOutRecent}`,
      );
    }

    const favoriteKeys = new Set(
      favorites.map((model) => getModelKey(model.providerID, model.modelID)),
    );
    const recent = dedupeModels(validatedRecent).filter(
      (model) => !favoriteKeys.has(getModelKey(model.providerID, model.modelID)),
    );

    logger.debug(
      `[ModelManager] Loaded model selection lists from ${stateFilePath}: favorites=${favorites.length}, recent=${recent.length}`,
    );

    return { favorites, recent };
  } catch (err) {
    if (envDefaultModel) {
      logger.warn(
        "[ModelManager] Failed to load OpenCode model state, using config model as favorite:",
        err,
      );
      return {
        favorites: [envDefaultModel],
        recent: [],
      };
    }

    logger.error("[ModelManager] Failed to load OpenCode model state:", err);
    return {
      favorites: [],
      recent: [],
    };
  }
}

/**
 * Validate stored selected model against OpenCode providers catalog.
 * If selected model is unavailable, fallback to env default model.
 */
export async function reconcileStoredModelSelection(options?: {
  forceCatalogRefresh?: boolean;
}): Promise<void> {
  const currentModel = getCurrentModel();

  if (!currentModel?.providerID || !currentModel.modelID) {
    return;
  }

  const validModelKeys = await getValidModelKeys({ force: options?.forceCatalogRefresh });

  if (!validModelKeys) {
    logger.warn("[ModelManager] Skipping stored model validation: model catalog unavailable");
    return;
  }

  const currentModelKey = getModelKey(currentModel.providerID, currentModel.modelID);

  if (validModelKeys.has(currentModelKey)) {
    return;
  }

  const envDefaultModel = getEnvDefaultModel();
  if (!envDefaultModel) {
    logger.warn(
      `[ModelManager] Stored model ${currentModelKey} is unavailable and env default model is missing`,
    );
    return;
  }

  const fallbackKey = getModelKey(envDefaultModel.providerID, envDefaultModel.modelID);
  logger.warn(
    `[ModelManager] Stored model ${currentModelKey} is unavailable, falling back to ${fallbackKey}`,
  );

  setCurrentModel({
    providerID: envDefaultModel.providerID,
    modelID: envDefaultModel.modelID,
    variant: "default",
  });
}

export function __resetModelCatalogCacheForTests(): void {
  cachedValidModelKeys = null;
  modelCatalogCacheExpiresAt = 0;
  modelCatalogFetchInFlight = null;
}

/**
 * Get list of favorite models from OpenCode local state file
 * Falls back to env default model if file is unavailable or empty
 */
export async function getFavoriteModels(): Promise<FavoriteModel[]> {
  const { favorites } = await getModelSelectionLists();
  return favorites;
}

/**
 * Get current model from settings or fallback to config
 * @returns Current model info
 */
export function fetchCurrentModel(): ModelInfo {
  return getStoredModel();
}

/**
 * Select model and persist to settings
 * @param modelInfo Model to select
 */
export function selectModel(modelInfo: ModelInfo): void {
  logger.info(`[ModelManager] Selected model: ${modelInfo.providerID}/${modelInfo.modelID}`);
  setCurrentModel(modelInfo);
}

/**
 * Get stored model from settings (synchronous)
 * ALWAYS returns a model - fallback to config if not found
 * @returns Current model info
 */
export function getStoredModel(): ModelInfo {
  const storedModel = getCurrentModel();

  if (storedModel) {
    // Ensure variant is set (default to "default")
    if (!storedModel.variant) {
      storedModel.variant = "default";
    }
    return storedModel;
  }

  // Fallback to model from config (environment variables)
  if (config.opencode.model.provider && config.opencode.model.modelId) {
    logger.debug("[ModelManager] Using model from config");
    return {
      providerID: config.opencode.model.provider,
      modelID: config.opencode.model.modelId,
      variant: "default",
    };
  }

  // This should not happen if config is properly set
  logger.warn("[ModelManager] No model found in settings or config, returning empty model");
  return {
    providerID: "",
    modelID: "",
    variant: "default",
  };
}
