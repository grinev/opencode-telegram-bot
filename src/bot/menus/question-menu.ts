import { Context, InlineKeyboard } from "grammy";
import { questionManager } from "../../app/managers/question-manager.js";
import { opencodeClient } from "../../opencode/client.js";
import { getCurrentProject } from "../../app/stores/settings-store.js";
import { getCurrentSession } from "../../app/services/session-service.js";
import { summaryAggregator } from "../../app/managers/summary-aggregation-manager.js";
import { interactionManager } from "../../app/managers/interaction-manager.js";
import { logger } from "../../utils/logger.js";
import { safeBackgroundTask } from "../../utils/safe-background-task.js";
import { t } from "../../i18n/index.js";
import { editRenderedBotPart, sendRenderedBotPart } from "../messages/telegram-text.js";
import type { TelegramRenderedPart, TelegramRichBlock } from "../render/types.js";

const MAX_BUTTON_LENGTH = 60;
const TELEGRAM_MESSAGE_LIMIT = 4096;
const TRUNCATION_SUFFIX = "…";
const QUESTION_EMOJI = "❓";

function getCallbackMessageId(ctx: Context): number | null {
  const message = ctx.callbackQuery?.message;
  if (!message || !("message_id" in message)) {
    return null;
  }

  const messageId = (message as { message_id?: number }).message_id;
  return typeof messageId === "number" ? messageId : null;
}

export function clearQuestionInteraction(reason: string): void {
  const state = interactionManager.getSnapshot();
  if (state?.kind === "question") {
    interactionManager.clear(reason);
  }
}

export function syncQuestionInteractionState(
  expectedInput: "callback" | "mixed",
  questionIndex: number,
  messageId: number | null,
): void {
  const metadata: Record<string, unknown> = {
    questionIndex,
    inputMode: expectedInput === "mixed" ? "custom" : "options",
  };

  const requestID = questionManager.getRequestID();
  if (requestID) {
    metadata.requestID = requestID;
  }

  if (messageId !== null) {
    metadata.messageId = messageId;
  }

  const state = interactionManager.getSnapshot();
  if (state?.kind === "question") {
    interactionManager.transition({
      expectedInput,
      metadata,
    });
    return;
  }

  interactionManager.start({
    kind: "question",
    expectedInput,
    metadata,
  });
}

