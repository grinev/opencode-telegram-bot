import { Context, InlineKeyboard } from "grammy";
import { questionManager } from "../../question/manager.js";
import { opencodeClient } from "../../opencode/client.js";
import { getCurrentProject } from "../../settings/manager.js";
import { getCurrentSession } from "../../session/manager.js";
import { summaryAggregator } from "../../summary/aggregator.js";
import { interactionManager } from "../../interaction/manager.js";
import { logger } from "../../utils/logger.js";
import { safeBackgroundTask } from "../../utils/safe-background-task.js";
import { t } from "../../i18n/index.js";
import { getScopeKeyFromContext, getThreadSendOptions } from "../scope.js";

const MAX_BUTTON_LENGTH = 60;

function getCallbackMessageId(ctx: Context): number | null {
  const message = ctx.callbackQuery?.message;
  if (!message || !("message_id" in message)) {
    return null;
  }

  const messageId = (message as { message_id?: number }).message_id;
  return typeof messageId === "number" ? messageId : null;
}

function clearQuestionInteraction(reason: string, scopeKey: string): void {
  const state = interactionManager.getSnapshot(scopeKey);
  if (state?.kind === "question") {
    interactionManager.clear(reason, scopeKey);
  }
}

function syncQuestionInteractionState(
  expectedInput: "callback" | "mixed",
  questionIndex: number,
  messageId: number | null,
  scopeKey: string,
): void {
  const metadata: Record<string, unknown> = {
    questionIndex,
    inputMode: expectedInput === "mixed" ? "custom" : "options",
  };

  const requestID = questionManager.getRequestID(scopeKey);
  if (requestID) {
    metadata.requestID = requestID;
  }

  if (messageId !== null) {
    metadata.messageId = messageId;
  }

  const state = interactionManager.getSnapshot(scopeKey);
  if (state?.kind === "question") {
    interactionManager.transition(
      {
        expectedInput,
        metadata,
      },
      scopeKey,
    );
    return;
  }

  interactionManager.start(
    {
      kind: "question",
      expectedInput,
      metadata,
    },
    scopeKey,
  );
}

export async function handleQuestionCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith("question:")) {
    return false;
  }

  const scopeKey = getScopeKeyFromContext(ctx);
  const callbackMessageId = getCallbackMessageId(ctx);

  if (
    !questionManager.isActive(scopeKey) ||
    !questionManager.isActiveMessage(callbackMessageId, scopeKey)
  ) {
    clearQuestionInteraction("question_inactive_callback", scopeKey);
    await ctx.answerCallbackQuery({ text: t("question.inactive_callback"), show_alert: true });
    return true;
  }

  const parts = data.split(":");
  const action = parts[1];
  const questionIndex = Number.parseInt(parts[2], 10);
  if (Number.isNaN(questionIndex) || questionIndex !== questionManager.getCurrentIndex(scopeKey)) {
    await ctx.answerCallbackQuery({ text: t("question.inactive_callback"), show_alert: true });
    return true;
  }

  if (action === "cancel") {
    questionManager.cancel(scopeKey);
    clearQuestionInteraction("question_cancelled", scopeKey);
    await ctx.editMessageText(t("question.cancelled")).catch(() => {});
    await ctx.answerCallbackQuery();
    questionManager.clear(scopeKey);
    return true;
  }

  if (action === "custom") {
    questionManager.startCustomInput(questionIndex, scopeKey);
    syncQuestionInteractionState(
      "mixed",
      questionIndex,
      questionManager.getActiveMessageId(scopeKey),
      scopeKey,
    );
    await ctx.answerCallbackQuery({ text: t("question.enter_custom_callback"), show_alert: true });
    return true;
  }

  if (action === "select") {
    const optionIndex = Number.parseInt(parts[3], 10);
    if (Number.isNaN(optionIndex)) {
      await ctx.answerCallbackQuery({
        text: t("question.processing_error_callback"),
        show_alert: true,
      });
      return true;
    }

    questionManager.selectOption(questionIndex, optionIndex, scopeKey);
    const question = questionManager.getCurrentQuestion(scopeKey);
    if (!question) {
      return true;
    }

    if (question.multiple) {
      await updateQuestionMessage(ctx, scopeKey);
      await ctx.answerCallbackQuery();
      return true;
    }

    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(() => {});
    await showNextQuestion(ctx, scopeKey);
    return true;
  }

  if (action === "submit") {
    const answer = questionManager.getSelectedAnswer(questionIndex, scopeKey);
    if (!answer) {
      await ctx.answerCallbackQuery({
        text: t("question.select_one_required_callback"),
        show_alert: true,
      });
      return true;
    }

    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(() => {});
    await showNextQuestion(ctx, scopeKey);
    return true;
  }

  await ctx.answerCallbackQuery({
    text: t("question.processing_error_callback"),
    show_alert: true,
  });
  return true;
}

