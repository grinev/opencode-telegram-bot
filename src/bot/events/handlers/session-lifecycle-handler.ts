import { t } from "../../../i18n/index.js";
import { logger } from "../../../utils/logger.js";
import { markAttachedSessionIdle } from "../../../app/services/attach-service.js";
import { getCurrentSession } from "../../../app/services/session-service.js";
import { shouldSuppressUserAbortSessionError } from "../../../app/managers/abort-suppression-manager.js";
import { clearPromptResponseMode } from "../../handlers/prompt.js";
import { dispatchNextQueuedPrompt } from "../../handlers/prompt-queue-dispatch.js";
import { wakePromptHandover } from "../../handlers/prompt-handover.js";
import { resetStreamThrottle } from "../../streaming/stream-throttle.js";
import { buildFailedToolEvent } from "../failed-tool-event.js";
import {
  formatSessionMessage,
  isCompactProgressMode,
  type EventHandlerDeps,
} from "./handler-context.js";
import { closeForegroundRun } from "./run-close.js";

const SESSION_RETRY_PREFIX = "🔁";

type SessionLifecycleDeps = EventHandlerDeps<
  | "assistantRunState"
  | "attachManager"
  | "foregroundSessionState"
  | "goalService"
  | "keyboardManager"
  | "scheduledTaskRuntime"
  | "summaryAggregator"
>;

/**
 * OpenCode V1 stops a run without ending its running calls: each foreground one ends here
 * as OpenCode V2 ends it, failed, so its line drops the running mark. Background calls stay.
 */
function endRunningForegroundCalls(
  { runtime, summaryAggregator }: SessionLifecycleDeps,
  sessionId: string,
): void {
  const now = Date.now();
  for (const tool of runtime.getRunningToolInfos(sessionId)) {
    if (!runtime.runningToolTracker.isBackground(tool.callId)) {
      summaryAggregator.processEvent(buildFailedToolEvent(tool, now));
    }
  }
}

