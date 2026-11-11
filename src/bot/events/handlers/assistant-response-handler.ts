import { logger } from "../../../utils/logger.js";
import {
  getDeleteCompactProgressOnFinish,
  getShowAssistantRunFooter,
  getShowThinkingContent,
} from "../../../app/stores/settings-store.js";
import { clearPromptResponseMode, startInboxPromptRun } from "../../handlers/prompt.js";
import { promptQueue, type QueuedPrompt } from "../../../app/managers/prompt-queue-manager.js";
import { promptHandover } from "../../../app/managers/prompt-handover-manager.js";
import { buildExternalUserInputNotification } from "../../../app/services/external-user-input-service.js";
import { getCurrentSession } from "../../../app/services/session-service.js";
import { markSessionReplyRead } from "../../../app/services/session-reply-read-service.js";
import { sendBotText } from "../../messages/telegram-text.js";
import { closeForegroundRun } from "./run-close.js";
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
import { getThinkingStreamId, type SessionRuntimeState } from "../session-runtime-state.js";
import type { StreamingMessagePayload } from "../../streaming/response-streamer.js";
import {
  getReplyKeyboard,
  isCompactProgressMode,
  type EventHandlerBase,
  type EventHandlerDeps,
} from "./handler-context.js";

type KeepAssistantDraftsDeps = EventHandlerDeps<"keyboardManager">;

type AssistantResponseDeps = EventHandlerDeps<
  | "assistantRunState"
  | "attachManager"
  | "externalUserInputSuppressionManager"
  | "foregroundSessionState"
  | "keyboardManager"
  | "pinnedMessageManager"
  | "scheduledTaskRuntime"
  | "summaryAggregator"
>;

/**
 * OpenCode picked up a prompt the bot sent into the session inbox: its button is already
 * gone, the quote is sent with the refreshed keyboard. A queued prompt is picked up only
 * once the turn has answered, inside the same execution, so it closes that run and opens
 * its own - as a prompt queued in the bot does.
 */
async function pickUpInboxPrompt(
  deps: AssistantResponseDeps,
  sessionId: string,
  item: QueuedPrompt,
): Promise<void> {
  const { policy } = deps;
  const destination = policy.getDestination(sessionId);
  if (!destination || !policy.isForegroundSession(sessionId)) {
    return;
  }

  logger.info(
    `[PromptQueue] Inbox prompt picked up: inboxId=${item.inbox?.inboxId}, delivery=${item.inbox?.delivery}`,
  );

  try {
    if (item.inbox?.delivery === "queue" && deps.assistantRunState.hasRun(sessionId)) {
      deps.assistantRunState.sealRun(sessionId);
      const completedRun = deps.assistantRunState.finishRun(sessionId, "inbox_queue_pickup");
      clearPromptResponseMode(sessionId);
      await closeForegroundRun(deps, sessionId, destination, completedRun, "inbox_queue_pickup");
    }

    if (!deps.assistantRunState.hasBotRun(sessionId)) {
      const session = getCurrentSession();
      if (session?.id === sessionId) {
        await startInboxPromptRun(session, deps, item.responseMode);
      }
    }
  } catch (err) {
    logger.error("[PromptQueue] Failed to switch runs on inbox pickup:", err);
  }

  const notification = buildExternalUserInputNotification(item.displayText);
  if (!notification) {
    return;
  }

  try {
    const keyboard = getReplyKeyboard(deps);
    await sendBotText({
      api: destination.api,
      chatId: destination.chatId,
      text: notification.text,
      rawFallbackText: notification.rawFallbackText,
      format: "markdown_v2",
      options: keyboard ? { reply_markup: keyboard } : {},
    });
  } catch (err) {
    logger.error("[PromptQueue] Failed to echo picked up inbox prompt:", err);
  }
}

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

/**
 * Sends the drafted text of a session's replies as real messages before a
 * question or permission prompt: a draft vanishes once the bot sends anything
 * else, and the reply's own completion waits for the prompt to be answered.
 */
