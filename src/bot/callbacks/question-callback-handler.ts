import type { Context } from "grammy";
import type { AppContainer } from "../../app/bootstrap/app-container.js";
import {
  clearQuestionInteraction,
  showCurrentQuestion,
  showNextQuestion,
  syncQuestionInteractionState,
  updateQuestionMessage,
} from "../menus/question-menu.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { alert, cancelPrompt } from "./feedback.js";

export type QuestionCallbackDeps = Pick<
  AppContainer,
  "interactionManager" | "questionManager" | "summaryAggregator"
>;

function getCallbackMessageId(ctx: Context): number | null {
  const message = ctx.callbackQuery?.message;
  if (!message || !("message_id" in message)) {
    return null;
  }

  const messageId = (message as { message_id?: number }).message_id;
  return typeof messageId === "number" ? messageId : null;
}

export async function handleQuestionCallback(
  ctx: Context,
  deps: QuestionCallbackDeps,
): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data) return false;

  if (!data.startsWith("question:")) {
    return false;
  }

  logger.debug(`[QuestionHandler] Received callback: ${data}`);

  if (!deps.questionManager.isActive()) {
    clearQuestionInteraction("question_inactive_callback", deps);
    await ctx.answerCallbackQuery({ text: t("question.inactive_callback"), show_alert: true });
    return true;
  }

  const callbackMessageId = getCallbackMessageId(ctx);
  if (!deps.questionManager.isActiveMessage(callbackMessageId)) {
    await ctx.answerCallbackQuery({ text: t("question.inactive_callback"), show_alert: true });
    return true;
  }

  const parts = data.split(":");
  const action = parts[1];
  const questionIndex = parseInt(parts[2] ?? "", 10);

  if (Number.isNaN(questionIndex) || questionIndex !== deps.questionManager.getCurrentIndex()) {
    await ctx.answerCallbackQuery({ text: t("question.inactive_callback"), show_alert: true });
    return true;
  }

  try {
    switch (action) {
      case "select":
        {
          const optionIndex = parseInt(parts[3] ?? "", 10);
          if (Number.isNaN(optionIndex)) {
            await ctx.answerCallbackQuery({
              text: t("question.processing_error_callback"),
              show_alert: true,
            });
            break;
          }

          await handleSelectOption(ctx, deps, questionIndex, optionIndex);
        }
        break;
      case "submit":
        await handleSubmitAnswer(ctx, deps, questionIndex);
        break;
      case "custom":
        await handleCustomAnswer(ctx, deps, questionIndex);
        break;
      case "toggle_custom":
        await handleToggleCustomAnswer(ctx, deps, questionIndex);
        break;
      case "cancel":
        await handleCancelPoll(ctx, deps);
        break;
      default:
        await ctx.answerCallbackQuery({
          text: t("question.processing_error_callback"),
          show_alert: true,
        });
        break;
    }
  } catch (err) {
    logger.error("[QuestionHandler] Error handling callback:", err);
    await ctx.answerCallbackQuery({
      text: t("question.processing_error_callback"),
      show_alert: true,
    });
  }

  return true;
}

async function handleSelectOption(
  ctx: Context,
  deps: QuestionCallbackDeps,
  questionIndex: number,
  optionIndex: number,
): Promise<void> {
  logger.debug(
    `[QuestionHandler] handleSelectOption: qIndex=${questionIndex}, oIndex=${optionIndex}`,
  );

  const question = deps.questionManager.getCurrentQuestion();
  if (!question) {
    logger.debug("[QuestionHandler] No current question");
    await alert(ctx, "question.inactive_callback");
    return;
  }

  if (deps.questionManager.isWaitingForCustomInput(questionIndex)) {
    deps.questionManager.clearCustomInput();
    syncQuestionInteractionState(
      "callback",
      questionIndex,
      deps.questionManager.getActiveMessageId(),
      deps,
    );
  }

  deps.questionManager.selectOption(questionIndex, optionIndex);

  if (question.multiple) {
    logger.debug("[QuestionHandler] Multiple choice mode, updating message");
    await updateQuestionMessage(ctx, deps);
    await ctx.answerCallbackQuery();
  } else {
    logger.debug("[QuestionHandler] Single choice mode, moving to next question");
    await ctx.answerCallbackQuery();

    const answer = deps.questionManager.getSelectedAnswer(questionIndex);
    logger.debug(`[QuestionHandler] Selected answer for question ${questionIndex}: ${answer}`);

    await ctx.deleteMessage().catch(() => {});
    await showNextQuestion(ctx, deps);
  }
}