export async function updateQuestionMessage(ctx: Context): Promise<void> {
  const question = questionManager.getCurrentQuestion();
  if (!question) {
    logger.debug("[QuestionHandler] updateQuestionMessage: no current question");
    return;
  }

  const part = formatQuestionDetailsPart(question);
  const keyboard = buildQuestionKeyboard(
    question,
    questionManager.getSelectedOptions(questionManager.getCurrentIndex()),
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

export async function showCurrentQuestion(bot: Context["api"], chatId: number): Promise<void> {
  const question = questionManager.getCurrentQuestion();

  if (!question) {
    await showPollSummary(bot, chatId);
    return;
  }

  logger.debug(`[QuestionHandler] Showing question: ${question.header} - ${question.question}`);

  const part = formatQuestionDetailsPart(question);
  const keyboard = buildQuestionKeyboard(
    question,
    questionManager.getSelectedOptions(questionManager.getCurrentIndex()),
  );

  logger.debug(`[QuestionHandler] Sending message with keyboard, chatId=${chatId}`);

  try {
    const { messageId } = await sendRenderedBotPart({
      api: bot,
      chatId,
      part,
      options: {
        reply_markup: keyboard,
      },
    });
    questionManager.addMessageId(messageId);

    logger.debug(`[QuestionHandler] Message sent, messageId=${messageId}`);

    questionManager.setActiveMessageId(messageId);
    syncQuestionInteractionState(
      "callback",
      questionManager.getCurrentIndex(),
      questionManager.getActiveMessageId(),
    );

    summaryAggregator.stopTypingIndicator();
  } catch (err) {
    questionManager.clear();
    clearQuestionInteraction("question_message_send_failed");

    logger.error("[QuestionHandler] Failed to send question message:", err);
    throw err;
  }
}

export async function showNextQuestion(ctx: Context): Promise<void> {
  questionManager.nextQuestion();

  if (!ctx.chat) {
    return;
  }

  if (questionManager.hasNextQuestion()) {
    await showCurrentQuestion(ctx.api, ctx.chat.id);
  } else {
    await showPollSummary(ctx.api, ctx.chat.id);
  }
}

async function showPollSummary(bot: Context["api"], chatId: number): Promise<void> {
  const answers = questionManager.getAllAnswers();
  const totalQuestions = questionManager.getTotalQuestions();

  logger.info(
    `[QuestionHandler] Poll completed: ${answers.length}/${totalQuestions} questions answered`,
  );

  // Send all answers to the OpenCode API
  await sendAllAnswersToAgent(bot, chatId);

  if (answers.length === 0) {
    await bot.sendMessage(chatId, t("question.completed_no_answers"));
  } else {
    const summary = formatAnswersSummary(answers);
    await bot.sendMessage(chatId, summary);
  }

  clearQuestionInteraction("question_completed");
  questionManager.clear();
  logger.debug("[QuestionHandler] Poll completed and cleared");
}

async function sendAllAnswersToAgent(bot: Context["api"], chatId: number): Promise<void> {
  const currentProject = getCurrentProject();
  const currentSession = getCurrentSession();
  const requestID = questionManager.getRequestID();
  const totalQuestions = questionManager.getTotalQuestions();
  const directory = currentSession?.directory ?? currentProject?.worktree;

  if (!directory) {
    logger.error("[QuestionHandler] No project for sending answers");
    await bot.sendMessage(chatId, t("question.no_active_project"));
    return;
  }

  if (!requestID) {
    logger.error("[QuestionHandler] No requestID for sending answers");
    await bot.sendMessage(chatId, t("question.no_active_request"));
    return;
  }

  // Collect answers for all questions
  // Format: Array<Array<string>> - for each question, an array of strings (selected options)
  const allAnswers: string[][] = [];

  for (let i = 0; i < totalQuestions; i++) {
    const customAnswer = questionManager.getCustomAnswer(i);
    const selectedAnswer = questionManager.getSelectedAnswer(i);

    // Priority: custom answer > selected options
    const answer = customAnswer || selectedAnswer || "";

    if (answer) {
      // Split by newlines if multiple options were selected (in multiple choice mode)
      // Each option is formatted as "* Label: Description"
      const answerParts = answer.split("\n").filter((part) => part.trim());
      allAnswers.push(answerParts);
    } else {
      // Empty answer for unanswered questions
      allAnswers.push([]);
    }
  }

  logger.info(
    `[QuestionHandler] Sending all ${totalQuestions} answers to agent via question.reply: requestID=${requestID}`,
  );
  logger.debug(`[QuestionHandler] Answers payload:`, JSON.stringify(allAnswers, null, 2));

  // CRITICAL: Fire-and-forget! Do not wait for question.reply to complete,
  // otherwise it may block subsequent updates
  safeBackgroundTask({
    taskName: "question.reply",
    task: () =>
      opencodeClient.question.reply({
        requestID,
        directory,
        answers: allAnswers,
      }),
    onSuccess: ({ error }) => {
      if (error) {
        logger.error("[QuestionHandler] Failed to send answers via question.reply:", error);
        void bot.sendMessage(chatId, t("question.send_answers_error")).catch(() => {});
        return;
      }

      logger.info("[QuestionHandler] All answers sent to agent successfully via question.reply");
    },
  });
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
}): TelegramRenderedPart {
  const currentIndex = questionManager.getCurrentIndex();
  const totalQuestions = questionManager.getTotalQuestions();
  const progressText = totalQuestions > 0 ? `${currentIndex + 1}/${totalQuestions}` : "";

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

  const visibleSegments = truncateQuestionSegments(
    segments.filter((segment) => segmentLength(segment) > 0),
    TELEGRAM_MESSAGE_LIMIT,
  );

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
  question: { options: Array<{ label: string; description: string }>; multiple?: boolean },
  selectedOptions: Set<number>,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  const questionIndex = questionManager.getCurrentIndex();

  logger.debug(`[QuestionHandler] Building keyboard for question ${questionIndex}`);

  question.options.forEach((option, index) => {
    const isSelected = selectedOptions.has(index);
    const icon = isSelected ? "✅ " : "";
    const buttonText = formatButtonText(option.label, icon);
    const callbackData = `question:select:${questionIndex}:${index}`;

    logger.debug(`[QuestionHandler] Button ${index}: "${buttonText}" -> "${callbackData}"`);

    keyboard.text(buttonText, callbackData).row();
  });

  if (question.multiple) {
    keyboard.text(t("question.button.submit"), `question:submit:${questionIndex}`).row();
    logger.debug(`[QuestionHandler] Added submit button`);
  }

  keyboard.text(t("question.button.custom"), `question:custom:${questionIndex}`).row();
  logger.debug(`[QuestionHandler] Added custom answer button`);

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
