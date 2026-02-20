import { Question, QuestionState, QuestionAnswer } from "./types.js";
import { logger } from "../utils/logger.js";

class QuestionManager {
  private state: QuestionState = {
    questions: [],
    currentIndex: 0,
    selectedOptions: new Map(),
    customAnswers: new Map(),
    customInputQuestionIndex: null,
    activeMessageId: null,
    messageIds: [],
    isActive: false,
    requestID: null,
  };

  startQuestions(questions: Question[], requestID: string): void {
    logger.debug(
      `[QuestionManager] startQuestions called: isActive=${this.state.isActive}, currentQuestions=${this.state.questions.length}, newQuestions=${questions.length}, requestID=${requestID}`,
    );

    if (this.state.isActive) {
      logger.info(`[QuestionManager] Poll already active! Forcing reset before starting new poll.`);
      // Force-reset the previous poll before starting a new one
      this.clear();
    }

    logger.info(
      `[QuestionManager] Starting new poll with ${questions.length} questions, requestID=${requestID}`,
    );
    this.state = {
      questions,
      currentIndex: 0,
      selectedOptions: new Map(),
      customAnswers: new Map(),
      customInputQuestionIndex: null,
      activeMessageId: null,
      messageIds: [],
      isActive: true,
      requestID,
    };
  }

  getRequestID(): string | null {
    return this.state.requestID;
  }

  getCurrentQuestion(): Question | null {
    if (this.state.currentIndex >= this.state.questions.length) {
      return null;
    }
    return this.state.questions[this.state.currentIndex];
  }

  selectOption(questionIndex: number, optionIndex: number): void {
    if (!this.state.isActive) {
      return;
    }

    const question = this.state.questions[questionIndex];
    if (!question) {
      return;
    }

    const selected = this.state.selectedOptions.get(questionIndex) || new Set();

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

    this.state.selectedOptions.set(questionIndex, selected);

    logger.debug(
      `[QuestionManager] Selected options for question ${questionIndex}: ${Array.from(selected).join(", ")}`,
    );
  }

  getSelectedOptions(questionIndex: number): Set<number> {
    return this.state.selectedOptions.get(questionIndex) || new Set();
  }

  getSelectedAnswer(questionIndex: number): string {
    const question = this.state.questions[questionIndex];
    if (!question) {
      return "";
    }

    const selected = this.state.selectedOptions.get(questionIndex) || new Set();
    const options = Array.from(selected)
      .map((idx) => question.options[idx])
      .filter((opt) => opt)
      .map((opt) => `* ${opt.label}: ${opt.description}`);

    return options.join("\n");
  }

  setCustomAnswer(questionIndex: number, answer: string): void {
    logger.debug(
      `[QuestionManager] Custom answer received for question ${questionIndex}: ${answer}`,
    );
    this.state.customAnswers.set(questionIndex, answer);
  }

  getCustomAnswer(questionIndex: number): string | undefined {
    return this.state.customAnswers.get(questionIndex);
  }

  hasCustomAnswer(questionIndex: number): boolean {
    return this.state.customAnswers.has(questionIndex);
  }

  nextQuestion(): void {
    this.state.currentIndex++;
    this.state.customInputQuestionIndex = null;
    this.state.activeMessageId = null;

    logger.debug(
      `[QuestionManager] Moving to next question: ${this.state.currentIndex}/${this.state.questions.length}`,
    );
  }

  hasNextQuestion(): boolean {
    return this.state.currentIndex < this.state.questions.length;
  }

  getCurrentIndex(): number {
    return this.state.currentIndex;
  }

  getTotalQuestions(): number {
    return this.state.questions.length;
  }

  addMessageId(messageId: number): void {
    this.state.messageIds.push(messageId);
  }

  setActiveMessageId(messageId: number): void {
    this.state.activeMessageId = messageId;
  }

  getActiveMessageId(): number | null {
    return this.state.activeMessageId;
  }

  isActiveMessage(messageId: number | null): boolean {
    return (
      this.state.isActive &&
      this.state.activeMessageId !== null &&
      messageId === this.state.activeMessageId
    );
  }

  startCustomInput(questionIndex: number): void {
    if (!this.state.isActive || !this.state.questions[questionIndex]) {
      return;
    }

    this.state.customInputQuestionIndex = questionIndex;
  }

  clearCustomInput(): void {
    this.state.customInputQuestionIndex = null;
  }

  isWaitingForCustomInput(questionIndex: number): boolean {
    return this.state.customInputQuestionIndex === questionIndex;
  }

  getMessageIds(): number[] {
    return [...this.state.messageIds];
  }

  isActive(): boolean {
    logger.debug(
      `[QuestionManager] isActive check: ${this.state.isActive}, questions=${this.state.questions.length}, currentIndex=${this.state.currentIndex}`,
    );
    return this.state.isActive;
  }

  cancel(): void {
    logger.info("[QuestionManager] Poll cancelled");
    this.state.isActive = false;
    this.state.customInputQuestionIndex = null;
    this.state.activeMessageId = null;
  }

  clear(): void {
    this.state = {
      questions: [],
      currentIndex: 0,
      selectedOptions: new Map(),
      customAnswers: new Map(),
      customInputQuestionIndex: null,
      activeMessageId: null,
      messageIds: [],
      isActive: false,
      requestID: null,
    };
  }

  getAllAnswers(): QuestionAnswer[] {
    const answers: QuestionAnswer[] = [];

    for (let i = 0; i < this.state.questions.length; i++) {
      const question = this.state.questions[i];
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
