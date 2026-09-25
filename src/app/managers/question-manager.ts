import type { Question, QuestionState, QuestionAnswer } from "../types/question.js";
import type { InteractionManager } from "./interaction-manager.js";
import { logger } from "../../utils/logger.js";

export class QuestionManager {
  constructor(private readonly interactionManager: InteractionManager) {}

  private get state(): QuestionState | null {
    return this.interactionManager.getPayload("question");
  }

  /**
   * Opens the question slot, replacing a poll already on screen. Refuses while
   * permission prompts hold the slot: the poll has to wait for them.
   */
  startQuestions(questions: Question[], requestID: string): boolean {
    const current = this.interactionManager.getSnapshot();
    logger.debug(
      `[QuestionManager] startQuestions called: slot=${current?.kind ?? "none"}, newQuestions=${questions.length}, requestID=${requestID}`,
    );

    if (current?.kind === "permission") {
      logger.info(
        `[QuestionManager] Permission prompts are on screen, not starting poll: requestID=${requestID}`,
      );
      return false;
    }

    if (current?.kind === "question") {
      logger.info(`[QuestionManager] Poll already active! Replacing it with the new poll.`);
    }

    logger.info(
      `[QuestionManager] Starting new poll with ${questions.length} questions, requestID=${requestID}`,
    );
    this.interactionManager.start({
      kind: "question",
      expectedInput: "callback",
      payload: {
        questions,
        currentIndex: 0,
        selectedOptions: new Map(),
        customAnswers: new Map(),
        selectedCustomAnswers: new Set(),
        customInputQuestionIndex: null,
        activeMessageId: null,
        messageIds: [],
        requestID,
      },
    });
    return true;
  }

  getRequestID(): string | null {
    return this.state?.requestID ?? null;
  }

  getCurrentQuestion(): Question | null {
    const state = this.state;
    return state?.questions[state.currentIndex] ?? null;
  }

  selectOption(questionIndex: number, optionIndex: number): void {
    const state = this.state;
    if (!state) {
      return;
    }

    const question = state.questions[questionIndex];
    if (!question) {
      return;
    }

    const selected = state.selectedOptions.get(questionIndex) || new Set();

    if (question.multiple) {
      if (selected.has(optionIndex)) {
        selected.delete(optionIndex);
      } else {
        selected.add(optionIndex);
      }
    } else {
      selected.clear();
      selected.add(optionIndex);
    }

    state.selectedOptions.set(questionIndex, selected);

    logger.debug(
      `[QuestionManager] Selected options for question ${questionIndex}: ${Array.from(selected).join(", ")}`,
    );
  }

  getSelectedOptions(questionIndex: number): Set<number> {
    return this.state?.selectedOptions.get(questionIndex) || new Set();
  }

  getSelectedAnswer(questionIndex: number): string {
    const state = this.state;
    const question = state?.questions[questionIndex];
    if (!state || !question) {
      return "";
    }

    const selected = state.selectedOptions.get(questionIndex) || new Set();
    const options = Array.from(selected).flatMap((idx) => {
      const opt = question.options[idx];
      return opt ? [`* ${opt.label}: ${opt.description}`] : [];
    });

    return options.join("\n");
  }

  setCustomAnswer(questionIndex: number, answer: string): void {
    logger.debug(
      `[QuestionManager] Custom answer received for question ${questionIndex}: ${answer}`,
    );
    const state = this.state;
    if (!state) {
      return;
    }

    state.customAnswers.set(questionIndex, answer);
    if (state.questions[questionIndex]?.multiple) {
      state.selectedCustomAnswers.add(questionIndex);
    }
  }

  getCustomAnswer(questionIndex: number): string | undefined {
    return this.state?.customAnswers.get(questionIndex);
  }

  hasCustomAnswer(questionIndex: number): boolean {
    return this.state?.customAnswers.has(questionIndex) ?? false;
  }

