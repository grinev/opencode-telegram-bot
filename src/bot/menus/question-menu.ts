import { Context, InlineKeyboard } from "grammy";
import type { AppContainer } from "../../app/bootstrap/app-container.js";
import { opencodeClient } from "../../opencode/client.js";
import { getCurrentProject } from "../../app/stores/settings-store.js";
import { getCurrentSession } from "../../app/services/session-service.js";
import { logger } from "../../utils/logger.js";
import { safeBackgroundTask } from "../../utils/safe-background-task.js";
import { t } from "../../i18n/index.js";
import { editRenderedBotPart, sendRenderedBotPart } from "../messages/telegram-text.js";
import type { TelegramRenderedPart, TelegramRichBlock } from "../render/types.js";
import type {
  Question,
  QuestionInFlightEnding,
  QuestionSettledOutcome,
  QuestionState,
} from "../../app/types/question.js";
import { isOpencodeNotFoundError } from "../../utils/opencode-error.js";
import { isRecord } from "../../utils/type-guards.js";

const MAX_BUTTON_LENGTH = 60;
const TELEGRAM_MESSAGE_LIMIT = 4096;
const TRUNCATION_SUFFIX = "…";
const QUESTION_EMOJI = "❓";
const CUSTOM_ANSWER_EMOJI = "✏️";

export type QuestionInteractionDeps = Pick<AppContainer, "interactionManager">;

type QuestionDataDeps = Pick<AppContainer, "questionManager">;

export type QuestionStateDeps = Pick<AppContainer, "interactionManager" | "questionManager">;

export type QuestionMenuDeps = Pick<
  AppContainer,
  "interactionManager" | "questionManager" | "summaryAggregator"
> & { onAgentPromptShown?: (sessionId: string) => void };

/** Where a question sits in its poll, shown as `n/total` in its header. */
interface QuestionProgress {
  index: number;
  total: number;
}

/** How OpenCode took a reply of the poll: accepted, gone (already settled) or not reached. */
export type QuestionReplyResult = "accepted" | "gone" | "failed";

/**
 * A reply to a request OpenCode no longer has pending: not found on either version, or a V2
 * form that was already settled.
 */
export function isQuestionRequestGone(error: unknown): boolean {
  return (
    isOpencodeNotFoundError(error) ||
    (isRecord(error) &&
      (error._tag === "QuestionNotFoundError" || error._tag === "FormAlreadySettledError"))
  );
}

function getProgress(deps: QuestionDataDeps): QuestionProgress {
  return {
    index: deps.questionManager.getCurrentIndex(),
    total: deps.questionManager.getTotalQuestions(),
  };
}

function getCallbackMessageId(ctx: Context): number | null {
  const message = ctx.callbackQuery?.message;
  if (!message || !("message_id" in message)) {
    return null;
  }

  const messageId = (message as { message_id?: number }).message_id;
  return typeof messageId === "number" ? messageId : null;
}

export function clearQuestionInteraction(reason: string, deps: QuestionInteractionDeps): void {
  const state = deps.interactionManager.getSnapshot();
  if (state?.kind === "question") {
    deps.interactionManager.clear(reason);
  }
}

export function syncQuestionInteractionState(
  expectedInput: "callback" | "mixed",
  questionIndex: number,
  messageId: number | null,
  deps: QuestionStateDeps,
): void {
  const metadata: Record<string, unknown> = {
    questionIndex,
    inputMode: expectedInput === "mixed" ? "custom" : "options",
  };

  const requestID = deps.questionManager.getRequestID();
  if (requestID) {
    metadata.requestID = requestID;
  }

  if (messageId !== null) {
    metadata.messageId = messageId;
  }

  // The slot is opened by questionManager.startQuestions; only refine it here.
  if (deps.interactionManager.getSnapshot()?.kind !== "question") {
    return;
  }

  deps.interactionManager.transition({
    expectedInput,
    metadata,
  });
}

