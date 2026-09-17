import type { Bot, Context } from "grammy";
import { createEventSubscriptionService } from "../../bot/services/event-subscription-service.js";
import { keyboardManager } from "../../bot/keyboards/keyboard-manager.js";
import { pinnedMessageManager } from "../../bot/pinned/pinned-message-manager.js";
import { opencodeAutoRestartService } from "../../opencode/auto-restart.js";
import {
  opencodeReadyLifecycle,
  type OpencodeReadyHandler,
} from "../../opencode/ready-lifecycle.js";
import { logger } from "../../utils/logger.js";
import { assistantRunState } from "../managers/assistant-run-state-manager.js";
import { attachManager } from "../managers/attach-manager.js";
import { backgroundSessionTracker } from "../managers/background-session-manager.js";
import { externalUserInputSuppressionManager } from "../managers/external-input-suppression-manager.js";
import { foregroundSessionState } from "../managers/foreground-session-state-manager.js";
import {
  clearAllInteractionState,
  clearInteractionErrorState,
  interactionManager,
  type InteractionErrorScope,
} from "../managers/interaction-manager.js";
import { permissionManager } from "../managers/permission-manager.js";
import { questionManager } from "../managers/question-manager.js";
import { renameManager } from "../managers/rename-manager.js";
import { taskCreationManager } from "../managers/scheduled-task-creation-manager.js";
import { summaryAggregator } from "../managers/summary-aggregation-manager.js";
import { scheduledTaskRuntime } from "../services/scheduled-task-runtime-service.js";

const HEARTBEAT_INTERVAL_MS = 5000;
const HEARTBEAT_LOG_EVERY_TICKS = 6;

/**
 * The application's dependencies and the single owner of process-lifetime
 * runtime: the event subscription, the heartbeat and the ready-restore handler.
 * Consumers name the members they use in their own deps type.
 */
export interface AppContainer {
  readonly assistantRunState: typeof assistantRunState;
  readonly attachManager: typeof attachManager;
  readonly backgroundSessionTracker: typeof backgroundSessionTracker;
  readonly externalUserInputSuppressionManager: typeof externalUserInputSuppressionManager;
  readonly foregroundSessionState: typeof foregroundSessionState;
  readonly interactionManager: typeof interactionManager;
  readonly keyboardManager: typeof keyboardManager;
  readonly opencodeAutoRestartService: typeof opencodeAutoRestartService;
  readonly opencodeReadyLifecycle: typeof opencodeReadyLifecycle;
  readonly permissionManager: typeof permissionManager;
  readonly pinnedMessageManager: typeof pinnedMessageManager;
  readonly questionManager: typeof questionManager;
  readonly renameManager: typeof renameManager;
  readonly scheduledTaskRuntime: typeof scheduledTaskRuntime;
  readonly summaryAggregator: typeof summaryAggregator;
  readonly taskCreationManager: typeof taskCreationManager;

  ensureEventSubscription(directory: string): Promise<void>;
  setTelegramContext(bot: Bot<Context> | null, chatId: number | null): void;
  /** Replaces any running heartbeat. */
  startHeartbeat(): void;
  /** Replaces any registered ready-restore handler. */
  setReadyRestoreHandler(handler: OpencodeReadyHandler): void;

  /** Drops the open interaction and anything waiting behind it. */
  resetInteractions(reason: string): void;
  /** Drops only what a failed handler in the given scope may have left behind. */
  resetInteractionError(scope: InteractionErrorScope, reason: string): void;
  /** Clears the summary aggregator's render state. */
  resetAggregator(): void;
  /** Clears response streams, tool trackers, background tracking and run state. */
  resetRuntimeStreams(reason: string): void;
  /** Stops ready-restore, event listening and the heartbeat, and clears runtime state. */
  cleanupProcess(reason: string): void;
}

export function createAppContainer(): AppContainer {
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let unsubscribeReadyRestore: (() => void) | null = null;

  const stopHeartbeat = (): void => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  const stopReadyRestore = (): void => {
    unsubscribeReadyRestore?.();
    unsubscribeReadyRestore = null;
  };

  const container: AppContainer = {
    assistantRunState,
    attachManager,
    backgroundSessionTracker,
    externalUserInputSuppressionManager,
    foregroundSessionState,
    interactionManager,
    keyboardManager,
    opencodeAutoRestartService,
    opencodeReadyLifecycle,
    permissionManager,
    pinnedMessageManager,
    questionManager,
    renameManager,
    scheduledTaskRuntime,
    summaryAggregator,
    taskCreationManager,

    ensureEventSubscription: (directory) => eventSubscriptionService.ensureEventSubscription(directory),
    setTelegramContext: (bot, chatId) => eventSubscriptionService.setTelegramContext(bot, chatId),

    startHeartbeat: () => {
      stopHeartbeat();
      let heartbeatCounter = 0;
      heartbeatTimer = setInterval(() => {
        heartbeatCounter++;
        if (heartbeatCounter % HEARTBEAT_LOG_EVERY_TICKS === 0) {
          logger.debug(`[Bot] Heartbeat #${heartbeatCounter} - event loop alive`);
        }
      }, HEARTBEAT_INTERVAL_MS);
    },

    setReadyRestoreHandler: (handler) => {
      stopReadyRestore();
      unsubscribeReadyRestore = opencodeReadyLifecycle.onReady(handler);
    },

    resetInteractions: (reason) => clearAllInteractionState(reason),
    resetInteractionError: (scope, reason) => clearInteractionErrorState(scope, reason),
    resetAggregator: () => summaryAggregator.clear(),
    resetRuntimeStreams: (reason) => eventSubscriptionService.clearRuntimeState(reason),

    cleanupProcess: (reason) => {
      stopReadyRestore();
      eventSubscriptionService.cleanup(reason);
      stopHeartbeat();
    },
  };

  const eventSubscriptionService = createEventSubscriptionService(container);

  return container;
}
