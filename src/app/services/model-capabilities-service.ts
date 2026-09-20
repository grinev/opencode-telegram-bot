import { fetchModelCatalog, findCatalogModel } from "../../opencode/catalog.js";
import { logger } from "../../utils/logger.js";
import type { ModelV2Info } from "@opencode-ai/sdk/v2";

type V2Capabilities = ModelV2Info["capabilities"];

export type ModelCapabilitiesInfo = V2Capabilities;

interface ModelCapabilitiesCache {
  [key: string]: V2Capabilities | null;
}

const capabilitiesCache: ModelCapabilitiesCache = {};

/**
 * Get model capabilities from OpenCode API
 * Results are cached in memory per model
 */
export async function getModelCapabilities(
  providerID: string,
  modelID: string,
): Promise<V2Capabilities | null> {
  const cacheKey = `${providerID}/${modelID}`;

  if (capabilitiesCache[cacheKey] !== undefined) {
    logger.debug(`[ModelCapabilities] Cache hit for ${cacheKey}`);
    return capabilitiesCache[cacheKey];
  }

  try {
    logger.debug(`[ModelCapabilities] Fetching capabilities for ${cacheKey}`);
    const response = await fetchModelCatalog();

    if (response.error || !response.data) {
      logger.error("[ModelCapabilities] API returned error:", response.error);
      capabilitiesCache[cacheKey] = null;
      return null;
    }

    const model = findCatalogModel(response.data, providerID, modelID);

    if (!model) {
      logger.warn(`[ModelCapabilities] Model ${cacheKey} not found in catalog`);
      capabilitiesCache[cacheKey] = null;
      return null;
    }

    logger.debug(`[ModelCapabilities] Found capabilities for ${cacheKey}`);
    capabilitiesCache[cacheKey] = model.capabilities;
    return model.capabilities;
  } catch (error) {
    logger.error("[ModelCapabilities] Failed to fetch providers:", error);
    capabilitiesCache[cacheKey] = null;
    return null;
  }
}

/**
 * Check if model supports a specific input type
 */
export function supportsInput(
  capabilities: V2Capabilities | null,
  inputType: "image" | "pdf" | "audio" | "video",
): boolean {
  if (!capabilities) {
    return false;
  }

  return capabilities.input.includes(inputType);
}

/**
 * Check if model supports attachments in general.
 * v2 has no dedicated attachment flag; any declared input modality counts.
 */
export function supportsAttachment(capabilities: V2Capabilities | null): boolean {
  if (!capabilities) {
    return false;
  }

  return capabilities.input.length > 0;
}