async function updateQuestionMessage(ctx: Context, scopeKey: string): Promise<void> {
  const question = questionManager.getCurrentQuestion(scopeKey);
  if (!question) {
    return;
  }

  await ctx
    .editMessageText(formatQuestionText(question, scopeKey), {
      reply_markup: buildQuestionKeyboard(
        question,
        questionManager.getSelectedOptions(questionManager.getCurrentIndex(scopeKey), scopeKey),
        scopeKey,
      ),
      parse_mode: "Markdown",
    })
    .catch(() => {});
}

export async function showCurrentQuestion(
  bot: Context["api"],
  chatId: number,
  scopeKey: string,
  threadId: number | null,
): Promise<void> {
  const question = questionManager.getCurrentQuestion(scopeKey);
  if (!question) {
    await showPollSummary(bot, chatId, scopeKey, threadId);
    return;
  }

  const message = await bot.sendMessage(chatId, formatQuestionText(question, scopeKey), {
    reply_markup: buildQuestionKeyboard(
      question,
      questionManager.getSelectedOptions(questionManager.getCurrentIndex(scopeKey), scopeKey),
      scopeKey,
    ),
    parse_mode: "Markdown",
    ...getThreadSendOptions(threadId),
  });

  questionManager.addMessageId(message.message_id, scopeKey);
  questionManager.setActiveMessageId(message.message_id, scopeKey);
  syncQuestionInteractionState(
    "callback",
    questionManager.getCurrentIndex(scopeKey),
    questionManager.getActiveMessageId(scopeKey),
    scopeKey,
  );
  summaryAggregator.stopTypingIndicator();
}

export async function handleQuestionTextAnswer(ctx: Context): Promise<void> {
  const text = ctx.message?.text;
  if (!text) return;

  const scopeKey = getScopeKeyFromContext(ctx);
  const currentIndex = questionManager.getCurrentIndex(scopeKey);

  if (!questionManager.isWaitingForCustomInput(currentIndex, scopeKey)) {
    await ctx.reply(t("question.use_custom_button_first"));
    return;
  }

  questionManager.setCustomAnswer(currentIndex, text, scopeKey);
  questionManager.clearCustomInput(scopeKey);

  const activeMessageId = questionManager.getActiveMessageId(scopeKey);
  if (activeMessageId !== null && ctx.chat) {
    await ctx.api.deleteMessage(ctx.chat.id, activeMessageId).catch(() => {});
  }

  await showNextQuestion(ctx, scopeKey);
}

async function showNextQuestion(ctx: Context, scopeKey: string): Promise<void> {
  questionManager.nextQuestion(scopeKey);
  if (!ctx.chat) {
    return;
  }

  const threadId =
    typeof ctx.message?.message_thread_id === "number" ? ctx.message.message_thread_id : null;
  if (questionManager.hasNextQuestion(scopeKey)) {
    await showCurrentQuestion(ctx.api, ctx.chat.id, scopeKey, threadId);
  } else {
    await showPollSummary(ctx.api, ctx.chat.id, scopeKey, threadId);
  }
}

