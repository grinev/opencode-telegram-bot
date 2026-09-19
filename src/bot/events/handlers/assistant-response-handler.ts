import { logger } from "../../../utils/logger.js";
import {
  getShowAssistantRunFooter,
  getShowThinkingContent,
} from "../../../app/stores/settings-store.js";
import { clearPromptResponseMode } from "../../handlers/prompt.js";
import { finalizeAssistantResponse } from "../../streaming/finalize-assistant-response.js";
import { sendTtsResponseForSession } from "../../handlers/tts-response-handler.js";
import { deliverThinkingMessage } from "../../messages/thinking-message.js";
import {
  prepareAssistantFinalStreamingPayload,
  prepareAssistantStreamingPayload,
  renderAssistantFinalPartsSafe,
} from "../../messages/assistant-rendering.js";
import { prepareThinkingPayload } from "../../messages/thinking-rendering.js";
import { deliverExternalUserInputNotification } from "../../messages/external-user-input-notification.js";
import { telegramOutageNoticeService } from "../../../app/services/telegram-outage-notice-service.js";
import { flushTelegramOutageNotices } from "../../telegram-outage-notices.js";
import { getThinkingStreamId } from "../session-runtime-state.js";
import {
  getReplyKeyboard,
  isCompactProgressMode,
  type EventHandlerBase,
  type EventHandlerDeps,
} from "./handler-context.js";

type AssistantResponseDeps = EventHandlerDeps<
  | "assistantRunState"
  | "externalUserInputSuppressionManager"
  | "foregroundSessionState"
  | "keyboardManager"
  | "pinnedMessageManager"
  | "scheduledTaskRuntime"
  | "summaryAggregator"
>;

async function completeThinkingStream(
  { runtime, policy }: EventHandlerBase,
  sessionId: string,
  messageId: string,
): Promise<void> {
  const sections = runtime.getThinkingSections(sessionId, messageId);
  // Re-render from the sections: the streamed payload keeps its trailing
  // block literal because it was still being written.
  const finalPayload = sections
    ? (prepareThinkingPayload(sections, { final: true }) ?? undefined)
    : undefined;
  if (finalPayload) {
    finalPayload.sendOptions = { disable_notification: true };
  }
  const result = await runtime.thinkingStreamer.complete(
    sessionId,
    getThinkingStreamId(messageId),
    finalPayload,
  );
  runtime.deleteThinkingSections(sessionId, messageId);

  if (result.streamed || !finalPayload) {
    return;
  }

  const destination = policy.getDestination(sessionId);
  if (!destination) {
    return;
  }

  for (const part of finalPayload.parts) {
    await runtime.delivery.sendRenderedPart(destination, part, finalPayload.sendOptions);
  }
}