export function keepAssistantDraftsBeforePrompt(
  deps: KeepAssistantDraftsDeps,
  sessionId: string,
): Promise<void> {
  const { runtime, policy } = deps;

  return runtime.enqueueCompletionTask(sessionId, async () => {
    const destination = policy.getDestination(sessionId);
    if (!destination || !policy.isForegroundSession(sessionId)) {
      return;
    }

    if (isCompactProgressMode()) {
      await runtime.compactProgressStreamer.flushPending(sessionId);
    }

    for (const { messageId, text } of runtime.getUndeliveredAssistantDrafts(sessionId)) {
      const undeliveredText = runtime.stripDeliveredAssistantText(sessionId, messageId, text);
      // Marked before the send: a partial landing meanwhile must not start a
      // fresh draft of the same text, which completion would send again.
      const previousDeliveredText = runtime.markAssistantTextDelivered(sessionId, messageId, text);
      try {
        await finalizeAssistantResponse({
          sessionId,
          messageId,
          messageText: undeliveredText,
          responseStreamer: {
            complete: (completeSessionId, completeMessageId, payload, options) =>
              runtime.completeAssistantDraftEarly(
                completeSessionId,
                completeMessageId,
                payload,
                options,
              ),
          },
          // The prompt flushes tool output itself before showing up.
          flushPendingServiceMessages: async () => {},
          prepareStreamingPayload: prepareAssistantFinalStreamingPayload,
          renderFinalParts: (partText) => renderAssistantFinalPartsSafe(partText),
          getReplyKeyboard: () => getReplyKeyboard(deps),
          sendRenderedPart: async (part, options) => {
            await runtime.delivery.sendRenderedPart(
              destination,
              part,
              options as Parameters<typeof runtime.delivery.sendRenderedPart>[2],
            );
          },
        });
        logger.debug(
          `[Bot] Kept assistant draft before a prompt: session=${sessionId}, message=${messageId}`,
        );
        if (isCompactProgressMode()) {
          await runtime.compactProgressStreamer.finalize(
            sessionId,
            getDeleteCompactProgressOnFinish(),
          );
        }
      } catch (error) {
        runtime.markAssistantTextDelivered(sessionId, messageId, previousDeliveredText);
        logger.error(
          `[Bot] Failed to keep assistant draft before a prompt: session=${sessionId}, message=${messageId}`,
          error,
        );
      }
    }
  });
}

function enqueueAssistantReply(
  runtime: SessionRuntimeState,
  sessionId: string,
  messageId: string,
  payload: StreamingMessagePayload,
): void {
  const enqueue = (): void => {
    runtime.enqueueAssistantResponse(sessionId, messageId, payload);
  };

  if (!isCompactProgressMode()) {
    enqueue();
    return;
  }

  if (runtime.isAssistantCompletionStarted(sessionId, messageId)) {
    return;
  }

  const streamer = runtime.compactProgressStreamer;
  if (streamer.isHolding(sessionId)) {
    void runtime.enqueueCompletionTask(sessionId, async () => {
      if (runtime.isAssistantCompletionStarted(sessionId, messageId)) {
        return;
      }
      await streamer.flushPending(sessionId);
      enqueue();
    });
    return;
  }

  if (streamer.hasPendingSend(sessionId)) {
    const deferral = streamer.flushPending(sessionId).then(() => {
      if (runtime.isAssistantCompletionStarted(sessionId, messageId)) {
        return;
      }
      enqueue();
    });
    runtime.setReplyEnqueueDeferral(sessionId, deferral);
    return;
  }

  enqueue();
}

/**
 * The first text of an `edit` reply divides what the agent did before it from what
 * it does next: the latter goes below the reply.
 */
function beginEditReply(runtime: SessionRuntimeState, sessionId: string, messageId: string): void {
  if (
    runtime.getAssistantStreamMode(sessionId, messageId) !== "edit" ||
    runtime.isReplyBegun(sessionId, messageId)
  ) {
    return;
  }

  runtime.markReplyBegun(sessionId, messageId);
  if (isCompactProgressMode()) {
    runtime.markCompactCloseDue(sessionId, messageId);
  } else {
    runtime.startReplyCut(sessionId);
  }
}

/**
 * Compact mode: the first activity after a reply's text closes the card above the
 * reply, once the reply is out, and opens a new card below it.
 */
