import { getCurrentModel, setCurrentModel } from "../stores/settings-store.js";
import { config } from "../../config.js";
import { opencodeClient } from "../../opencode/client.js";
import { isServerUnavailableError } from "../../utils/opencode-error.js";
import { logger } from "../../utils/logger.js";
import type {
  ModelInfo,
  FavoriteModel,
  ModelSelectionLists,
  ProviderInfo,
} from "../types/model.js";
import path from "node:path";
import { compareMiniMaxChoices, isOrdinaryMiniMaxChoice } from "./minimax-model-choices.js";

interface OpenCodeModelState {
  favorite?: Array<{ providerID?: string; modelID?: string }>;
  recent?: Array<{ providerID?: string; modelID?: string }>;
}

interface ModelCatalogReadResult {
  validModelKeys: Set<string> | null;
  isStale: boolean;
  isComplete: boolean;
}

/**
 * Whether OpenCode offers a model: listed; its provider listed without it; its provider
 * not listed after the bounded wait; or unknown, when the list could not be read.
 */
export type ModelAvailability = "offered" | "model-missing" | "provider-missing" | "unknown";

export interface StoredModelReconcileResult {
  /** A fresh, non-empty catalog was read. */
  catalogAvailable: boolean;
  /** The catalog lists every expected provider; always true outside the warm-up window. */
  catalogComplete: boolean;
  /** The selected model (stored, or the config model) is listed, or there is none to look for. */
  selectedModelListed: boolean;
  /** The stored model was replaced by the config model. */
  storedModelReplaced: boolean;
}

const fetchProvidersList = () => opencodeClient.config.providers();
type ProvidersResponse = Awaited<ReturnType<typeof fetchProvidersList>>;

const MODEL_CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;
const MODEL_CATALOG_WARMUP_MS = 60 * 1000;
const EXPECTED_PROVIDERS_WAIT_MS = 10 * 1000;
const EXPECTED_PROVIDERS_POLL_INTERVAL_MS = 500;

let cachedValidModelKeys: Set<string> | null = null;
let cachedAllModels: FavoriteModel[] | null = null;
let cachedProviders: ProviderInfo[] | null = null;
let cachedModelsByProvider: Map<string, FavoriteModel[]> | null = null;
let cachedCatalogComplete = false;
let modelCatalogCacheExpiresAt = 0;
let modelCatalogFetchInFlight: Promise<ModelCatalogReadResult> | null = null;
let modelCatalogWaitedFetchInFlight: Promise<ModelCatalogReadResult> | null = null;
let modelCatalogWarmupEndsAt = 0;
// Providers still not listed after a full wait; no wait is spent on them until one lists them.
const providersPresumedGone = new Set<string>();
const providersWaitsInFlight = new Map<string, Promise<ProvidersResponse>>();

const SEARCH_RESULTS_LIMIT = 10;

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

function clearModelCatalogCache(): void {
  cachedValidModelKeys = null;
  cachedAllModels = null;
  cachedProviders = null;
  cachedModelsByProvider = null;
  cachedCatalogComplete = false;
  modelCatalogCacheExpiresAt = 0;
}

/**
 * Open the warm-up window after a server start: for its duration a provider list that
 * lacks a provider the user relies on is not treated as final, because the server may
 * still be registering plugin providers.
 */
export function startModelCatalogWarmup(): void {
  modelCatalogWarmupEndsAt = Date.now() + MODEL_CATALOG_WARMUP_MS;
  // A list read before the start may name models the server no longer offers.
  clearModelCatalogCache();
  // The server registers every provider again, so none of them counts as gone any more.
  providersPresumedGone.clear();
}

export function isModelCatalogWarmupActive(): boolean {
  return Date.now() < modelCatalogWarmupEndsAt;
}

async function getExpectedProviderIds(): Promise<Set<string>> {
  const providerIds = new Set<string>();
  const selectedModel = getStoredModel();

  if (selectedModel.providerID) {
    providerIds.add(selectedModel.providerID);
  }

  try {
    const { favorites, recent } = await readOpenCodeModelState();
    for (const model of [...favorites, ...recent]) {
      providerIds.add(model.providerID);
    }
  } catch {
    // Without OpenCode model state only the selected model's provider is expected.
  }

  return providerIds;
}

/**
 * Expected providers (of the selected, favorite and recent models) that a provider list
 * lacks while the warm-up window is open. Outside the window every list counts as complete.
 * @param providerIds Provider IDs of the list that was read
 * @returns Missing provider IDs, empty when the list counts as complete
 */