async function showPollSummary(
  bot: Context["api"],
  chatId: number,
  scopeKey: string,
  threadId: number | null,
): Promise<void> {
  const answers = questionManager.getAllAnswers(scopeKey);
  await sendAllAnswersToAgent(bot, chatId, scopeKey, threadId);

  if (answers.length === 0) {
    await bot.sendMessage(
      chatId,
      t("question.completed_no_answers"),
      getThreadSendOptions(threadId),
    );
  } else {
    await bot.sendMessage(chatId, formatAnswersSummary(answers), getThreadSendOptions(threadId));
  }

  clearQuestionInteraction("question_completed", scopeKey);
  questionManager.clear(scopeKey);
}

async function sendAllAnswersToAgent(
  bot: Context["api"],
  chatId: number,
  scopeKey: string,
  threadId: number | null,
): Promise<void> {
  const currentProject = getCurrentProject();
  const currentSession = getCurrentSession(scopeKey);
  const requestID = questionManager.getRequestID(scopeKey);
  const totalQuestions = questionManager.getTotalQuestions(scopeKey);
  const directory = currentSession?.directory ?? currentProject?.worktree;

  if (!directory) {
    await bot.sendMessage(chatId, t("question.no_active_project"), getThreadSendOptions(threadId));
    return;
  }

  if (!requestID) {
    await bot.sendMessage(chatId, t("question.no_active_request"), getThreadSendOptions(threadId));
    return;
  }

  const allAnswers: string[][] = [];
  for (let i = 0; i < totalQuestions; i++) {
    const answer =
      questionManager.getCustomAnswer(i, scopeKey) ||
      questionManager.getSelectedAnswer(i, scopeKey) ||
      "";
    allAnswers.push(answer ? answer.split("\n").filter((part) => part.trim()) : []);
  }

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
        void bot
          .sendMessage(chatId, t("question.send_answers_error"), getThreadSendOptions(threadId))
          .catch(() => {});
      }
    },
  });
}

function formatQuestionText(
  question: {
    header: string;
    question: string;
    multiple?: boolean;
  },
  scopeKey: string,
): string {
  const currentIndex = questionManager.getCurrentIndex(scopeKey);
  const totalQuestions = questionManager.getTotalQuestions(scopeKey);
  const progressText = totalQuestions > 0 ? `${currentIndex + 1}/${totalQuestions}` : "";

  const headerTitle = [progressText, question.header].filter(Boolean).join(" ");
  const header = headerTitle ? `**${headerTitle}**\n\n` : "";
  const multiple = question.multiple ? t("question.multi_hint") : "";
  return `${header}${question.question}${multiple}`;
}

function buildQuestionKeyboard(
  question: { options: Array<{ label: string; description: string }>; multiple?: boolean },
  selectedOptions: Set<number>,
  scopeKey: string,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const questionIndex = questionManager.getCurrentIndex(scopeKey);

  question.options.forEach((option, index) => {
    const isSelected = selectedOptions.has(index);
    const icon = isSelected ? "✅ " : "";
    const buttonText = formatButtonText(option.label, option.description, icon);
    keyboard.text(buttonText, `question:select:${questionIndex}:${index}`).row();
  });

  if (question.multiple) {
    keyboard.text(t("question.button.submit"), `question:submit:${questionIndex}`).row();
  }

  keyboard.text(t("question.button.custom"), `question:custom:${questionIndex}`).row();
  keyboard.text(t("question.button.cancel"), `question:cancel:${questionIndex}`);
  return keyboard;
}

function formatButtonText(label: string, description: string, icon: string): string {
  let text = `${icon}${label}`;
  if (description && icon === "") {
    text += ` - ${description}`;
  }

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
