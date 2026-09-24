import { getDeleteCompactProgressOnFinish } from "../../../app/stores/settings-store.js";
import { logger } from "../../../utils/logger.js";
import type { PermissionRequest } from "../../../app/types/permission.js";
import type { Question } from "../../../app/types/question.js";
import { showCurrentQuestion } from "../../menus/question-menu.js";
import {
  showPermissionRequest,
  syncPermissionInteractionState,
} from "../../menus/permission-menu.js";
import { keepAssistantDraftsBeforePrompt } from "./assistant-response-handler.js";
import { isCompactProgressMode, type EventHandlerDeps } from "./handler-context.js";

type InteractionDeps = EventHandlerDeps<
  | "interactionManager"
  | "keyboardManager"
  | "permissionManager"
  | "questionManager"
  | "summaryAggregator"
>;

/**
 * Shows a poll, or leaves it waiting while permission prompts are on screen.
 * `generation` is set for a poll released from the waiting place.
 */
async function presentQuestion(
  deps: InteractionDeps,
  questions: Question[],
  requestID: string,
  sessionId: string,
  generation: number | null,
): Promise<void> {
  const { runtime, policy, interactionManager, questionManager } = deps;
  const destination = policy.getDestination(sessionId);
  if (!destination) {
    logger.error("Bot or chat ID not available for showing questions");
    return;
  }

  if (!policy.isForegroundSession(sessionId)) {
    return;
  }

  await Promise.all([
    runtime.toolMessageBatcher.flushSession(sessionId, "question_asked"),
    runtime.toolCallStreamer.flushSession(sessionId, "question_asked"),
  ]);
  await keepAssistantDraftsBeforePrompt(deps, sessionId);

  // Decide and open the slot in one synchronous step: a permission or a
  // reset may have landed during the flushes.
  if (generation !== null && generation !== interactionManager.getGeneration()) {
    logger.info(`[Bot] Dropping waiting poll after a reset: requestID=${requestID}`);
    return;
  }

  if (!policy.isForegroundSession(sessionId)) {
    return;
  }

  const previousMessageIds = questionManager.isActive() ? questionManager.getMessageIds() : [];
  if (!questionManager.startQuestions(questions, requestID)) {
    interactionManager.waitQuestion(questions, requestID, sessionId);
    return;
  }

  if (isCompactProgressMode()) {
    await runtime.compactProgressStreamer.flushPending(sessionId);
    runtime.compactProgressStreamer.holdForClose(sessionId);
  }

  if (previousMessageIds.length > 0) {
    logger.warn("[Bot] Replacing active poll with a new one");
    for (const messageId of previousMessageIds) {
      await destination.api.deleteMessage(destination.chatId, messageId).catch(() => {});
    }
  }

  logger.info(`[Bot] Received ${questions.length} questions from agent, requestID=${requestID}`);
  try {
    await showCurrentQuestion(destination.api, destination.chatId, deps);
  } catch {
    runtime.compactProgressStreamer.releaseHold(sessionId);
    return;
  }

  if (isCompactProgressMode()) {
    await runtime.compactProgressStreamer.finalize(sessionId, getDeleteCompactProgressOnFinish());
  } else {
    runtime.compactProgressStreamer.releaseHold(sessionId);
  }
}

/**
 * Shows a permission prompt, or leaves it waiting while a poll is on screen.
 * A subagent's request is shown while its parent session is followed.
 */
