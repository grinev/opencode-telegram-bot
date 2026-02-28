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
  const formatted = `${providerID}/${modelID}`;

  // Limit to ~30 characters for button width (excluding emoji)
  if (formatted.length > 30) {
    return `🤖 ${formatted.substring(0, 27)}...`;
  }

  return `🤖 ${formatted}`;
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