export function closeCompactCardBeforeNextActivity(
  runtime: SessionRuntimeState,
  sessionId: string,
): void {
  const streamer = runtime.compactProgressStreamer;
  // A close already under way replays this activity into the next card itself.
  if (streamer.isHolding(sessionId) || runtime.takeCompactCloseDue(sessionId) === undefined) {
    return;
  }

  const letOutReply = runtime.takeReplyGate(sessionId);
  streamer.holdForClose(sessionId);
  void runtime.enqueueCompletionTask(sessionId, async () => {
    try {
      await letOutReply?.();
      await streamer.finalize(sessionId, getDeleteCompactProgressOnFinish());
    } catch (error) {
      streamer.releaseHold(sessionId);
      logger.error(
        `[Bot] Failed to close the progress card after a reply: session=${sessionId}`,
        error,
      );
    }
  });
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

    runtime.recordAssistantText(sessionId, messageId, messageText);
    const preparedStreamPayload = prepareAssistantStreamingPayload(
      runtime.stripDeliveredAssistantText(sessionId, messageId, messageText),
    );
    if (!preparedStreamPayload) {
      return;
    }

    preparedStreamPayload.sendOptions = { disable_notification: true };
    preparedStreamPayload.editOptions = undefined;

    beginEditReply(runtime, sessionId, messageId);
    enqueueAssistantReply(runtime, sessionId, messageId, preparedStreamPayload);
  });

  summaryAggregator.setOnAssistantStep((sessionId, step) => {
    deps.assistantRunState.recordStep(sessionId, step);
  });

  summaryAggregator.setOnSessionBoundary((sessionId, messageId) => {
    if (messageId) {
      const mirrored = promptQueue.findByInboxId(messageId);
      if (mirrored?.inbox?.delivery !== "queue") {
        return;
      }
    }
    deps.assistantRunState.sealRun(sessionId);
  });

  summaryAggregator.setOnComplete((sessionId, messageId, messageText, completionInfo) => {
    // Its card closed when the next activity came: the open card is below this reply.
    const compactCardClosed = runtime.takeCompactClosedForReply(sessionId, messageId);
    if (
      isCompactProgressMode() &&
      policy.getDestination(sessionId) &&
      policy.isForegroundSession(sessionId)
    ) {
      runtime.markAssistantCompletionStarted(sessionId, messageId);
      if (
        !compactCardClosed &&
        runtime.stripDeliveredAssistantText(sessionId, messageId, messageText).trim()
      ) {
        runtime.compactProgressStreamer.holdForClose(sessionId);
      }
    }

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
        // A turn the bot did not start gets its run from its first reply, timed from the turn's
        // start; a turn already over (aborted, errored, idle) opens none.
        const turnStartedAt = summaryAggregator.getLiveTurnStartedAt(sessionId);
        if (turnStartedAt !== null) {
          deps.assistantRunState.startObservedRun(sessionId, turnStartedAt);
        }
        deps.assistantRunState.markResponseCompleted(sessionId, {
          agent: completionInfo.agent,
          providerID: completionInfo.providerID,
          modelID: completionInfo.modelID,
        });

        await completeThinkingStream(deps, sessionId, messageId);

        const assistantResponseMode = runtime.getAssistantStreamMode(sessionId, messageId);

        // Tool output that started after this reply's text waits below it.
        if (
          assistantResponseMode === "edit" &&
          runtime.toolCallStreamer.hasUnsentMessages(sessionId)
        ) {
          await runtime.letOutReplies(sessionId);
        }

        const remainingText = runtime.stripDeliveredAssistantText(
          sessionId,
          messageId,
          messageText,
        );
        const closesCompactCard =
          isCompactProgressMode() && !compactCardClosed && Boolean(remainingText.trim());
        if (closesCompactCard) {
          await runtime.compactProgressStreamer.flushPending(sessionId);
        }

        // A snapshot that came before this final text belongs above it, not below.
        await runtime.todoSnapshots.flush(sessionId);

        await finalizeAssistantResponse({
          sessionId,
          messageId,
          // Text sent early, above a question or permission prompt, is not sent again.
          messageText: remainingText,
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
            runtime.clearToolTracking(sessionId, "assistant_message_completed", true);

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

        if (closesCompactCard) {
          await runtime.compactProgressStreamer.finalize(
            sessionId,
            getDeleteCompactProgressOnFinish(),
          );
        } else if (!compactCardClosed && runtime.compactProgressStreamer.isHolding(sessionId)) {
          runtime.compactProgressStreamer.releaseHold(sessionId);
        }

        // The reply reached the chat live, so its session carries no unread mark for it.
        if (completionInfo.completedAt !== undefined) {
          markSessionReplyRead(sessionId, completionInfo.completedAt);
        }

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

  summaryAggregator.setOnExternalUserInput(async (sessionId, messageId, messageText) => {
    void runtime.enqueueCompletionTask(sessionId, async () => {
      // A V2 user message carries the inbox id it waited under.
      const mirrored = promptQueue.findByInboxId(messageId);
      if (mirrored) {
        promptQueue.removeById(mirrored.id);
        await pickUpInboxPrompt(deps, sessionId, mirrored);
        return;
      }
      // The admission of this prompt may still be on its way back from OpenCode.
      promptQueue.rememberDeliveredInboxId(messageId);
      // A prompt handed over at /detach can no longer be withdrawn once picked up.
      promptHandover.forgetInboxId(messageId);

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
      closeCompactCardBeforeNextActivity(runtime, update.sessionId);
      if (!runtime.runningToolTracker.newestCallId(update.sessionId)) {
        runtime.compactProgressStreamer.updateThinking(update.sessionId);
      }

      if (update.isFirstUpdate && deps.pinnedMessageManager.isInitialized()) {
        await deps.pinnedMessageManager.refresh();
      }
      return;
    }

    if (update.isFirstUpdate) {
      runtime.clearToolTracking(update.sessionId, "thinking_started", true);
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
