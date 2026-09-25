import { opencodeClient } from "../../opencode/client.js";
import { logger } from "../../utils/logger.js";
import { isExpectedOpencodeUnavailableError } from "../../utils/opencode-error.js";

export const DEFAULT_CONTEXT_LIMIT = 200000;

const PROVIDER_CACHE_TTL_MS = 10 * 60 * 1000;

const contextLimitCache = new Map<string, number>();

let providersCacheExpiresAt = 0;
let providersFetchInFlight: Promise<void> | null = null;

function getModelKey(providerID: string, modelID: string): string {
  return `${providerID}/${modelID}`;
}

async function refreshContextLimitCache(): Promise<void> {
  if (Date.now() < providersCacheExpiresAt) {
    return;
  }

  if (providersFetchInFlight) {
    await providersFetchInFlight;
    return;
  }

  providersFetchInFlight = (async () => {
    try {
      const { data, error } = await opencodeClient.config.providers();

      if (error || !data) {
        if (isExpectedOpencodeUnavailableError(error)) {
          logger.warn("[ModelContextLimit] OpenCode server unavailable; using default context limit");
        } else {
          logger.warn("[ModelContextLimit] Failed to fetch providers:", error);
        }
        return;
      }

      if (data.providers.every((provider) => Object.keys(provider.models).length === 0)) {
        // A freshly started server lists no models for a moment; do not keep that as its state.
        logger.warn("[ModelContextLimit] Providers list has no models; not caching it");
        return;
      }

      contextLimitCache.clear();
      for (const provider of data.providers) {
        for (const [modelID, model] of Object.entries(provider.models)) {
          if (model?.limit?.context) {
            contextLimitCache.set(getModelKey(provider.id, modelID), model.limit.context);
          }
        }
      }

      providersCacheExpiresAt = Date.now() + PROVIDER_CACHE_TTL_MS;
      logger.debug(
        `[ModelContextLimit] Cached limits for ${contextLimitCache.size} provider/model pairs`,
      );
    } catch (error) {
      if (isExpectedOpencodeUnavailableError(error)) {
        logger.warn("[ModelContextLimit] OpenCode server unavailable; using default context limit");
      } else {
        logger.warn("[ModelContextLimit] Error refreshing providers cache:", error);
      }
    } finally {
      providersFetchInFlight = null;
    }
  })();

  await providersFetchInFlight;
}

export async function getModelContextLimit(
  providerID?: string | null,
  modelID?: string | null,
): Promise<number> {
  if (!providerID || !modelID) {
    return DEFAULT_CONTEXT_LIMIT;
  }

  const cacheKey = getModelKey(providerID, modelID);
  const cachedLimit = contextLimitCache.get(cacheKey);
  if (cachedLimit) {
    return cachedLimit;
  }

  await refreshContextLimitCache();
  return contextLimitCache.get(cacheKey) ?? DEFAULT_CONTEXT_LIMIT;
}

export function __resetModelContextLimitCacheForTests(): void {
  contextLimitCache.clear();
  providersCacheExpiresAt = 0;
  providersFetchInFlight = null;
}