  /** Ticks or unticks the custom answer of a multi-select question, like an option. */
  toggleCustomAnswer(questionIndex: number): void {
    const state = this.state;
    if (!state || !state.customAnswers.has(questionIndex)) {
      return;
    }

    if (state.selectedCustomAnswers.has(questionIndex)) {
      state.selectedCustomAnswers.delete(questionIndex);
    } else {
      state.selectedCustomAnswers.add(questionIndex);
    }
  }

  isCustomAnswerSelected(questionIndex: number): boolean {
    return this.state?.selectedCustomAnswers.has(questionIndex) ?? false;
  }

  hasAnswer(questionIndex: number): boolean {
    return this.getAnswerItems(questionIndex).length > 0;
  }

  /**
   * The answer items sent to the agent for one question. A multi-select question
   * sends its ticked options, then the ticked custom answer as one more item.
   */
  getAnswerItems(questionIndex: number): string[] {
    const question = this.state?.questions[questionIndex];
    if (!question) {
      return [];
    }

    const selectedAnswer = this.getSelectedAnswer(questionIndex);
    const customAnswer = this.getCustomAnswer(questionIndex);

    if (!question.multiple) {
      // Each option is formatted as "* Label: Description"
      const answer = customAnswer || selectedAnswer;
      return answer.split("\n").filter((part) => part.trim());
    }

    const items = selectedAnswer.split("\n").filter((part) => part.trim());
    if (customAnswer && this.isCustomAnswerSelected(questionIndex)) {
      items.push(customAnswer);
    }

    return items;
  }

  nextQuestion(): void {
    const state = this.state;
    if (!state) {
      return;
    }

    state.currentIndex++;
    state.customInputQuestionIndex = null;
    state.activeMessageId = null;

    logger.debug(
      `[QuestionManager] Moving to next question: ${state.currentIndex}/${state.questions.length}`,
    );
  }

  hasNextQuestion(): boolean {
    const state = this.state;
    return state !== null && state.currentIndex < state.questions.length;
  }

  getCurrentIndex(): number {
    return this.state?.currentIndex ?? 0;
  }

  getTotalQuestions(): number {
    return this.state?.questions.length ?? 0;
  }

  addMessageId(messageId: number): void {
    this.state?.messageIds.push(messageId);
  }

  setActiveMessageId(messageId: number): void {
    const state = this.state;
    if (state) {
      state.activeMessageId = messageId;
    }
  }

  getActiveMessageId(): number | null {
    return this.state?.activeMessageId ?? null;
  }

  isActiveMessage(messageId: number | null): boolean {
    const activeMessageId = this.getActiveMessageId();
    return activeMessageId !== null && messageId === activeMessageId;
  }

  startCustomInput(questionIndex: number): void {
    const state = this.state;
    if (!state || !state.questions[questionIndex]) {
      return;
    }

    state.customInputQuestionIndex = questionIndex;
  }

  clearCustomInput(): void {
    const state = this.state;
    if (state) {
      state.customInputQuestionIndex = null;
    }
  }

  isWaitingForCustomInput(questionIndex: number): boolean {
    return this.state?.customInputQuestionIndex === questionIndex;
  }

  getMessageIds(): number[] {
    return [...(this.state?.messageIds ?? [])];
  }

  isActive(): boolean {
    const active = this.state !== null;
    logger.debug(`[QuestionManager] isActive check: ${active}`);
    return active;
  }

  cancel(): void {
    logger.info("[QuestionManager] Poll cancelled");
    this.interactionManager.clearKind("question", "question_cancelled");
  }

  clear(): void {
    this.interactionManager.clearKind("question", "question_cleared");
  }

  getAllAnswers(): QuestionAnswer[] {
    const state = this.state;
    const answers: QuestionAnswer[] = [];
    if (!state) {
      return answers;
    }

    for (let i = 0; i < state.questions.length; i++) {
      const question = state.questions[i];
      if (!question) {
        continue;
      }
      const finalAnswer = question.multiple
        ? this.getAnswerItems(i).join("\n")
        : this.getCustomAnswer(i) || this.getSelectedAnswer(i);

      if (finalAnswer) {
        answers.push({
          question: question.question,
          answer: finalAnswer,
        });
      }
    }

    return answers;
  }
}
