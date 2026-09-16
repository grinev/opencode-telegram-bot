import type { Question, QuestionState, QuestionAnswer } from "../types/question.js";
import { interactionManager } from "./interaction-manager.js";
import { logger } from "../../utils/logger.js";

class QuestionManager {
  private get state(): QuestionState | null {
    return interactionManager.getPayload("question");
  }

  /**
   * Opens the question slot, replacing a poll already on screen. Refuses while
   * permission prompts hold the slot: the poll has to wait for them.
   */
  startQuestions(questions: Question[], requestID: string): boolean {
    const current = interactionManager.getSnapshot();
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
    interactionManager.start({
      kind: "question",
      expectedInput: "callback",
      payload: {
        questions,
        currentIndex: 0,
        selectedOptions: new Map(),
        customAnswers: new Map(),
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
    this.state?.customAnswers.set(questionIndex, answer);
  }

  getCustomAnswer(questionIndex: number): string | undefined {
    return this.state?.customAnswers.get(questionIndex);
  }

  hasCustomAnswer(questionIndex: number): boolean {
    return this.state?.customAnswers.has(questionIndex) ?? false;
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
    interactionManager.clearKind("question", "question_cancelled");
  }

  clear(): void {
    interactionManager.clearKind("question", "question_cleared");
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
      const selectedAnswer = this.getSelectedAnswer(i);
      const customAnswer = this.getCustomAnswer(i);

      const finalAnswer = customAnswer || selectedAnswer;

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

export const questionManager = new QuestionManager();