export async function updateQuestionMessage(
  ctx: Context,
  deps: QuestionDataDeps,
): Promise<void> {
  const { questionManager } = deps;
  const question = questionManager.getCurrentQuestion();
  if (!question) {
    logger.debug("[QuestionHandler] updateQuestionMessage: no current question");
    return;
  }

  const part = formatQuestionDetailsPart(question, getProgress(deps));
  const keyboard = buildQuestionKeyboard(
    question,
    questionManager.getSelectedOptions(questionManager.getCurrentIndex()),
    deps,
  );

  logger.debug("[QuestionHandler] Updating question message");

  try {
    const chatId = ctx.chat?.id;
    const messageId = getCallbackMessageId(ctx);

    if (!chatId || messageId === null) {
      await ctx.editMessageText(part.fallbackText, {
        reply_markup: keyboard,
      });
      return;
    }

    await editRenderedBotPart({
      api: ctx.api,
      chatId,
      messageId,
      part,
      options: {
        reply_markup: keyboard,
      },
    });
  } catch (err) {
    logger.error("[QuestionHandler] Failed to update message:", err);
  }
}

export async function showCurrentQuestion(
  bot: Context["api"],
  chatId: number,
  deps: QuestionMenuDeps,
): Promise<void> {
  const { questionManager, summaryAggregator } = deps;
  const question = questionManager.getCurrentQuestion();

  if (!question) {
    await submitPollAnswers(bot, chatId, deps);
    return;
  }

  logger.debug(`[QuestionHandler] Showing question: ${question.header} - ${question.question}`);

  const part = formatQuestionDetailsPart(question, getProgress(deps));
  const keyboard = buildQuestionKeyboard(
    question,
    questionManager.getSelectedOptions(questionManager.getCurrentIndex()),
    deps,
  );

  logger.debug(`[QuestionHandler] Sending message with keyboard, chatId=${chatId}`);

  // Until the message lands, a settle, reset or run end of this question is recorded for it.
  const requestID = questionManager.getRequestID();
  const sessionId = questionManager.getSessionId();
  const progress = getProgress(deps);
  if (requestID && sessionId) {
    questionManager.trackInFlight(requestID, sessionId);
  }

  try {
    const { messageId } = await sendRenderedBotPart({
      api: bot,
      chatId,
      part,
      options: {
        reply_markup: keyboard,
      },
    });

    if (requestID) {
      const ending = questionManager.getInFlightEnding(requestID);
      questionManager.untrackInFlight(requestID);
      const holdsSlot = questionManager.getRequestID() === requestID;
      if (ending || !holdsSlot) {
        await endLandedPoll(bot, chatId, messageId, question, progress, ending ?? "not_answered");
        if (holdsSlot) {
          // A run end leaves the slot to the poll: release it so waiting requests move on.
          clearQuestionInteraction("question_not_answered", deps);
          questionManager.clear();
        }
        return;
      }
    }

    questionManager.addMessageId(messageId);

    logger.debug(`[QuestionHandler] Message sent, messageId=${messageId}`);

    questionManager.setActiveMessageId(messageId);
    syncQuestionInteractionState(
      "callback",
      questionManager.getCurrentIndex(),
      questionManager.getActiveMessageId(),
      deps,
    );

    if (sessionId) deps.onAgentPromptShown?.(sessionId);
    summaryAggregator.stopTypingIndicator();
  } catch (err) {
    if (requestID) {
      questionManager.untrackInFlight(requestID);
    }
    questionManager.clear();
    clearQuestionInteraction("question_message_send_failed", deps);

    logger.error("[QuestionHandler] Failed to send question message:", err);
    throw err;
  }
}

export async function showNextQuestion(ctx: Context, deps: QuestionMenuDeps): Promise<void> {
  deps.questionManager.nextQuestion();

  if (!ctx.chat) {
    return;
  }

  await showCurrentQuestion(ctx.api, ctx.chat.id, deps);
}

/**
 * The poll message landed after its question had already ended: it keeps its text and gets
 * the ending's line instead of live buttons, or goes when a newer poll replaced it.
 */
async function endLandedPoll(
  bot: Context["api"],
  chatId: number,
  messageId: number,
  question: Question,
  progress: QuestionProgress,
  ending: QuestionInFlightEnding,
): Promise<void> {
  logger.info(`[QuestionHandler] Poll landed after its question ended: ending=${ending}`);

  if (ending === "replaced") {
    await bot.deleteMessage(chatId, messageId).catch(() => {});
    return;
  }

  const line =
    ending === "not_answered"
      ? t("question.not_answered")
      : t(
          ending === "answered"
            ? "question.settled_outside.answered"
            : "question.settled_outside.cancelled",
        );
  await editRenderedBotPart({
    api: bot,
    chatId,
    messageId,
    part: formatQuestionDetailsPart(question, progress, line),
  }).catch((err) => {
    logger.warn("[QuestionHandler] Failed to close the late poll message:", err);
  });
}

