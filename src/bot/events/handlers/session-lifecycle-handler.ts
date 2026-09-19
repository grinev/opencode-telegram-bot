import { t } from "../../../i18n/index.js";
import { logger } from "../../../utils/logger.js";
import {
  getDeleteCompactProgressOnFinish,
  getShowAssistantRunFooter,
} from "../../../app/stores/settings-store.js";
import { markAttachedSessionIdle } from "../../../app/services/attach-service.js";
import { shouldSuppressUserAbortSessionError } from "../../../app/managers/abort-suppression-manager.js";
import { formatAssistantRunFooter } from "../../../app/formatters/assistant-run-footer-formatter.js";
import { clearPromptResponseMode } from "../../handlers/prompt.js";
import { dispatchNextQueuedPrompt } from "../../handlers/prompt-queue-dispatch.js";
import { resetStreamThrottle } from "../../streaming/stream-throttle.js";
import {
  formatSessionMessage,
  getReplyKeyboard,
  isCompactProgressMode,
  type EventHandlerDeps,
} from "./handler-context.js";

const SESSION_RETRY_PREFIX = "🔁";

type SessionLifecycleDeps = EventHandlerDeps<
  | "assistantRunState"
  | "attachManager"
  | "foregroundSessionState"
  | "keyboardManager"
  | "scheduledTaskRuntime"
  | "summaryAggregator"
>;

/** Session idle, error and retry. */
export function registerSessionLifecycleHandlers(deps: SessionLifecycleDeps): void {
  const { runtime, policy, summaryAggregator } = deps;

  summaryAggregator.setOnSessionIdle(async (sessionId) => {
    resetStreamThrottle(sessionId);
    await markAttachedSessionIdle(sessionId, deps);
    // Dropped immediately when this session is no longer current: the early
    // returns below would otherwise leave a compact-progress timer armed.
    // A still-current session keeps the card until after in-flight completion
    // work, then finalizes it (delete or finished summary).
    runtime.clearToolTracking(sessionId, "session_idle");
    const canFinalizeCompactProgress =
      Boolean(policy.getDestination(sessionId)) && policy.isForegroundSession(sessionId);
    if (!canFinalizeCompactProgress) {
      runtime.compactProgressStreamer.clearSession(sessionId, "session_idle");
    }
    await runtime.getCompletionTask(sessionId)?.catch(() => undefined);

    const completedRun = deps.assistantRunState.finishRun(sessionId, "session_idle");
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
      await Promise.all([
        runtime.toolMessageBatcher.flushSession(sessionId, "session_idle"),
        runtime.toolCallStreamer.breakSession(sessionId, "session_idle"),
      ]);

      await runtime.compactProgressStreamer.finalize(sessionId, getDeleteCompactProgressOnFinish());

      if (getShowAssistantRunFooter() && completedRun?.hasCompletedResponse) {
        const agent = completedRun.actualAgent || completedRun.configuredAgent;
        const providerID = completedRun.actualProviderID || completedRun.configuredProviderID;
        const modelID = completedRun.actualModelID || completedRun.configuredModelID;

        if (agent && providerID && modelID) {
          const keyboard = getReplyKeyboard(deps);
          await runtime.delivery.sendText(
            destination,
            formatAssistantRunFooter({
              agent,
              providerID,
              modelID,
              elapsedMs: Date.now() - completedRun.startedAt,
            }),
            {
              ...(keyboard ? { reply_markup: keyboard } : {}),
            },
          );
        }
      }
    } catch (err) {
      logger.error("[Bot] Failed to send session idle footer:", err);
    } finally {
      deps.foregroundSessionState.markIdle(sessionId);
      await deps.scheduledTaskRuntime.flushDeferredDeliveries();
      void dispatchNextQueuedPrompt();
    }
  });

  summaryAggregator.setOnSessionError(async (sessionId, message) => {
    await markAttachedSessionIdle(sessionId, deps);
    runtime.clearToolTracking(sessionId, "session_error");

    const destination = policy.getDestination(sessionId);
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
    runtime.compactProgressStreamer.clearSession(sessionId, "session_error");
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
