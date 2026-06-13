/**
 * Model types and formatting utilities
 */

export interface ModelInfo {
  providerID: string;
  modelID: string;
  variant?: string;
}

export interface VariantInfo {
  id: string;
  disabled?: boolean;
}

export interface FavoriteModel {
  providerID: string;
  modelID: string;
}

export interface ModelSelectionLists {
  favorites: FavoriteModel[];
  recent: FavoriteModel[];
}

/**
 * Format model for button display (compact format)
 * @param providerID Provider ID
 * @param modelID Model ID
 * @returns Formatted string "providerID/modelID"
 */
export function formatModelForButton(providerID: string, modelID: string): string {
  // If model name is too long, we only truncate the model part
  const displayModelId = modelID.length > 20 ? `${modelID.substring(0, 17)}...` : modelID;
  const displayProviderId =
    providerID.length > 15 ? `${providerID.substring(0, 12)}...` : providerID;

  return `🤖 ${displayProviderId}\n${displayModelId}`;
}

/**
 * Format model for display in messages (full format)
 * @param providerID Provider ID
 * @param modelID Model ID
 * @returns Formatted string "providerID / modelID"
 */
export function formatModelForDisplay(providerID: string, modelID: string): string {
  return `${providerID} / ${modelID}`;
}
