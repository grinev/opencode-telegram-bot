import type { Api } from "grammy";
import { createMainKeyboard } from "../bot/utils/keyboard.js";
import type { ModelInfo } from "../model/types.js";
import { getStoredAgent } from "../agent/manager.js";
import { getStoredModel } from "../model/manager.js";
import { getTelegramTargetSendOptions, type TelegramTarget } from "../telegram/target.js";
import { formatVariantForButton } from "../variant/manager.js";
import { logger } from "../utils/logger.js";
import type { ContextInfo, KeyboardState } from "./types.js";
import { t } from "../i18n/index.js";

/**
 * Keyboard Manager - manages Reply Keyboard state and updates
 * Singleton pattern
 */
class KeyboardManager {
  private state: KeyboardState | null = null;

  private api: Api | null = null;
  private chatId: number | null = null;
  private target: TelegramTarget | null = null;
  private lastUpdateTime: number = 0;
  private readonly UPDATE_DEBOUNCE_MS = 2000; // Don't update more than once per 2 seconds

  /**
   * Initialize the keyboard manager with Telegram API and chat ID
   * Loads initial state from settings/config
   */
  public initialize(api: Api, target: TelegramTarget): void {
    this.api = api;
    this.chatId = target.chatId;
    this.target = target;

    // Initialize state from settings/config on first call
    if (!this.state) {
      const currentModel = getStoredModel();
      this.state = {
        currentAgent: getStoredAgent(),
        currentModel: currentModel,
        contextInfo: null,
        variantName: formatVariantForButton(currentModel.variant || "default"),
      };
      logger.debug(
        `[KeyboardManager] Initialized with agent="${this.state.currentAgent}", model="${this.state.currentModel.providerID}/${this.state.currentModel.modelID}", variant="${currentModel.variant || "default"}", chatId=${target.chatId}`,
      );
    } else {
      logger.debug("[KeyboardManager] Already initialized, updating chatId:", target.chatId);
    }
  }

  /**
   * Update current agent
   */
  public updateAgent(agent: string): void {
    if (!this.state) {
      logger.warn("[KeyboardManager] Cannot update agent: not initialized");
      return;
    }
    this.state.currentAgent = agent;
    logger.debug(`[KeyboardManager] Agent updated: ${agent}`);
  }

  /**
   * Update current model
   */
  public updateModel(model: ModelInfo): void {
    if (!this.state) {
      logger.warn("[KeyboardManager] Cannot update model: not initialized");
      return;
    }
    this.state.currentModel = model;
    this.state.variantName = formatVariantForButton(model.variant || "default");
    logger.debug(
      `[KeyboardManager] Model updated: ${model.providerID}/${model.modelID}, variant: ${model.variant || "default"}`,
    );
  }

  /**
   * Update current variant
   */
  public updateVariant(variantId: string): void {
    if (!this.state) {
      logger.warn("[KeyboardManager] Cannot update variant: not initialized");
      return;
    }
    this.state.variantName = formatVariantForButton(variantId);
    logger.debug(`[KeyboardManager] Variant updated: ${variantId}`);
  }

  /**
   * Update context information
   */
  public updateContext(tokensUsed: number, tokensLimit: number): void {
    if (!this.state) {
      logger.warn("[KeyboardManager] Cannot update context: not initialized");
      return;
    }
    this.state.contextInfo = { tokensUsed, tokensLimit };
    logger.debug(`[KeyboardManager] Context updated: ${tokensUsed}/${tokensLimit}`);
  }

  /**
   * Clear context information
   */
  public clearContext(): void {
    if (!this.state) {
      logger.warn("[KeyboardManager] Cannot clear context: not initialized");
      return;
    }
    this.state.contextInfo = null;
    logger.debug("[KeyboardManager] Context cleared");
  }

  /**
   * Get current context info
   */
  public getContextInfo(): ContextInfo | null {
    return this.state?.contextInfo ?? null;
  }

  /**
   * Build keyboard with current state
   */
  private buildKeyboard() {
    if (!this.state) {
      logger.warn("[KeyboardManager] Cannot build keyboard: not initialized");
      // Return a minimal keyboard as fallback
      return createMainKeyboard("build", { providerID: "", modelID: "" }, undefined);
    }
    return createMainKeyboard(
      this.state.currentAgent,
      this.state.currentModel,
      this.state.contextInfo ?? undefined,
      this.state.variantName,
    );
  }

  /**
   * Send keyboard update to user
   * Implements debouncing to avoid rate limits
   */
  public async sendKeyboardUpdate(chatId?: number): Promise<void> {
    if (!this.api) {
      logger.warn("[KeyboardManager] API not initialized");
      return;
    }

    const targetChatId = chatId ?? this.chatId;
    if (!targetChatId) {
      logger.warn("[KeyboardManager] No chatId available");
      return;
    }

    // Debounce: don't update more frequently than UPDATE_DEBOUNCE_MS
    const now = Date.now();
    if (now - this.lastUpdateTime < this.UPDATE_DEBOUNCE_MS) {
      logger.debug("[KeyboardManager] Update debounced");
      return;
    }

    this.lastUpdateTime = now;

    try {
      const keyboard = this.buildKeyboard();

      // Send a dummy message with updated keyboard
      // This is needed because Reply Keyboard updates require a message
      await this.api.sendMessage(targetChatId, t("keyboard.updated"), {
        ...(this.target ? getTelegramTargetSendOptions(this.target) : {}),
        reply_markup: keyboard,
      });

      logger.debug("[KeyboardManager] Keyboard update sent");
    } catch (err) {
      logger.error("[KeyboardManager] Failed to send keyboard update:", err);
    }
  }

  /**
   * Update keyboard without sending a message (for use in existing messages)
   * Returns undefined if not initialized (caller should handle this)
   */
  public getKeyboard() {
    if (!this.state) {
      logger.warn("[KeyboardManager] Cannot get keyboard: not initialized");
      return undefined;
    }
    return this.buildKeyboard();
  }

  /**
   * Get current keyboard state
   * Returns undefined if not initialized
   */
  public getState(): KeyboardState | undefined {
    return this.state ?? undefined;
  }

  /**
   * Check if keyboard manager is initialized
   */
  public isInitialized(): boolean {
    return this.state !== null;
  }
}

// Export singleton instance
export const keyboardManager = new KeyboardManager();