/**
 * Ends a poll dropped by a reset (`/abort`, `/new`, a session switch, ...): the message on
 * screen keeps its text, loses its buttons and says it was not answered.
 */
export async function closeDroppedPoll(
  bot: Context["api"],
  chatId: number,
  state: QuestionState,
): Promise<void> {
  const question = state.questions[state.currentIndex];
  if (!question || state.activeMessageId === null) {
    return;
  }

  logger.info(`[QuestionHandler] Poll dropped by a reset: requestID=${state.requestID}`);
  await editRenderedBotPart({
    api: bot,
    chatId,
    messageId: state.activeMessageId,
    part: formatQuestionDetailsPart(
      question,
      { index: state.currentIndex, total: state.questions.length },
      t("question.not_answered"),
    ),
  }).catch((err) => {
    logger.warn("[QuestionHandler] Failed to close the dropped poll message:", err);
  });
}

/**
 * The last step of the poll was taken: its answers go to OpenCode in the background and the
 * poll stays on screen, its buttons doing nothing, until OpenCode answers.
 */
export async function submitPollAnswers(
  bot: Context["api"],
  chatId: number,
  deps: QuestionMenuDeps,
): Promise<void> {
  const { questionManager } = deps;
  const requestID = questionManager.getRequestID();
  const directory = getCurrentSession()?.directory ?? getCurrentProject()?.worktree;

  questionManager.startAnswer();
  syncQuestionInteractionState(
    "callback",
    questionManager.getCurrentIndex(),
    questionManager.getActiveMessageId(),
    deps,
  );

  if (!requestID || !directory) {
    // Nothing can be sent: the poll stays answerable and says the answer did not get through.
    logger.error("[QuestionHandler] No requestID or project for sending answers");
    await finishPollAnswers(bot, chatId, deps, requestID ?? "", "failed");
    return;
  }

  const totalQuestions = questionManager.getTotalQuestions();
  const allAnswers: string[][] = [];
  for (let i = 0; i < totalQuestions; i++) {
    allAnswers.push(questionManager.getReplyItems(i));
  }

  logger.info(
    `[QuestionHandler] Sending all ${totalQuestions} answers to agent via question.reply: requestID=${requestID}`,
  );
  logger.debug(`[QuestionHandler] Answers payload:`, JSON.stringify(allAnswers, null, 2));

  // In the background: waiting here would block the update that took the last step.
  safeBackgroundTask({
    taskName: "question.reply",
    task: async (): Promise<QuestionReplyResult> => {
      const { error } = await opencodeClient.question.reply({
        requestID,
        directory,
        answers: allAnswers,
      });
      if (!error) {
        return "accepted";
      }

      if (isQuestionRequestGone(error)) {
        logger.info(`[QuestionHandler] Answers sent to a settled question: requestID=${requestID}`);
        return "gone";
      }

      logger.error(
        `[QuestionHandler] Failed to send answers via question.reply: requestID=${requestID}`,
        error,
      );
      return "failed";
    },
    onSuccess: (result) => finishPollAnswers(bot, chatId, deps, requestID, result),
    onError: () => finishPollAnswers(bot, chatId, deps, requestID, "failed"),
  });
}

/**
 * Ends the poll once OpenCode answered its reply, or leaves it answerable with a warning when
 * the answers did not get through. A poll something else already ended stays as it is.
 */
