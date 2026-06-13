import { opencodeClient } from "../../opencode/client.js";
import { logger } from "../../utils/logger.js";
import type { Model } from "@opencode-ai/sdk/v2";

interface ModelCapabilitiesCache {
  [key: string]: Model["capabilities"] | null;
}

const capabilitiesCache: ModelCapabilitiesCache = {};

/**
 * Get model capabilities from OpenCode API
 * Results are cached in memory per model
 */
export async function getModelCapabilities(
  providerID: string,
  modelID: string,
): Promise<Model["capabilities"] | null> {
  const cacheKey = `${providerID}/${modelID}`;

  if (capabilitiesCache[cacheKey] !== undefined) {
    logger.debug(`[ModelCapabilities] Cache hit for ${cacheKey}`);
    return capabilitiesCache[cacheKey];
  }

  try {
    logger.debug(`[ModelCapabilities] Fetching capabilities for ${cacheKey}`);
    const response = await opencodeClient.config.providers();

    if (response.error || !response.data) {
      logger.error("[ModelCapabilities] API returned error:", response.error);
      capabilitiesCache[cacheKey] = null;
      return null;
    }

    const providers = response.data.providers;
    const provider = providers.find((p) => p.id === providerID);

    if (!provider) {
      logger.warn(`[ModelCapabilities] Provider ${providerID} not found`);
      capabilitiesCache[cacheKey] = null;
      return null;
    }

    const model = provider.models[modelID];

    if (!model) {
      logger.warn(`[ModelCapabilities] Model ${cacheKey} not found in provider`);
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
  capabilities: Model["capabilities"] | null,
  inputType: "image" | "pdf" | "audio" | "video",
): boolean {
  if (!capabilities) {
    return false;
  }

  return capabilities.input[inputType] === true;
}

/**
 * Check if model supports attachments in general
 */
export function supportsAttachment(capabilities: Model["capabilities"] | null): boolean {
  if (!capabilities) {
    return false;
  }

  return capabilities.attachment === true;
}