async function presentPermission(
  deps: InteractionDeps,
  request: PermissionRequest,
  generation: number,
): Promise<void> {
  const { runtime, policy, interactionManager, permissionManager, summaryAggregator } = deps;
  const sessionId = request.sessionID;
  const destination = policy.getDestination(sessionId);
  if (!destination) {
    logger.error("Bot or chat ID not available for showing permission request");
    return;
  }

  const isSubagent = summaryAggregator.isSubagentSession(sessionId);
  const followedSessionId = isSubagent ? summaryAggregator.getRootSessionId(sessionId) : sessionId;
  if (!policy.isForegroundSession(followedSessionId)) {
    return;
  }

  await Promise.all([
    runtime.toolMessageBatcher.flushSession(sessionId, "permission_asked"),
    runtime.toolCallStreamer.flushSession(sessionId, "permission_asked"),
  ]);
  await keepAssistantDraftsBeforePrompt(deps, followedSessionId);

  // Decide in one synchronous step: a poll or a reset may have landed during the flushes.
  if (permissionManager.getDropReason(request, generation)) {
    logger.debug(`[Bot] Dropping stale or resolved permission request: requestID=${request.id}`);
    return;
  }

  if (interactionManager.getSnapshot()?.kind === "question") {
    interactionManager.waitPermission(request);
    return;
  }

  if (isCompactProgressMode()) {
    await runtime.compactProgressStreamer.flushPending(followedSessionId);
    runtime.compactProgressStreamer.holdForClose(followedSessionId);
  }

  logger.info(
    `[Bot] Received permission request from agent: type=${request.permission}, requestID=${request.id}, subagent=${isSubagent}`,
  );
  const messageIdsBefore = new Set(permissionManager.getMessageIds());
  try {
    await showPermissionRequest(destination.api, destination.chatId, request, deps, generation);
  } catch {
    runtime.compactProgressStreamer.releaseHold(followedSessionId);
    return;
  }

  const promptLanded = permissionManager
    .getMessageIds()
    .some((messageId) => !messageIdsBefore.has(messageId));
  if (isCompactProgressMode() && promptLanded) {
    await runtime.compactProgressStreamer.finalize(
      followedSessionId,
      getDeleteCompactProgressOnFinish(),
    );
  } else {
    runtime.compactProgressStreamer.releaseHold(followedSessionId);
  }
}

/** Polls and permission prompts, including the queue of waiting requests. */
export function registerInteractionHandlers(deps: InteractionDeps): void {
  const { policy, interactionManager, permissionManager, questionManager, summaryAggregator } =
    deps;

  summaryAggregator.setOnQuestion(async (questions, requestID, sessionId) => {
    await presentQuestion(deps, questions, requestID, sessionId, null);
  });

  summaryAggregator.setOnQuestionError(async (sessionId) => {
    if (!questionManager.isActive()) {
      interactionManager.dropWaitingQuestion();
      return;
    }

    logger.info("[Bot] Question tool failed, clearing active poll and deleting messages");

    const messageIds = questionManager.getMessageIds();
    questionManager.clear();

    const destination = policy.getDestination(sessionId);
    for (const messageId of messageIds) {
      if (destination) {
        await destination.api.deleteMessage(destination.chatId, messageId).catch((err) => {
          logger.error(`[Bot] Failed to delete question message ${messageId}:`, err);
        });
      }
    }
  });

  summaryAggregator.setOnPermission(async (request) => {
    await presentPermission(deps, request, permissionManager.getGeneration());
  });

  interactionManager.setOnWaitingRequestReady((request, generation) => {
    const present = async (): Promise<void> => {
      if (request.kind === "question") {
        await presentQuestion(
          deps,
          request.questions,
          request.requestID,
          request.sessionId,
          generation,
        );
        return;
      }

      for (const permission of request.requests) {
        await presentPermission(deps, permission, generation);
      }
    };

    present().catch((err) => {
      logger.error(`[Bot] Failed to show waiting ${request.kind} request:`, err);
    });
  });

  summaryAggregator.setOnPermissionReplied(async (sessionId, requestID) => {
    const messageIds = permissionManager.resolveRequest(requestID);
    const interaction = interactionManager.getSnapshot();
    if (!permissionManager.isActive() || !interaction || interaction.kind === "permission") {
      syncPermissionInteractionState(deps, { resolvedRequestID: requestID });
    }

    const destination = policy.getDestination(sessionId);
    if (destination) {
      await Promise.all(
        messageIds.map((messageId) =>
          destination.api.deleteMessage(destination.chatId, messageId).catch((err) => {
            logger.warn(`[Bot] Failed to delete resolved permission message ${messageId}:`, err);
          }),
        ),
      );
    }

    if (messageIds.length > 0) {
      logger.info(
        `[Bot] Cleared resolved permission prompt: requestID=${requestID}, messages=${messageIds.length}`,
      );
    }
  });
}
