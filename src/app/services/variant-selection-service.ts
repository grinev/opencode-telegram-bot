/**
 * Variant Manager - manages model variants (reasoning modes)
 */
import { opencodeClient } from "../../opencode/client.js";
import { getCurrentModel, setCurrentModel } from "../stores/settings-store.js";
import { logger } from "../../utils/logger.js";
import type { VariantInfo } from "../types/variant.js";

/**
 * Get available variants for a model from OpenCode API
 * @param providerID Provider ID
 * @param modelID Model ID
 * @returns Array of available variants
 */
export async function getAvailableVariants(
  providerID: string,
  modelID: string,
): Promise<VariantInfo[]> {
  try {
    const { data, error } = await opencodeClient.config.providers();

    if (error || !data) {
      logger.warn("[VariantManager] Failed to fetch providers:", error);
      return [{ id: "default" }];
    }

    const provider = data.providers.find((p) => p.id === providerID);
    if (!provider) {
      logger.warn(`[VariantManager] Provider ${providerID} not found`);
      return [{ id: "default" }];
    }

    const model = provider.models[modelID];
    if (!model) {
      logger.warn(`[VariantManager] Model ${modelID} not found in provider ${providerID}`);
      return [{ id: "default" }];
    }

    // Start with default variant (always present)
    const variants: VariantInfo[] = [{ id: "default" }];

    if (model.variants) {
      // Add other variants from API (excluding default if it's already there)
      const apiVariants = Object.entries(model.variants)
        .filter(([id]) => id !== "default")
        .map(([id, info]) => ({
          id,
          disabled: (info as { disabled?: boolean }).disabled,
        }));

      variants.push(...apiVariants);
      logger.debug(
        `[VariantManager] Found ${variants.length} variants for ${providerID}/${modelID} (including default)`,
      );
    } else {
      logger.debug(
        `[VariantManager] No variants found for ${providerID}/${modelID}, using default only`,
      );
    }

    return variants;
  } catch (err) {
    logger.error("[VariantManager] Error fetching variants:", err);
    return [{ id: "default" }];
  }
}

/**
 * Get current variant from settings
 * @returns Current variant ID (defaults to "default")
 */
export function getCurrentVariant(): string {
  const currentModel = getCurrentModel();
  return currentModel?.variant || "default";
}

/**
 * Set current variant in settings
 * @param variantId Variant ID to set
 */
export function setCurrentVariant(variantId: string): void {
  const currentModel = getCurrentModel();

  if (!currentModel) {
    logger.warn("[VariantManager] Cannot set variant: no current model");
    return;
  }

  currentModel.variant = variantId;
  setCurrentModel(currentModel);
  logger.info(`[VariantManager] Variant set to: ${variantId}`);
}

/**
 * Format variant for button display
 * @param variantId Variant ID (e.g., "default", "low", "high")
 * @returns Formatted string "💭 Default", "💭 Low", etc.
 */
export function formatVariantForButton(variantId: string): string {
  const capitalized = variantId.charAt(0).toUpperCase() + variantId.slice(1);
  return `💡 ${capitalized}`;
}

/**
 * Format variant for display in messages
 * @param variantId Variant ID
 * @returns Formatted string with capitalized first letter
 */
export function formatVariantForDisplay(variantId: string): string {
  return variantId.charAt(0).toUpperCase() + variantId.slice(1);
}

/**
 * Validate if a model supports a specific variant
 * @param providerID Provider ID
 * @param modelID Model ID
 * @param variantId Variant ID to validate
 * @returns true if variant is supported, false otherwise
 */
export async function validateVariantForModel(
  providerID: string,
  modelID: string,
  variantId: string,
): Promise<boolean> {
  const variants = await getAvailableVariants(providerID, modelID);
  const found = variants.find((v) => v.id === variantId && !v.disabled);
  return found !== undefined;
}