async function finishPollAnswers(
  bot: Context["api"],
  chatId: number,
  deps: QuestionMenuDeps,
  requestID: string,
  result: QuestionReplyResult,
): Promise<void> {
  const { questionManager } = deps;
  if (!questionManager.isAnswering() || questionManager.getRequestID() !== requestID) {
    logger.info(`[QuestionHandler] Answers finished for a poll already closed: ${requestID}`);
    return;
  }

  const settled = questionManager.getSettledWhileSending();
  logger.info(
    `[QuestionHandler] Answers finished: requestID=${requestID}, result=${result}, settled=${settled ?? "none"}`,
  );

  if (result === "accepted" || (result === "failed" && settled === "answered")) {
    // A lost reply still counts when OpenCode reported the question answered.
    await completePoll(bot, chatId, deps);
  } else if (result === "gone" || settled === "cancelled") {
    await closeQuestionSettledOutside(bot, chatId, settled ?? "answered", deps);
  } else {
    questionManager.failAnswer();
    await showQuestionDeliveryWarning(bot, chatId, deps);
  }
}

/** OpenCode took the answers: the poll gives way to the summary of what was answered. */
async function completePoll(
  bot: Context["api"],
  chatId: number,
  deps: QuestionStateDeps,
): Promise<void> {
  const { questionManager } = deps;
  const answers = questionManager.getAllAnswers();
  const totalQuestions = questionManager.getTotalQuestions();
  const messageId = questionManager.getActiveMessageId();
  const requestID = questionManager.getRequestID();

  logger.info(
    `[QuestionHandler] Poll completed: ${answers.length}/${totalQuestions} questions answered`,
  );

  // The slot is released after the summary, so a waiting request never lands above it.
  try {
    if (messageId !== null) {
      await bot.deleteMessage(chatId, messageId).catch(() => {});
    }

    if (answers.length === 0) {
      await bot.sendMessage(chatId, t("question.completed_no_answers"));
    } else {
      await bot.sendMessage(chatId, formatAnswersSummary(answers));
    }
  } finally {
    // A reset during the send may have let a newer poll into the slot: leave that one alone.
    if (questionManager.getRequestID() === requestID) {
      clearQuestionInteraction("question_completed", deps);
      questionManager.clear();
    }
  }
}

/**
 * Closes the poll on screen after OpenCode settled it outside Telegram: the question
 * message keeps its text, loses its buttons and gets the outcome line, and the slot
 * is released.
 */
export async function closeQuestionSettledOutside(
  bot: Context["api"],
  chatId: number,
  outcome: QuestionSettledOutcome,
  deps: QuestionStateDeps,
): Promise<void> {
  logger.info(
    `[QuestionHandler] Poll settled outside Telegram: requestID=${deps.questionManager.getRequestID()}, outcome=${outcome}`,
  );
  await closeQuestionWithLine(
    bot,
    chatId,
    t(
      outcome === "answered"
        ? "question.settled_outside.answered"
        : "question.settled_outside.cancelled",
    ),
    "question_settled_outside",
    deps,
  );
}

/**
 * Closes the poll on screen that OpenCode lost with its server (stopped or restarted): it
 * keeps its text, loses its buttons and says it was not answered.
 */
export async function closeQuestionNotAnswered(
  bot: Context["api"],
  chatId: number,
  deps: QuestionStateDeps,
): Promise<void> {
  logger.info(
    `[QuestionHandler] Poll lost with the OpenCode server: requestID=${deps.questionManager.getRequestID()}`,
  );
  await closeQuestionWithLine(
    bot,
    chatId,
    t("question.not_answered"),
    "question_not_answered",
    deps,
  );
}

async function closeQuestionWithLine(
  bot: Context["api"],
  chatId: number,
  line: string,
  reason: "question_settled_outside" | "question_not_answered",
  deps: QuestionStateDeps,
): Promise<void> {
  const { questionManager } = deps;
  const question = questionManager.getCurrentQuestion();
  const messageId = questionManager.getActiveMessageId();
  const part = question ? formatQuestionDetailsPart(question, getProgress(deps), line) : null;

  // Release the poll before the edit: the question tool's error, which follows a dismissal,
  // must not find it active and delete it.
  clearQuestionInteraction(reason, deps);
  questionManager.clear();

  if (part && messageId !== null) {
    await editRenderedBotPart({ api: bot, chatId, messageId, part }).catch((err) => {
      logger.warn("[QuestionHandler] Failed to close the poll message:", err);
    });
  }
}

/**
 * Closes the poll after OpenCode took the dismissal sent by its Cancel button: the question
 * message is replaced by the cancelled line, and the slot is released.
 */