/** Streamed replies, their completion, thinking and external user input. */
export function registerAssistantResponseHandlers(deps: AssistantResponseDeps): void {
  const { runtime, policy, summaryAggregator } = deps;

  summaryAggregator.setOnPartial((sessionId, messageId, messageText) => {
    if (!policy.getDestination(sessionId) || !policy.isForegroundSession(sessionId)) {
      return;
    }

    if (isCompactProgressMode() && !runtime.runningToolTracker.newestCallId(sessionId)) {
      runtime.compactProgressStreamer.updateResponding(sessionId);
    }

    const preparedStreamPayload = prepareAssistantStreamingPayload(messageText);
    if (!preparedStreamPayload) {
      return;
    }

    preparedStreamPayload.sendOptions = { disable_notification: true };
    preparedStreamPayload.editOptions = undefined;

    runtime.enqueueAssistantResponse(sessionId, messageId, preparedStreamPayload);
  });

  summaryAggregator.setOnComplete((sessionId, messageId, messageText, completionInfo) => {
    void runtime.enqueueCompletionTask(sessionId, async () => {
      const dropSessionOutput = (reason: string): void => {
        clearPromptResponseMode(sessionId);
        runtime.clearAssistantResponse(sessionId, messageId, reason);
        runtime.clearThinking(sessionId, messageId, reason);
        runtime.toolCallStreamer.clearSession(sessionId, reason);
        runtime.compactProgressStreamer.clearSession(sessionId, reason);
        runtime.clearToolTracking(sessionId, reason);
        deps.assistantRunState.clearRun(sessionId, reason);
        deps.foregroundSessionState.markIdle(sessionId);
      };

      const destination = policy.getDestination(sessionId);
      if (!destination) {
        logger.error("Bot or chat ID not available for sending message");
        dropSessionOutput("bot_context_missing");
        return;
      }

      if (!policy.isForegroundSession(sessionId)) {
        dropSessionOutput("session_mismatch");
        await deps.scheduledTaskRuntime.flushDeferredDeliveries();
        return;
      }

      try {
        deps.assistantRunState.markResponseCompleted(sessionId, {
          agent: completionInfo.agent,
          providerID: completionInfo.providerID,
          modelID: completionInfo.modelID,
        });

        await completeThinkingStream(deps, sessionId, messageId);

        const assistantResponseMode = runtime.getAssistantStreamMode(sessionId, messageId);

        await finalizeAssistantResponse({
          sessionId,
          messageId,
          messageText,
          responseStreamer: {
            complete: (completeSessionId, completeMessageId, payload, options) =>
              runtime.completeAssistantResponse(
                completeSessionId,
                completeMessageId,
                payload,
                options,
              ),
          },
          flushPendingServiceMessages: () => {
            runtime.clearToolTracking(sessionId, "assistant_message_completed");

            return Promise.all([
              runtime.toolMessageBatcher.flushSession(sessionId, "assistant_message_completed"),
              runtime.toolCallStreamer.breakSession(sessionId, "assistant_message_completed"),
            ]).then(() => undefined);
          },
          prepareStreamingPayload: prepareAssistantFinalStreamingPayload,
          renderFinalParts: (text) => renderAssistantFinalPartsSafe(text),
          getReplyKeyboard: () => getReplyKeyboard(deps),
          notifyFirstFinalPart: assistantResponseMode === "draft" && !getShowAssistantRunFooter(),
          sendRenderedPart: async (part, options) => {
            await runtime.delivery.sendRenderedPart(
              destination,
              part,
              options as Parameters<typeof runtime.delivery.sendRenderedPart>[2],
            );
          },
        });

        await sendTtsResponseForSession({
          api: destination.api,
          sessionId,
          chatId: destination.chatId,
          text: messageText,
        });
      } catch (err) {
        dropSessionOutput("assistant_finalize_failed");
        logger.error("Failed to send message to Telegram:", err);
        logger.error(`[Bot] Dropped the assistant response for session ${sessionId}`);
        telegramOutageNoticeService.markAssistantReplyUndelivered();
        await flushTelegramOutageNotices({
          api: destination.api,
          chatId: destination.chatId,
        });
      } finally {
        await deps.scheduledTaskRuntime.flushDeferredDeliveries();
      }
    });
  });

  summaryAggregator.setOnExternalUserInput(async (sessionId, _messageId, messageText) => {
    void runtime.enqueueCompletionTask(sessionId, async () => {
      const destination = policy.getDestination(sessionId);
      if (!destination) {
        return;
      }

      try {
        await deliverExternalUserInputNotification({
          api: destination.api,
          chatId: destination.chatId,
          isForegroundSession: policy.isForegroundSession(sessionId),
          sessionId,
          text: messageText,
          consumeSuppressedInput: (incomingSessionId, incomingText) =>
            deps.externalUserInputSuppressionManager.consume(incomingSessionId, incomingText),
        });
      } catch (err) {
        logger.error("[Bot] Failed to deliver external user input to Telegram:", err);
      }
    });
  });

  summaryAggregator.setOnThinking(async (update) => {
    if (!policy.getDestination(update.sessionId) || !policy.isForegroundSession(update.sessionId)) {
      return;
    }

    logger.debug("[Bot] Agent thinking update", {
      sessionId: update.sessionId,
      messageId: update.messageId,
      sectionCount: update.sections.length,
      isFirstUpdate: update.isFirstUpdate,
    });

    if (isCompactProgressMode()) {
      if (!runtime.runningToolTracker.newestCallId(update.sessionId)) {
        runtime.compactProgressStreamer.updateThinking(update.sessionId);
      }

      if (update.isFirstUpdate && deps.pinnedMessageManager.isInitialized()) {
        await deps.pinnedMessageManager.refresh();
      }
      return;
    }

    if (update.isFirstUpdate) {
      runtime.clearToolTracking(update.sessionId, "thinking_started");
      void runtime.toolCallStreamer
        .breakSession(update.sessionId, "thinking_started")
        .catch((error) => {
          logger.error("[Bot] Failed to break tool stream before thinking message", error);
        });
    }

    if (getShowThinkingContent()) {
      const payload = prepareThinkingPayload(update.sections);
      if (payload) {
        payload.sendOptions = { disable_notification: true };
        payload.editOptions = undefined;

        runtime.setThinkingSections(update.sessionId, update.messageId, update.sections);
        runtime.thinkingStreamer.enqueue(
          update.sessionId,
          getThinkingStreamId(update.messageId),
          payload,
        );
      }
    } else if (update.isFirstUpdate) {
      deliverThinkingMessage(update.sessionId, runtime.toolMessageBatcher);
    }

    if (update.isFirstUpdate && deps.pinnedMessageManager.isInitialized()) {
      await deps.pinnedMessageManager.refresh();
    }
  });

  summaryAggregator.setOnThinkingFinished((sessionId, messageId) => {
    if (!policy.getDestination(sessionId) || !policy.isForegroundSession(sessionId)) {
      return;
    }

    logger.debug("[Bot] Agent thinking finished", { sessionId, messageId });
    void completeThinkingStream(deps, sessionId, messageId).catch((error) => {
      logger.error("[Bot] Failed to finalize thinking stream early", error);
    });
  });
}
