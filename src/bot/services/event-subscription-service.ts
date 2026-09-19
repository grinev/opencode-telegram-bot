import { Bot, Context } from "grammy";
import { config } from "../../config.js";
import { getCurrentSession } from "../../app/services/session-service.js";
import { logger } from "../../utils/logger.js";
import { clearPromptResponseMode } from "../handlers/prompt.js";
import { setPromptResponseModeClearerForReconciliation } from "../../app/services/busy-reconciliation-service.js";
import { createEventRouter } from "../../app/services/event-router.js";
import type { AppContainer } from "../../app/bootstrap/app-container.js";
import { stopEventListening, subscribeToEvents } from "../../opencode/events.js";
import { SessionRuntimeState } from "../events/session-runtime-state.js";
import type {
  SessionTargetPolicy,
  TelegramDestination,
} from "../events/telegram-event-delivery.js";
import { createBackgroundNoticeDelivery } from "../events/background-notice-delivery.js";
import { getReplyKeyboard } from "../events/handlers/handler-context.js";
import { registerAssistantResponseHandlers } from "../events/handlers/assistant-response-handler.js";
import { registerToolActivityHandlers } from "../events/handlers/tool-activity-handler.js";
import { registerInteractionHandlers } from "../events/handlers/interaction-handler.js";
import { registerSessionLifecycleHandlers } from "../events/handlers/session-lifecycle-handler.js";
import { registerDashboardHandlers } from "../events/handlers/dashboard-handler.js";

export interface BotEventSubscriptionService {
  ensureEventSubscription(directory: string): Promise<void>;
  setTelegramContext(bot: Bot<Context> | null, chatId: number | null): void;
  clearRuntimeState(reason: string): void;
  cleanup(reason: string): void;
}

export type EventSubscriptionServiceDeps = Pick<
  AppContainer,
  | "assistantRunState"
  | "attachManager"
  | "backgroundSessionTracker"
  | "externalUserInputSuppressionManager"
  | "foregroundSessionState"
  | "interactionManager"
  | "keyboardManager"
  | "permissionManager"
  | "pinnedMessageManager"
  | "questionManager"
  | "scheduledTaskRuntime"
  | "summaryAggregator"
>;

export function createEventSubscriptionService(
  deps: EventSubscriptionServiceDeps,
): BotEventSubscriptionService {
  return new EventSubscriptionService(deps);
}

/**
 * Coordinates the OpenCode -> Telegram bridge: owns the subscription lifecycle
 * and is the one place that decides where session messages go. Today every
 * session goes to the single chat, and the followed session is the foreground.
 */
class EventSubscriptionService implements BotEventSubscriptionService {
  private botInstance: Bot<Context> | null = null;
  private chatIdInstance: number | null = null;
  private readonly policy: SessionTargetPolicy = {
    getDestination: () => this.getChatDestination(),
    isForegroundSession: (sessionId) => getCurrentSession()?.id === sessionId,
  };
  private readonly runtime: SessionRuntimeState;

  constructor(private readonly deps: EventSubscriptionServiceDeps) {
    this.runtime = new SessionRuntimeState({
      policy: this.policy,
      getReplyKeyboard: () => getReplyKeyboard(deps),
    });
    setPromptResponseModeClearerForReconciliation(clearPromptResponseMode);
  }

  setTelegramContext(bot: Bot<Context> | null, chatId: number | null): void {
    this.botInstance = bot;
    this.chatIdInstance = chatId;
  }

  clearRuntimeState = (reason: string): void => {
    this.deps.backgroundSessionTracker.clear();
    this.runtime.reset(reason);
    this.deps.assistantRunState.clearAll(reason);
  };

  cleanup(reason: string): void {
    stopEventListening();
    this.deps.summaryAggregator.clear();
    this.clearRuntimeState(reason);
    this.setTelegramContext(null, null);
  }

  ensureEventSubscription = async (directory: string): Promise<void> => {
    if (!directory) {
      logger.error("No directory found for event subscription");
      return;
    }

    const { deps, runtime, policy } = this;

    deps.summaryAggregator.setTypingIndicatorEnabled(true);
    deps.backgroundSessionTracker.setDirectory(directory);
    deps.backgroundSessionTracker.setOnNotification(
      createBackgroundNoticeDelivery(policy, runtime.delivery),
    );

    if (!config.bot.trackBackgroundSessions) {
      deps.backgroundSessionTracker.clear();
    }

    deps.summaryAggregator.setOnCleared(() => {
      runtime.clearAllOutput("summary_aggregator_clear");
    });

    const handlerDeps = { ...deps, runtime, policy };
    registerAssistantResponseHandlers(handlerDeps);
    registerToolActivityHandlers(handlerDeps);
    registerInteractionHandlers(handlerDeps);
    registerSessionLifecycleHandlers(handlerDeps);
    registerDashboardHandlers(handlerDeps);

    logger.info(`[Bot] Subscribing to OpenCode events for project: ${directory}`);
    subscribeToEvents(
      directory,
      createEventRouter({
        directory,
        deps,
        isForegroundSession: policy.isForegroundSession,
      }),
    ).catch((err) => {
      logger.error("Failed to subscribe to events:", err);
    });
  };

  private getChatDestination(): TelegramDestination | null {
    if (!this.botInstance || !this.chatIdInstance) {
      return null;
    }

    return { api: this.botInstance.api, chatId: this.chatIdInstance };
  }
}