/** Session idle, error and retry. */
export function registerSessionLifecycleHandlers(deps: SessionLifecycleDeps): void {
  const { runtime, policy, summaryAggregator } = deps;

  summaryAggregator.setOnSessionIdle(async (sessionId, { interrupted, reason }) => {
    wakePromptHandover(sessionId);
    resetStreamThrottle(sessionId);
    await markAttachedSessionIdle(sessionId, deps);
    // Dropped immediately when this session is no longer current: the early
    // returns below would otherwise leave a compact-progress timer armed.
    // A still-current session keeps the card until after in-flight completion
    // work, then finalizes it (delete or finished summary).
    const canFinalizeCompactProgress =
      Boolean(policy.getDestination(sessionId)) && policy.isForegroundSession(sessionId);
    // Background operations outlive the turn only in the session the user follows.
    if (!canFinalizeCompactProgress) {
      runtime.stopBackgroundOperations("session_idle", sessionId);
    }
    runtime.clearToolTracking(sessionId, "session_idle", canFinalizeCompactProgress);
    if (!canFinalizeCompactProgress) {
      runtime.compactProgressStreamer.clearSession(sessionId, "session_idle");
    }
    await runtime.getCompletionTask(sessionId)?.catch(() => undefined);

    // A server stop sends no footer even if this idle arrives before the reconnect clear.
    // A reject or a cancelled question shares this idle with a client stop and stays footerless.
    // An observed turn that never completed still ends like an abort. A completed one keeps
    // its run so the footer can name the interruption.
    if (interrupted && reason === "shutdown") {
      deps.assistantRunState.clearRun(sessionId, "session_shutdown");
    } else if (deps.assistantRunState.isFooterSuppressed(sessionId)) {
      deps.assistantRunState.clearRun(sessionId, "session_footer_suppressed");
    } else if (
      interrupted &&
      deps.assistantRunState.hasRun(sessionId) &&
      !deps.assistantRunState.hasBotRun(sessionId) &&
      !deps.assistantRunState.isResponseCompleted(sessionId)
    ) {
      deps.assistantRunState.clearRun(sessionId, "session_interrupted");
    } else if (interrupted && deps.assistantRunState.isResponseCompleted(sessionId)) {
      deps.assistantRunState.markInterrupted(sessionId);
    }

    const completedRun = deps.assistantRunState.isResponseCompleted(sessionId)
      ? deps.assistantRunState.finishRun(sessionId, "session_idle")
      : null;
    clearPromptResponseMode(sessionId);

    const destination = policy.getDestination(sessionId);
    if (!destination) {
      runtime.compactProgressStreamer.clearSession(sessionId, "session_idle");
      deps.foregroundSessionState.markIdle(sessionId);
      return;
    }

    if (!policy.isForegroundSession(sessionId)) {
      runtime.compactProgressStreamer.clearSession(sessionId, "session_idle");
      deps.foregroundSessionState.markIdle(sessionId);
      await deps.scheduledTaskRuntime.flushDeferredDeliveries();
      return;
    }

    try {
      await closeForegroundRun(deps, sessionId, destination, completedRun, "session_idle");
    } catch (err) {
      logger.error("[Bot] Failed to send session idle footer:", err);
    } finally {
      deps.foregroundSessionState.markIdle(sessionId);
      await deps.scheduledTaskRuntime.flushDeferredDeliveries();
      void dispatchNextQueuedPrompt();
      const followed = getCurrentSession();
      if (followed?.id === sessionId) {
        void deps.goalService.refresh(sessionId, followed.directory, true);
      }
    }
  });

  summaryAggregator.setOnSessionError(async (sessionId, message, { interrupted }) => {
    if (interrupted) {
      endRunningForegroundCalls(deps, sessionId);
    }
    wakePromptHandover(sessionId);
    await markAttachedSessionIdle(sessionId, deps);
    const destination = policy.getDestination(sessionId);
    const keepBackground = Boolean(destination) && policy.isForegroundSession(sessionId);
    if (!keepBackground) {
      runtime.stopBackgroundOperations("session_error", sessionId);
    }
    runtime.clearToolTracking(sessionId, "session_error", keepBackground);

    if (!destination) {
      clearPromptResponseMode(sessionId);
      runtime.compactProgressStreamer.clearSession(sessionId, "session_error_no_bot_context");
      deps.assistantRunState.clearRun(sessionId, "session_error_no_bot_context");
      deps.foregroundSessionState.markIdle(sessionId);
      return;
    }

    if (!policy.isForegroundSession(sessionId)) {
      clearPromptResponseMode(sessionId);
      runtime.clearAssistantResponseSession(sessionId, "session_error_not_current");
      runtime.toolCallStreamer.clearSession(sessionId, "session_error_not_current");
      runtime.compactProgressStreamer.clearSession(sessionId, "session_error_not_current");
      deps.assistantRunState.clearRun(sessionId, "session_error_not_current");
      deps.foregroundSessionState.markIdle(sessionId);
      await deps.scheduledTaskRuntime.flushDeferredDeliveries();
      return;
    }

    runtime.clearAssistantResponseSession(sessionId, "session_error");
    // Parked cards keep counting their background operations, as their full-mode lines do.
    runtime.compactProgressStreamer.discardOpenCard(sessionId, "session_error");
    clearPromptResponseMode(sessionId);
    deps.assistantRunState.clearRun(sessionId, "session_error");
    await Promise.all([
      runtime.toolMessageBatcher.flushSession(sessionId, "session_error"),
      runtime.toolCallStreamer.breakSession(sessionId, "session_error"),
    ]);

    const normalizedMessage = message.trim() || t("common.unknown_error");
    if (shouldSuppressUserAbortSessionError(sessionId, normalizedMessage)) {
      logger.debug(`[Bot] Suppressed user-initiated abort error: session=${sessionId}`);
      deps.foregroundSessionState.markIdle(sessionId);
      await deps.scheduledTaskRuntime.flushDeferredDeliveries();
      return;
    }

    await runtime.delivery
      .sendText(
        destination,
        t("bot.session_error", { message: formatSessionMessage(normalizedMessage) }),
      )
      .catch((err) => {
        logger.error("[Bot] Failed to send session.error message:", err);
      });

    deps.foregroundSessionState.markIdle(sessionId);
    await deps.scheduledTaskRuntime.flushDeferredDeliveries();
    void dispatchNextQueuedPrompt();
  });

  summaryAggregator.setOnSessionRetry(async ({ sessionId, message }) => {
    if (!policy.getDestination(sessionId) || !policy.isForegroundSession(sessionId)) {
      return;
    }

    if (isCompactProgressMode()) {
      runtime.compactProgressStreamer.updateActivity(sessionId, t("progress.compact.retrying"));
      return;
    }

    const retryMessage = t("bot.session_retry", { message: formatSessionMessage(message) });
    runtime.toolCallStreamer.replaceByPrefix(sessionId, SESSION_RETRY_PREFIX, retryMessage);
  });
}