async function handleSubmitAnswer(
  ctx: Context,
  deps: QuestionCallbackDeps,
  questionIndex: number,
): Promise<void> {
  if (deps.questionManager.isWaitingForCustomInput(questionIndex)) {
    deps.questionManager.clearCustomInput();
    syncQuestionInteractionState(
      "callback",
      questionIndex,
      deps.questionManager.getActiveMessageId(),
      deps,
    );
  }

  if (!deps.questionManager.hasAnswer(questionIndex)) {
    await ctx.answerCallbackQuery({
      text: t("question.select_one_required_callback"),
      show_alert: true,
    });
    return;
  }

  logger.debug(
    `[QuestionHandler] Submit answer for question ${questionIndex}: ${deps.questionManager.getAnswerItems(questionIndex).join(" | ")}`,
  );

  await ctx.answerCallbackQuery();
  await ctx.deleteMessage().catch(() => {});
  await showNextQuestion(ctx, deps);
}

async function handleCustomAnswer(
  ctx: Context,
  deps: QuestionCallbackDeps,
  questionIndex: number,
): Promise<void> {
  deps.questionManager.startCustomInput(questionIndex);
  syncQuestionInteractionState(
    "mixed",
    questionIndex,
    deps.questionManager.getActiveMessageId(),
    deps,
  );

  await ctx.answerCallbackQuery({
    text: t("question.enter_custom_callback"),
    show_alert: true,
  });
}

async function handleToggleCustomAnswer(
  ctx: Context,
  deps: QuestionCallbackDeps,
  questionIndex: number,
): Promise<void> {
  if (deps.questionManager.isWaitingForCustomInput(questionIndex)) {
    deps.questionManager.clearCustomInput();
    syncQuestionInteractionState(
      "callback",
      questionIndex,
      deps.questionManager.getActiveMessageId(),
      deps,
    );
  }

  deps.questionManager.toggleCustomAnswer(questionIndex);

  await updateQuestionMessage(ctx, deps);
  await ctx.answerCallbackQuery();
}

async function handleCancelPoll(ctx: Context, deps: QuestionCallbackDeps): Promise<void> {
  deps.questionManager.cancel();

  await cancelPrompt(ctx, "question.cancelled");
}

export async function handleQuestionTextAnswer(
  ctx: Context,
  deps: QuestionCallbackDeps,
): Promise<void> {
  const text = ctx.message?.text;
  if (!text) return;

  const currentIndex = deps.questionManager.getCurrentIndex();

  if (!deps.questionManager.isWaitingForCustomInput(currentIndex)) {
    await ctx.reply(t("question.use_custom_button_first"));
    return;
  }

  const multiple = deps.questionManager.getCurrentQuestion()?.multiple ?? false;

  if (!multiple && deps.questionManager.hasCustomAnswer(currentIndex)) {
    await ctx.reply(t("question.answer_already_received"));
    return;
  }

  logger.debug(`[QuestionHandler] Custom text answer for question ${currentIndex}: ${text}`);

  deps.questionManager.setCustomAnswer(currentIndex, text);
  deps.questionManager.clearCustomInput();

  const activeMessageId = deps.questionManager.getActiveMessageId();
  if (activeMessageId !== null && ctx.chat) {
    await ctx.api.deleteMessage(ctx.chat.id, activeMessageId).catch(() => {});
  }

  if (multiple) {
    // A multi-select question stays open: re-send it below the user's text with the custom row.
    if (ctx.chat) {
      await showCurrentQuestion(ctx.api, ctx.chat.id, deps);
    }
    return;
  }

  await showNextQuestion(ctx, deps);
}