export async function closeQuestionCancelled(
  bot: Context["api"],
  chatId: number,
  deps: QuestionStateDeps,
): Promise<void> {
  const { questionManager } = deps;
  const messageId = questionManager.getActiveMessageId();

  // Released before the edit, like a poll settled outside Telegram.
  questionManager.cancel();

  if (messageId !== null) {
    await bot.editMessageText(chatId, messageId, t("question.cancelled")).catch((err) => {
      logger.warn("[QuestionHandler] Failed to close the cancelled poll message:", err);
    });
  }
}

/**
 * The answers or the dismissal did not reach OpenCode: the question keeps its text and
 * buttons and says so.
 */
export async function showQuestionDeliveryWarning(
  bot: Context["api"],
  chatId: number,
  deps: QuestionDataDeps,
): Promise<void> {
  const { questionManager } = deps;
  const question = questionManager.getCurrentQuestion();
  const messageId = questionManager.getActiveMessageId();
  if (!question || messageId === null) {
    return;
  }

  await editRenderedBotPart({
    api: bot,
    chatId,
    messageId,
    part: formatQuestionDetailsPart(question, getProgress(deps), t("permission.delivery_failed")),
    options: {
      reply_markup: buildQuestionKeyboard(
        question,
        questionManager.getSelectedOptions(questionManager.getCurrentIndex()),
        deps,
      ),
    },
  }).catch((err) => {
    // The warning from an earlier failed reply may still be on the poll.
    if (!isMessageNotModifiedError(err)) {
      logger.warn("[QuestionHandler] Failed to show the delivery warning in the poll:", err);
    }
  });
}

function isMessageNotModifiedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("message is not modified");
}

/** A paragraph of the question card: an optional bold lead-in plus regular text. */
interface QuestionSegment {
  label?: string | undefined;
  rest: string;
}

function segmentLength(segment: QuestionSegment): number {
  return (segment.label?.length ?? 0) + segment.rest.length;
}

function segmentToPlainText(segment: QuestionSegment): string {
  return `${segment.label ?? ""}${segment.rest}`;
}

function segmentToBlock(segment: QuestionSegment): TelegramRichBlock {
  if (!segment.label) {
    return { type: "paragraph", text: segment.rest };
  }

  const bold = { type: "bold" as const, text: segment.label };
  return { type: "paragraph", text: segment.rest ? [bold, segment.rest] : bold };
}

function sliceOnSafeBoundary(text: string, maxLength: number): string {
  let endIndex = Math.max(0, Math.min(text.length, maxLength));
  if (endIndex > 0 && isHighSurrogate(text.charCodeAt(endIndex - 1))) {
    endIndex -= 1;
  }

  return text.slice(0, endIndex);
}

function appendTruncationSuffix(segment: QuestionSegment): QuestionSegment {
  return { ...segment, rest: `${segment.rest}${TRUNCATION_SUFFIX}` };
}

/**
 * Keeps the card within the Telegram message limit by dropping whole segments
 * from the tail, cutting only the last one that still partially fits.
 */
function truncateQuestionSegments(
  segments: QuestionSegment[],
  limit: number,
): QuestionSegment[] {
  const separatorLength = 2;
  const result: QuestionSegment[] = [];
  let used = 0;

  for (const segment of segments) {
    const prefix = result.length > 0 ? separatorLength : 0;
    const length = segmentLength(segment);

    if (used + prefix + length <= limit) {
      result.push(segment);
      used += prefix + length;
      continue;
    }

    const available = limit - used - prefix - TRUNCATION_SUFFIX.length;
    const labelLength = segment.label?.length ?? 0;

    if (available > labelLength) {
      result.push(
        appendTruncationSuffix({
          label: segment.label,
          rest: sliceOnSafeBoundary(segment.rest, available - labelLength),
        }),
      );
    } else if (result.length > 0) {
      const lastSegment = result[result.length - 1];
      if (lastSegment) {
        result[result.length - 1] = appendTruncationSuffix(lastSegment);
      }
    } else {
      result.push(
        appendTruncationSuffix({
          rest: sliceOnSafeBoundary(
            segmentToPlainText(segment),
            Math.max(0, limit - TRUNCATION_SUFFIX.length),
          ),
        }),
      );
    }

    break;
  }

  return result;
}

