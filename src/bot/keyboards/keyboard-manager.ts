import type { Api } from "grammy";
import { createMainKeyboard } from "./main-reply-keyboard.js";
import { getQueuedPromptButtonLabels } from "./queued-prompt-button.js";
import { getStoredAgent } from "../../app/services/agent-selection-service.js";
import { getStoredModel } from "../../app/services/model-selection-service.js";
import { formatVariantForButton } from "../../app/services/variant-selection-service.js";
import type { ModelInfo } from "../../app/types/model.js";
import { logger } from "../../utils/logger.js";
import type { ContextInfo, KeyboardState } from "./keyboard-types.js";
import { t } from "../../i18n/index.js";
import type { GoalManager } from "../../app/managers/goal-manager.js";
import { getGoalButtonLabels } from "./goal-button.js";
import { getDashboardSelection } from "./dashboard-button.js";
import type { SessionInfo } from "../../app/types/session.js";

/**
 * Keyboard Manager - manages Reply Keyboard state and updates
 */
export class KeyboardManager {
  constructor(private readonly goalManager?: GoalManager) {}

  public getGoalLabels(): string[] {
    return this.goalManager ? getGoalButtonLabels(this.goalManager) : [];
  }
  private state: KeyboardState | null = null;

  private api: Api | null = null;
  private chatId: number | null = null;
  private updateQueue: Promise<void> = Promise.resolve();
  private dashboardTitleUpdate: ReturnType<typeof setTimeout> | undefined;

  /**
   * Initialize the keyboard manager with Telegram API and chat ID
   * Loads initial state from settings/config
   */
  public initialize(api: Api, chatId: number): void {
    this.api = api;
    this.chatId = chatId;

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
        `[KeyboardManager] Initialized with agent="${this.state.currentAgent}", model="${this.state.currentModel.providerID}/${this.state.currentModel.modelID}", variant="${currentModel.variant || "default"}", chatId=${chatId}`,
      );
    } else {
      logger.debug("[KeyboardManager] Already initialized, updating chatId:", chatId);
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
    this.cancelDashboardTitleUpdate();
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
      getQueuedPromptButtonLabels(),
      this.getGoalLabels(),
    );
  }

  /** Explicit corrections are serialized and use the latest keyboard at send time. */
  public sendKeyboardUpdate(chatId?: number, restoredSession?: SessionInfo): Promise<void> {
    if (!restoredSession) this.cancelDashboardTitleUpdate();
    return this.enqueueKeyboardUpdate(chatId, restoredSession);
  }

  /** Batch rapid title changes; a normal keyboard update can deliver the new title sooner. */
  public scheduleDashboardTitleUpdate(chatId: number): void {
    if (this.dashboardTitleUpdate || !this.api) return;
    const timer = setTimeout(() => {
      void this.enqueueKeyboardUpdate(chatId, undefined, () => {
        if (this.dashboardTitleUpdate !== timer) return false;
        this.dashboardTitleUpdate = undefined;
        return true;
      });
    }, 1000);
    this.dashboardTitleUpdate = timer;
    timer.unref();
  }

  private cancelDashboardTitleUpdate(): void {
    clearTimeout(this.dashboardTitleUpdate);
    this.dashboardTitleUpdate = undefined;
  }

  private enqueueKeyboardUpdate(
    chatId: number | undefined,
    restoredSession?: SessionInfo,
    shouldSend?: () => boolean,
  ): Promise<void> {
    const api = this.api;
    const targetChatId = chatId ?? this.chatId;
    if (!api || targetChatId === null) return Promise.resolve();
    const task = this.updateQueue.then(async () => {
      if (shouldSend && !shouldSend()) return;
      try {
        const { session } = getDashboardSelection();
        if (
          restoredSession &&
          (session?.id !== restoredSession.id || session.directory !== restoredSession.directory)
        ) {
          return;
        }
        const text = session
          ? t(restoredSession ? "dashboard.keyboard.restored" : "keyboard.updated", {
              title:
                session.title.replace(/\s+/gu, " ").trim() || t("dashboard.button.unnamed_session"),
            })
          : t("keyboard.no_session");
        await api.sendMessage(targetChatId, text, { reply_markup: this.buildKeyboard() });
      } catch (error) {
        logger.warn("[KeyboardManager] Failed to send keyboard update:", error);
      }
    });
    this.updateQueue = task;
    return task;
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
