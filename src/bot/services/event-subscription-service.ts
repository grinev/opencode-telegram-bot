import { Bot, Context } from "grammy";
import type { Event } from "@opencode-ai/sdk/v2";
import { config } from "../../config.js";
import { opencodeServerVersion } from "../../opencode/client.js";
import { getCurrentSession } from "../../app/services/session-service.js";
import { restorePendingInteractionsAfterReconnect } from "../../app/services/attach-service.js";
import { reconcileInboxPrompts } from "../../app/services/prompt-inbox-service.js";
import { logger } from "../../utils/logger.js";
import { clearPromptResponseMode } from "../handlers/prompt.js";
import { setPromptResponseModeClearerForReconciliation } from "../../app/services/busy-reconciliation-service.js";
import { createEventRouter } from "../../app/services/event-router.js";
import type { AppContainer } from "../../app/bootstrap/app-container.js";
import {
  stopEventListening,
  subscribeToEvents,
  type ReconnectInfo,
} from "../../opencode/events.js";
import { closeQuestionNotAnswered } from "../menus/question-menu.js";
import { SessionRuntimeState } from "../events/session-runtime-state.js";
import { buildFailedToolEvent } from "../events/failed-tool-event.js";
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
  stopBackgroundOperations(reason: string, sessionId?: string): void;
  countBackgroundOperations(sessionId: string): number;
  interruptSubagents(reason: string): void;
  endRunLostWithServer(reason: string): Promise<void>;
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

/** The idle OpenCode sends for an interrupted execution, marked the way the V2 adapter does. */
function buildInterruptedIdleEvents(sessionId: string): Event[] {
  return [
    {
      id: `${sessionId}:lost:status`,
      type: "session.status",
      properties: { sessionID: sessionId, status: { type: "idle" } },
    },
    {
      id: `${sessionId}:lost:idle`,
      type: "session.idle",
      properties: { sessionID: sessionId, interrupted: true } as { sessionID: string },
    },
  ];
}

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

  stopBackgroundOperations = (reason: string, sessionId?: string): void => {
    this.deps.summaryAggregator.retireBackgroundSubagents();
    this.runtime.stopBackgroundOperations(reason, sessionId);
  };

  stopBackgroundCommands = (reason: string, sessionId?: string): void => {
    this.runtime.stopBackgroundCommands(reason, sessionId);
  };

  countBackgroundOperations = (sessionId: string): number =>
    this.runtime.countBackgroundCommands(sessionId) +
    this.deps.summaryAggregator.countFollowedBackgroundSubagents();

  interruptSubagents = (reason: string): void => {
    logger.debug(`[Bot] Interrupting running subagent cards: reason=${reason}`);
    this.deps.summaryAggregator.interruptSubagents();
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
      (info) => this.restoreAfterReconnect(info),
    ).catch((err) => {
      logger.error("Failed to subscribe to events:", err);
    });
  };

  /**
   * Ends the followed session's run in the chat the way `/abort` does, for a V2 server that
   * ended it without saying so (stopped or restarted): the poll on screen closes as not
   * answered, running subagent cards end interrupted, then the events OpenCode sends on an
   * abort — each running call failed, then
   * an interrupted idle — go through the usual pipeline. Everything up to the first await
   * runs at once, so events that arrive later are handled after the ending.
   */
  endRunLostWithServer = async (reason: string): Promise<void> => {
    if (opencodeServerVersion !== "v2") {
      return;
    }

    const { deps, runtime } = this;
    const destination = this.getChatDestination();
    // First: failing the poll's question call below would delete the poll, as after /abort.
    const pollClosed =
      destination && deps.questionManager.isActive()
        ? closeQuestionNotAnswered(destination.api, destination.chatId, deps)
        : Promise.resolve();

    // The server took every session's background commands with it.
    this.stopBackgroundCommands(reason);
    const { summaryAggregator } = deps;
    summaryAggregator.forgetLiveTurn();

    const holdGeneration = summaryAggregator.holdOutbound();
    try {
      // Every subagent card still running ends with the server and is no longer followed; one
      // the server resumes gets a new card.
      summaryAggregator.interruptSubagents(true);

      const sessionId = getCurrentSession()?.id;
      const runningTools = sessionId ? runtime.getRunningToolInfos(sessionId) : [];
      if (sessionId && (deps.assistantRunState.hasRun(sessionId) || runningTools.length > 0)) {
        logger.info(
          `[Bot] Ending the run lost with the OpenCode server: session=${sessionId}, runningTools=${runningTools.length}, reason=${reason}`,
        );
        deps.assistantRunState.clearRun(sessionId, reason);

        const now = Date.now();
        for (const tool of runningTools) {
          summaryAggregator.processEvent(buildFailedToolEvent(tool, now));
        }
        for (const event of buildInterruptedIdleEvents(sessionId)) {
          summaryAggregator.processEvent(event);
        }
      }

      await Promise.all([
        pollClosed,
        summaryAggregator.drainOutbound(0, holdGeneration),
        summaryAggregator.whenOutboundIdle(),
      ]);
    } finally {
      // Best-effort release: a throw before the drain must not leave the hold set.
      void summaryAggregator.drainOutbound(0, holdGeneration).catch((error) => {
        logger.warn("[Bot] Failed to release the ending outbound:", error);
      });
    }
  };

  private restoreAfterReconnect({ serverRestarted }: ReconnectInfo): void {
    if (serverRestarted === true) {
      // The restarted server lost the run and resumes it as a new turn: the old one ends
      // here before any event of the new connection is handled.
      this.endRunLostWithServer("opencode_restarted").catch((error) => {
        logger.warn("[Bot] Failed to end the run lost with the OpenCode server:", error);
      });
    } else {
      // The new stream no longer knows the background operations the old one announced,
      // so their end would never arrive.
      this.stopBackgroundOperations("event_stream_reconnect");
      // An idle missed in the gap must not time a later turn from this one.
      this.deps.summaryAggregator.forgetLiveTurn();
    }

    // A pickup or cancel of a waiting message in the gap was missed with the other events.
    const session = getCurrentSession();
    if (session) {
      logger.debug(`[Bot] Reconciling the session inbox after reconnect: session=${session.id}`);
      reconcileInboxPrompts(session.id).catch((error) => {
        logger.warn("[Bot] Failed to reconcile the session inbox after reconnect:", error);
      });
    }

    const bot = this.botInstance;
    const chatId = this.chatIdInstance;
    if (!bot || !chatId) {
      return;
    }

    restorePendingInteractionsAfterReconnect(
      { ...this.deps, bot, chatId },
      serverRestarted === true,
    ).catch((error) => {
      logger.warn("[Bot] Failed to restore pending requests after event stream reconnect:", error);
    });
  }

  private getChatDestination(): TelegramDestination | null {
    if (!this.botInstance || !this.chatIdInstance) {
      return null;
    }

    return { api: this.botInstance.api, chatId: this.chatIdInstance };
  }
}