function formatQuestionDetailsPart(question: {
  header: string;
  question: string;
  options: Array<{ label: string; description: string }>;
  multiple?: boolean;
}, progress: QuestionProgress, statusLine?: string): TelegramRenderedPart {
  const progressText = progress.total > 0 ? `${progress.index + 1}/${progress.total}` : "";

  const headerTitle = [QUESTION_EMOJI, progressText, question.header].filter(Boolean).join(" ");
  const multiple = question.multiple ? t("question.multi_hint") : "";
  const questionText = `${question.question}${multiple}`;

  const segments: QuestionSegment[] = [];
  if (headerTitle) {
    segments.push({ label: headerTitle, rest: "" });
  }
  if (questionText) {
    segments.push({ rest: questionText });
  }
  for (const option of question.options) {
    segments.push({
      label: option.label || undefined,
      rest: option.description ? `${option.label ? " — " : ""}${option.description}` : "",
    });
  }

  // A status line closes the card and is never cut: the question text makes room for it.
  const statusSegment: QuestionSegment | null = statusLine ? { rest: statusLine } : null;
  const reserved = statusSegment ? segmentLength(statusSegment) + 2 : 0;
  const visibleSegments = truncateQuestionSegments(
    segments.filter((segment) => segmentLength(segment) > 0),
    TELEGRAM_MESSAGE_LIMIT - reserved,
  );
  if (statusSegment) {
    visibleSegments.push(statusSegment);
  }

  return {
    blocks: visibleSegments.map(segmentToBlock),
    fallbackText: visibleSegments.map(segmentToPlainText).join("\n\n"),
    source: "blocks",
  };
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function buildQuestionKeyboard(
  question: {
    options: Array<{ label: string; description: string }>;
    multiple?: boolean;
    custom?: boolean;
  },
  selectedOptions: Set<number>,
  deps: QuestionDataDeps,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  const questionIndex = deps.questionManager.getCurrentIndex();

  logger.debug(`[QuestionHandler] Building keyboard for question ${questionIndex}`);

  question.options.forEach((option, index) => {
    const isSelected = selectedOptions.has(index);
    const icon = isSelected ? "✅ " : "";
    const buttonText = formatButtonText(option.label, icon);
    const callbackData = `question:select:${questionIndex}:${index}`;

    logger.debug(`[QuestionHandler] Button ${index}: "${buttonText}" -> "${callbackData}"`);

    keyboard.text(buttonText, callbackData).row();
  });

  const customAnswer = deps.questionManager.getCustomAnswer(questionIndex);
  if (question.multiple && customAnswer) {
    const icon = deps.questionManager.isCustomAnswerSelected(questionIndex) ? "✅ " : "";
    const label = `${CUSTOM_ANSWER_EMOJI} ${customAnswer.replace(/\s*\n\s*/g, " ")}`;
    keyboard.text(formatButtonText(label, icon), `question:toggle_custom:${questionIndex}`).row();
    logger.debug(`[QuestionHandler] Added custom answer row`);
  }

  if (question.multiple) {
    keyboard.text(t("question.button.submit"), `question:submit:${questionIndex}`).row();
    logger.debug(`[QuestionHandler] Added submit button`);
  }

  // A question without choices can only be answered with custom text
  if (question.options.length === 0 || question.custom !== false) {
    keyboard.text(t("question.button.custom"), `question:custom:${questionIndex}`).row();
    logger.debug(`[QuestionHandler] Added custom answer button`);
  }

  keyboard.text(t("question.button.cancel"), `question:cancel:${questionIndex}`);
  logger.debug(`[QuestionHandler] Added cancel button`);

  logger.debug(`[QuestionHandler] Final keyboard: ${JSON.stringify(keyboard.inline_keyboard)}`);

  return keyboard;
}

function formatButtonText(label: string, icon: string): string {
  let text = `${icon}${label}`;

  if (text.length > MAX_BUTTON_LENGTH) {
    text = text.substring(0, MAX_BUTTON_LENGTH - 3) + "...";
  }

  return text;
}

function formatAnswersSummary(answers: Array<{ question: string; answer: string }>): string {
  let summary = t("question.summary.title");

  answers.forEach((item, index) => {
    summary += t("question.summary.question", {
      index: index + 1,
      question: item.question,
    });
    summary += t("question.summary.answer", { answer: item.answer });
  });

  return summary;
}
