/**
 * Variant Manager - manages model variants (reasoning modes)
 */
import { readFileSync } from "fs";
import path from "bun:path";
import { opencodeClient } from "../../opencode/client.js";
import { getCurrentModel, setCurrentModel } from "../stores/settings-store.js";
import { getStoredModel } from "./model-selection-service.js";
import { logger } from "../../utils/logger.js";
import type { VariantInfo } from "../types/variant.js";

// ── OpenCode CLI config reader ────────────────────────────────────
// The bot defaults to "default" variant, but the user may have set
// reasoningEffort or agent variant in ~/.config/opencode/opencode.jsonc.
// Read it here so the bot picks up the same defaults the CLI uses.

const OPENCODE_CONFIG_PATH = path.join(
  process.env.HOME || process.env.USERPROFILE || "~",
  ".config",
  "opencode",
  "opencode.jsonc",
);

/**
 * Strip JSONC comments (single-line // and multi-line /* * /) without
 * touching // inside string values (e.g. https:// URLs).
 */
function stripJsoncComments(content: string): string {
  let result = "";
  let inString = false;
  let escape = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const next = content[i + 1] ?? "";

    if (escape) {
      result += ch;
      escape = false;
      continue;
    }

    if (inString) {
      if (ch === "\\") { escape = true; result += ch; continue; }
      if (ch === '"') { inString = false; }
      result += ch;
      continue;
    }

    if (ch === '"') { inString = true; result += ch; continue; }

    // Single-line comment
    if (ch === "/" && next === "/") {
      while (i < content.length && content[i] !== "\n") i++;
      result += "\n";
      continue;
    }

    // Multi-line comment
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < content.length && !(content[i] === "*" && content[i + 1] === "/")) {
        if (content[i] === "\n") result += "\n";
        i++;
      }
      i++; // skip * (loop for will skip /)
      continue;
    }

    result += ch;
  }

  return result;
}

interface OpenCodeCliProviderConfig {
  provider?: Record<string, {
    models?: Record<string, {
      options?: {
        reasoningEffort?: string;
        [key: string]: unknown;
      };
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  }>;
  agent?: Record<string, {
    variant?: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

let parsedConfig: OpenCodeCliProviderConfig | null | undefined = undefined;

function getOpenCodeCliConfig(): OpenCodeCliProviderConfig | null {
  if (parsedConfig !== undefined) return parsedConfig;
  try {
    const raw = readFileSync(OPENCODE_CONFIG_PATH, "utf-8");
    const json = stripJsoncComments(raw);
    parsedConfig = JSON.parse(json) as OpenCodeCliProviderConfig;
    return parsedConfig;
  } catch {
    parsedConfig = null;
    return null;
  }
}

/**
 * Look up the default variant from the OpenCode CLI config.
 *
 * Priority:
 * 1. `agent.<agentName>.variant` (e.g. `build` → `thinking`)
 * 2. `provider.<providerID>.models.<modelID>.options.reasoningEffort`
 *    (e.g. `deepseek-v4-flash` → `max`)
 * 3. undefined if neither is set
 */
export function getDefaultVariantFromConfig(
  providerID: string,
  modelID: string,
  agentName?: string,
): string | undefined {
  const cfg = getOpenCodeCliConfig();
  if (!cfg) return undefined;

  // Agent-level variant (e.g. build → thinking)
  if (agentName && cfg.agent?.[agentName]?.variant) {
    return cfg.agent[agentName].variant;
  }

  // Model-level reasoningEffort (e.g. deepseek-v4-flash → max)
  const modelOptions = cfg.provider?.[providerID]?.models?.[modelID]?.options;
  if (modelOptions?.reasoningEffort) {
    return modelOptions.reasoningEffort;
  }

  return undefined;
}

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
 * @returns Current variant ID (falls back to OpenCode CLI config, then "default")
 */
export function getCurrentVariant(): string {
  const currentModel = getCurrentModel();
  if (currentModel?.variant) {
    // If the stored variant is "default", check if the OpenCode CLI config
    // specifies a different one (e.g. reasoningEffort: max). This way the
    // bot picks up the user's opencode config automatically without needing
    // to clear settings.json.
    if (currentModel.variant !== "default") return currentModel.variant;
    const fromConfig = getDefaultVariantFromConfig(
      currentModel.providerID || "",
      currentModel.modelID || "",
    );
    return fromConfig ?? "default";
  }

  // Fall back to the OpenCode CLI config
  const fromConfig = getDefaultVariantFromConfig(
    currentModel?.providerID || "",
    currentModel?.modelID || "",
  );
  return fromConfig ?? "default";
}

/**
 * Set current variant in settings
 * @param variantId Variant ID to set
 */
export function setCurrentVariant(variantId: string): void {
  const currentModel = getStoredModel();

  if (!currentModel.providerID || !currentModel.modelID) {
    logger.warn("[VariantManager] Cannot set variant: no current model");
    return;
  }

  setCurrentModel({
    ...currentModel,
    variant: variantId,
  });
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
