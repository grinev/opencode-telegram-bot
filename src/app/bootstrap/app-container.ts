import type { Bot, Context } from "grammy";
import { createEventSubscriptionService } from "../../bot/services/event-subscription-service.js";
import { KeyboardManager } from "../../bot/keyboards/keyboard-manager.js";
import { PinnedMessageManager } from "../../bot/pinned/pinned-message-manager.js";
import { OpencodeAutoRestartService } from "../../opencode/auto-restart.js";
import {
  OpencodeReadyLifecycle,
  type OpencodeReadyHandler,
} from "../../opencode/ready-lifecycle.js";
import { logger } from "../../utils/logger.js";
import { AssistantRunState } from "../managers/assistant-run-state-manager.js";
import { AttachManager } from "../managers/attach-manager.js";
import { BackgroundSessionTracker } from "../managers/background-session-manager.js";
import { ExternalUserInputSuppressionManager } from "../managers/external-input-suppression-manager.js";
import { ForegroundSessionState } from "../managers/foreground-session-state-manager.js";
import { InteractionManager, type InteractionErrorScope } from "../managers/interaction-manager.js";
import { PermissionManager } from "../managers/permission-manager.js";
import { QuestionManager } from "../managers/question-manager.js";
import { RenameManager } from "../managers/rename-manager.js";
import { TaskCreationManager } from "../managers/scheduled-task-creation-manager.js";
import { SummaryAggregator } from "../managers/summary-aggregation-manager.js";
import { ScheduledTaskRuntime } from "../services/scheduled-task-runtime-service.js";

const HEARTBEAT_INTERVAL_MS = 5000;
const HEARTBEAT_LOG_EVERY_TICKS = 6;

/**
 * The application's dependencies and the single owner of process-lifetime
 * runtime: the event subscription, the heartbeat and the ready-restore handler.
 * It constructs every manager once; reset members delegate to them, and the
 * state logic lives on the managers. Consumers name the members they use in
 * their own deps type.
 */
export interface AppContainer {
  readonly assistantRunState: AssistantRunState;
  readonly attachManager: AttachManager;
  readonly backgroundSessionTracker: BackgroundSessionTracker;
  readonly externalUserInputSuppressionManager: ExternalUserInputSuppressionManager;
  readonly foregroundSessionState: ForegroundSessionState;
  readonly interactionManager: InteractionManager;
  readonly keyboardManager: KeyboardManager;
  readonly opencodeAutoRestartService: OpencodeAutoRestartService;
  readonly opencodeReadyLifecycle: OpencodeReadyLifecycle;
  readonly permissionManager: PermissionManager;
  readonly pinnedMessageManager: PinnedMessageManager;
  readonly questionManager: QuestionManager;
  readonly renameManager: RenameManager;
  readonly scheduledTaskRuntime: ScheduledTaskRuntime;
  readonly summaryAggregator: SummaryAggregator;
  readonly taskCreationManager: TaskCreationManager;

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
  const foregroundSessionState = new ForegroundSessionState();
  const interactionManager = new InteractionManager();
  const opencodeReadyLifecycle = new OpencodeReadyLifecycle();
  const summaryAggregator = new SummaryAggregator();

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
    assistantRunState: new AssistantRunState(),
    attachManager: new AttachManager(),
    backgroundSessionTracker: new BackgroundSessionTracker(),
    externalUserInputSuppressionManager: new ExternalUserInputSuppressionManager(),
    foregroundSessionState,
    interactionManager,
    keyboardManager: new KeyboardManager(),
    opencodeAutoRestartService: new OpencodeAutoRestartService(opencodeReadyLifecycle),
    opencodeReadyLifecycle,
    permissionManager: new PermissionManager(interactionManager),
    pinnedMessageManager: new PinnedMessageManager(),
    questionManager: new QuestionManager(interactionManager),
    renameManager: new RenameManager(interactionManager),
    scheduledTaskRuntime: new ScheduledTaskRuntime(foregroundSessionState),
    summaryAggregator,
    taskCreationManager: new TaskCreationManager(interactionManager),

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

    resetInteractions: (reason) => interactionManager.reset(reason),
    resetInteractionError: (scope, reason) => interactionManager.clearErrorScope(scope, reason),
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