export async function getMissingExpectedProviders(
  providerIds: Iterable<string>,
): Promise<string[]> {
  if (!isModelCatalogWarmupActive()) {
    return [];
  }

  const listedProviderIds = new Set(providerIds);
  const expectedProviderIds = await getExpectedProviderIds();
  return Array.from(expectedProviderIds).filter((providerId) => !listedProviderIds.has(providerId));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readProvidersUntilListed(
  providerID: string | undefined,
): Promise<ProvidersResponse> {
  const wantedProviderIds = providerID ? [providerID] : Array.from(await getExpectedProviderIds());
  const startedAt = Date.now();

  for (;;) {
    const response = await fetchProvidersList();
    if (response.error || !response.data) {
      return response;
    }

    // A provider without models is not listed yet: a waking location lists none for a moment.
    const listedProviderIds = new Set(
      response.data.providers
        .filter((provider) => Object.keys(provider.models).length > 0)
        .map((provider) => provider.id),
    );
    for (const providerId of listedProviderIds) {
      providersPresumedGone.delete(providerId);
    }

    const awaitedProviderIds = wantedProviderIds.filter(
      (providerId) => !listedProviderIds.has(providerId) && !providersPresumedGone.has(providerId),
    );
    if (awaitedProviderIds.length === 0) {
      return response;
    }

    if (Date.now() - startedAt >= EXPECTED_PROVIDERS_WAIT_MS) {
      for (const providerId of awaitedProviderIds) {
        providersPresumedGone.add(providerId);
      }
      logger.warn(
        `[ModelManager] Providers still not listed after ${EXPECTED_PROVIDERS_WAIT_MS}ms, treating them as gone: missing=${awaitedProviderIds.join(",")}`,
      );
      return response;
    }

    logger.debug(
      `[ModelManager] Providers list lacks awaited providers, retrying: missing=${awaitedProviderIds.join(",")}`,
    );
    await delay(EXPECTED_PROVIDERS_POLL_INTERVAL_MS);
  }
}

/**
 * Read the providers list, waiting (bounded) while it lacks a provider the caller needs:
 * a location OpenCode unloaded while idle lists its providers a few seconds after waking.
 * A provider still missing after the full wait counts as gone and is not waited for again
 * until a list names it or the server starts again. A failed read is returned at once.
 * @param providerID Wait only for this provider; omitted, wait for every expected provider
 */
export function readProvidersWhenListed(providerID?: string): Promise<ProvidersResponse> {
  const waitKey = providerID ?? "";
  const inFlight = providersWaitsInFlight.get(waitKey);
  if (inFlight) {
    return inFlight;
  }

  const read = readProvidersUntilListed(providerID).finally(() => {
    providersWaitsInFlight.delete(waitKey);
  });
  providersWaitsInFlight.set(waitKey, read);
  return read;
}

async function readModelCatalog(options?: {
  force?: boolean | undefined;
  waitForExpectedProviders?: boolean | undefined;
}): Promise<ModelCatalogReadResult> {
  if (!options?.force && cachedValidModelKeys && Date.now() < modelCatalogCacheExpiresAt) {
    logger.debug(
      `[ModelManager] Model catalog cache hit: models=${cachedValidModelKeys.size}, ttlMs=${modelCatalogCacheExpiresAt - Date.now()}`,
    );
    return { validModelKeys: cachedValidModelKeys, isStale: false, isComplete: true };
  }

  // A waiting read never joins a plain one, which could hand it a list still missing providers.
  const waitForExpectedProviders = options?.waitForExpectedProviders ?? false;
  const inFlight = waitForExpectedProviders
    ? modelCatalogWaitedFetchInFlight
    : modelCatalogFetchInFlight;
  if (inFlight) {
    logger.debug("[ModelManager] Awaiting in-flight model catalog refresh");
    return inFlight;
  }

  const read = (async (): Promise<ModelCatalogReadResult> => {
    try {
      logger.debug("[ModelManager] Refreshing model catalog from OpenCode API");
      const response = waitForExpectedProviders
        ? await readProvidersWhenListed()
        : await fetchProvidersList();

      if (response.error || !response.data) {
        logModelCatalogRefreshFailure(response.error, "error");

        if (cachedValidModelKeys) {
          logger.warn("[ModelManager] Using stale model catalog cache after refresh failure");
          return {
            validModelKeys: cachedValidModelKeys,
            isStale: true,
            isComplete: cachedCatalogComplete,
          };
        }

        return { validModelKeys: null, isStale: false, isComplete: false };
      }

      const validModelKeys = new Set<string>();
      const allModels: FavoriteModel[] = [];
      const providers: ProviderInfo[] = [];
      const modelsByProvider = new Map<string, FavoriteModel[]>();

      for (const provider of response.data.providers) {
        const providerModels: FavoriteModel[] = [];

        for (const [modelID, model] of Object.entries(provider.models)) {
          // Availability still includes legacy IDs for saved selections and explicit requests.
          validModelKeys.add(getModelKey(provider.id, modelID));
          const choice = { providerID: provider.id, modelID };
          if (
            provider.source !== "custom" &&
            model.capabilities?.output?.text !== false &&
            !isOrdinaryMiniMaxChoice(choice)
          ) {
            continue;
          }
          allModels.push(choice);
          providerModels.push(choice);
        }

        providerModels.sort(
          (a, b) => compareMiniMaxChoices(a, b) || a.modelID.localeCompare(b.modelID),
        );
        modelsByProvider.set(provider.id, providerModels);
        if (providerModels.length === 0) {
          continue;
        }

        providers.push({
          id: provider.id,
          name: provider.name || provider.id,
          modelCount: providerModels.length,
        });
      }

      if (validModelKeys.size === 0) {
        // A freshly started server lists no models for a moment; an empty list is not its state.
        logger.warn(
          `[ModelManager] Model catalog is empty, treating it as unavailable: providers=${response.data.providers.length}`,
        );
        clearModelCatalogCache();
        return { validModelKeys: null, isStale: false, isComplete: false };
      }

      providers.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

      const missingProviders = await getMissingExpectedProviders(
        response.data.providers.map((provider) => provider.id),
      );
      const isComplete = missingProviders.length === 0;

      cachedValidModelKeys = validModelKeys;
      cachedAllModels = allModels;
      cachedProviders = providers;
      cachedModelsByProvider = modelsByProvider;
      cachedCatalogComplete = isComplete;
      // A list still missing expected providers, or read in the warm-up window, is used for
      // this read but asked again next time: right after a start the server briefly lists
      // models its config has not filtered out yet.
      modelCatalogCacheExpiresAt =
        isComplete && !isModelCatalogWarmupActive() ? Date.now() + MODEL_CATALOG_CACHE_TTL_MS : 0;

      if (isComplete) {
        logger.debug(
          `[ModelManager] Model catalog refreshed: providers=${response.data.providers.length}, models=${validModelKeys.size}`,
        );
      } else {
        logger.debug(
          `[ModelManager] Model catalog lacks expected providers, not caching it: providers=${response.data.providers.length}, models=${validModelKeys.size}, missing=${missingProviders.join(",")}`,
        );
      }

      return { validModelKeys: cachedValidModelKeys, isStale: false, isComplete };
    } catch (err) {
      logModelCatalogRefreshFailure(err, "exception");

      if (cachedValidModelKeys) {
        logger.warn("[ModelManager] Using stale model catalog cache after refresh exception");
        return {
          validModelKeys: cachedValidModelKeys,
          isStale: true,
          isComplete: cachedCatalogComplete,
        };
      }

      return { validModelKeys: null, isStale: false, isComplete: false };
    } finally {
      if (waitForExpectedProviders) {
        modelCatalogWaitedFetchInFlight = null;
      } else {
        modelCatalogFetchInFlight = null;
      }
    }
  })();

  if (waitForExpectedProviders) {
    modelCatalogWaitedFetchInFlight = read;
  } else {
    modelCatalogFetchInFlight = read;
  }
  return read;
}

// The model menu shows favorites and recent, so it waits for all their providers.
async function getValidModelKeys(): Promise<Set<string> | null> {
  return (await readModelCatalog({ waitForExpectedProviders: true })).validModelKeys;
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
 * Read favorite and recent models from OpenCode local state file.
 * Throws when the file is missing or unreadable.
 */
async function readOpenCodeModelState(): Promise<{
  stateFilePath: string;
  favorites: FavoriteModel[];
  recent: FavoriteModel[];
}> {
  const fs = await import("fs/promises");

  const stateFilePath = getOpenCodeModelStatePath();
  const content = await fs.readFile(stateFilePath, "utf-8");
  const state = JSON.parse(content) as OpenCodeModelState;

  return {
    stateFilePath,
    favorites: normalizeFavoriteModels(state),
    recent: normalizeRecentModels(state),
  };
}

/**
 * Get favorite and recent models from OpenCode local state file.
 * Config model is treated as favorite while OpenCode offers it.
 */
export async function getModelSelectionLists(): Promise<ModelSelectionLists> {
  const envDefaultModel = getEnvDefaultModel();

  try {
    const {
      stateFilePath,
      favorites: rawFavorites,
      recent: rawRecent,
    } = await readOpenCodeModelState();
    const shouldValidateWithCatalog =
      rawFavorites.length > 0 || rawRecent.length > 0 || envDefaultModel !== null;
    const validModelKeys = shouldValidateWithCatalog ? await getValidModelKeys() : null;

    const validatedFavorites = filterModelsByCatalog(rawFavorites, validModelKeys);
    const validatedRecent = filterModelsByCatalog(rawRecent, validModelKeys);
    const offeredDefaultModels = filterModelsByCatalog(
      envDefaultModel ? [envDefaultModel] : [],
      validModelKeys,
    );

    const favorites = dedupeModels([...validatedFavorites, ...offeredDefaultModels]);

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
        favorites: filterModelsByCatalog([envDefaultModel], await getValidModelKeys()),
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
 * If selected model is unavailable, fallback to env default model — but not while
 * the catalog still lacks expected providers.
 */
export async function reconcileStoredModelSelection(options?: {
  forceCatalogRefresh?: boolean;
}): Promise<StoredModelReconcileResult> {
  const { validModelKeys, isStale, isComplete } = await readModelCatalog({
    force: options?.forceCatalogRefresh,
  });
  const result: StoredModelReconcileResult = {
    catalogAvailable: validModelKeys !== null && !isStale,
    catalogComplete: isComplete,
    selectedModelListed: false,
    storedModelReplaced: false,
  };
  const currentModel = getCurrentModel();

  if (!currentModel?.providerID || !currentModel.modelID) {
    const envDefaultModel = getEnvDefaultModel();
    result.selectedModelListed =
      !envDefaultModel ||
      (validModelKeys?.has(getModelKey(envDefaultModel.providerID, envDefaultModel.modelID)) ??
        false);
    return result;
  }

  if (!validModelKeys) {
    logger.warn("[ModelManager] Skipping stored model validation: model catalog unavailable");
    return result;
  }

  const currentModelKey = getModelKey(currentModel.providerID, currentModel.modelID);

  if (validModelKeys.has(currentModelKey)) {
    result.selectedModelListed = true;
    return result;
  }

  if (!isComplete) {
    logger.info(
      `[ModelManager] Stored model ${currentModelKey} is not listed yet; keeping it while the server registers providers`,
    );
    return result;
  }

  const envDefaultModel = getEnvDefaultModel();
  if (!envDefaultModel) {
    logger.warn(
      `[ModelManager] Stored model ${currentModelKey} is unavailable and env default model is missing`,
    );
    return result;
  }

  const fallbackKey = getModelKey(envDefaultModel.providerID, envDefaultModel.modelID);
  if (!validModelKeys.has(fallbackKey)) {
    logger.warn(
      `[ModelManager] Stored model ${currentModelKey} is unavailable and config model ${fallbackKey} is not offered either; keeping it`,
    );
    return result;
  }

  logger.warn(
    `[ModelManager] Stored model ${currentModelKey} is unavailable, falling back to ${fallbackKey}`,
  );

  setCurrentModel({
    providerID: envDefaultModel.providerID,
    modelID: envDefaultModel.modelID,
    variant: "default",
  });

  result.storedModelReplaced = true;
  result.selectedModelListed = true;
  return result;
}

/**
 * Check whether OpenCode offers one model, reading only its provider's list (with the
 * bounded wait for that provider), so a missing provider never delays another one.
 * A model found missing drops the cached catalog: whatever is drawn next is read afresh.
 */
export async function getModelAvailability(
  providerID: string,
  modelID: string,
): Promise<ModelAvailability> {
  const modelKey = getModelKey(providerID, modelID);
  let response: ProvidersResponse;
  try {
    response = await readProvidersWhenListed(providerID);
  } catch (err) {
    logModelCatalogRefreshFailure(err, "exception");
    return "unknown";
  }

  if (response.error || !response.data) {
    logModelCatalogRefreshFailure(response.error, "error");
    return "unknown";
  }

  const listedProviders = response.data.providers.filter(
    (provider) => Object.keys(provider.models).length > 0,
  );
  if (listedProviders.length === 0) {
    return "unknown";
  }

  const provider = listedProviders.find((entry) => entry.id === providerID);
  const availability: ModelAvailability = !provider
    ? "provider-missing"
    : Object.hasOwn(provider.models, modelID)
      ? "offered"
      : "model-missing";

  if (availability !== "offered") {
    logger.info(`[ModelManager] Model ${modelKey} is not offered: ${availability}`);
    clearModelCatalogCache();
  }

  return availability;
}

// In the warm-up window a provider not listed yet may still be registering; the read
// after the window decides about it.
async function isModelAdoptable(model: FavoriteModel): Promise<boolean> {
  const availability = await getModelAvailability(model.providerID, model.modelID);
  return (
    availability === "offered" ||
    availability === "unknown" ||
    (availability === "provider-missing" && isModelCatalogWarmupActive())
  );
}

/**
 * Pick the model to store when a session or an agent brings one: the model itself while
 * OpenCode offers it, otherwise the config model, otherwise none (leave the selection).
 */
export async function resolveModelToAdopt(model: FavoriteModel): Promise<FavoriteModel | null> {
  if (await isModelAdoptable(model)) {
    return model;
  }

  const modelKey = getModelKey(model.providerID, model.modelID);
  const envDefaultModel = getEnvDefaultModel();
  if (
    envDefaultModel &&
    getModelKey(envDefaultModel.providerID, envDefaultModel.modelID) !== modelKey &&
    (await isModelAdoptable(envDefaultModel))
  ) {
    logger.info(
      `[ModelManager] Model ${modelKey} is not offered, adopting the config model instead`,
    );
    return envDefaultModel;
  }

  logger.info(`[ModelManager] Model ${modelKey} is not offered, leaving the selection as it is`);
  return null;
}

export function __resetModelCatalogCacheForTests(): void {
  clearModelCatalogCache();
  modelCatalogFetchInFlight = null;
  modelCatalogWaitedFetchInFlight = null;
  modelCatalogWarmupEndsAt = 0;
  providersPresumedGone.clear();
  providersWaitsInFlight.clear();
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
 * Get connected providers from the model catalog, sorted by display name.
 * @returns Providers, empty array if the catalog is unavailable
 */
export async function getProviders(): Promise<ProviderInfo[]> {
  await getValidModelKeys();

  if (!cachedProviders) {
    logger.warn("[ModelManager] Model catalog unavailable, no providers to show");
    return [];
  }

  return cachedProviders;
}

/**
 * Get models of a single provider, sorted by model ID.
 * @param providerID Provider ID
 * @returns Provider models, empty array if the catalog or provider is unavailable
 */
export async function getProviderModels(providerID: string): Promise<FavoriteModel[]> {
  await getValidModelKeys();

  if (!cachedModelsByProvider) {
    logger.warn("[ModelManager] Model catalog unavailable, no provider models to show");
    return [];
  }

  return cachedModelsByProvider.get(providerID) ?? [];
}

/**
 * Search models across the full provider catalog.
 * Matches case-insensitive substring against "providerID/modelID".
 * Returns at most SEARCH_RESULTS_LIMIT results sorted alphabetically.
 * @param query Search query string
 * @returns Matching models, empty array if catalog unavailable or no matches
 */
export async function searchModels(query: string): Promise<FavoriteModel[]> {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return [];
  }

  // Ensure catalog is loaded (uses cache if fresh)
  const validKeys = await getValidModelKeys();

  if (!validKeys || !cachedAllModels) {
    logger.warn("[ModelManager] Model catalog unavailable, skipping search");
    return [];
  }

  const results = cachedAllModels
    .filter((model) => {
      const key = getModelKey(model.providerID, model.modelID).toLowerCase();
      return key.includes(normalizedQuery);
    })
    .sort((a, b) => {
      const keyA = getModelKey(a.providerID, a.modelID).toLowerCase();
      const keyB = getModelKey(b.providerID, b.modelID).toLowerCase();
      return compareMiniMaxChoices(a, b) || keyA.localeCompare(keyB);
    })
    .slice(0, SEARCH_RESULTS_LIMIT);

  logger.debug(`[ModelManager] Model search: query="${query}", results=${results.length}`);

  return results;
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
