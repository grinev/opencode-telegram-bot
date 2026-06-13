import type { ModelInfo } from "../../app/types/model.js";

/**
 * Context information for keyboard button
 */
export interface ContextInfo {
  tokensUsed: number;
  tokensLimit: number;
}

/**
 * Keyboard state containing all information for building the Reply Keyboard
 */
export interface KeyboardState {
  currentAgent: string;
  currentModel: ModelInfo;
  contextInfo: ContextInfo | null;
  variantName?: string;
}
