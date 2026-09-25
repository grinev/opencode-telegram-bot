import { beforeEach, describe, expect, it } from "vitest";
import { QuestionManager } from "../../../src/app/managers/question-manager.js";
import type { Question } from "../../../src/app/types/question.js";
import { InteractionManager } from "../../../src/app/managers/interaction-manager.js";

const SINGLE_QUESTION: Question = {
  question: "Pick one option",
  header: "single",
  options: [
    { label: "Yes", description: "accept" },
    { label: "No", description: "decline" },
  ],
};

const MULTIPLE_QUESTION: Question = {
  question: "Pick multiple options",
  header: "multiple",
  multiple: true,
  options: [
    { label: "Alpha", description: "first" },
    { label: "Beta", description: "second" },
    { label: "Gamma", description: "third" },
  ],
};

let questionManager: QuestionManager;

beforeEach(() => {
  questionManager = new QuestionManager(new InteractionManager());
});

describe("questionManager", () => {
  it("starts poll and moves through questions", () => {
    questionManager.startQuestions([SINGLE_QUESTION, MULTIPLE_QUESTION], "req-1");

    expect(questionManager.isActive()).toBe(true);
    expect(questionManager.getRequestID()).toBe("req-1");
    expect(questionManager.getCurrentIndex()).toBe(0);
    expect(questionManager.getCurrentQuestion()?.question).toBe(SINGLE_QUESTION.question);

    questionManager.nextQuestion();
    expect(questionManager.getCurrentIndex()).toBe(1);
    expect(questionManager.getCurrentQuestion()?.question).toBe(MULTIPLE_QUESTION.question);

    questionManager.nextQuestion();
    expect(questionManager.hasNextQuestion()).toBe(false);
    expect(questionManager.getCurrentQuestion()).toBeNull();
  });

  it("resets previous active poll when starting a new one", () => {
    questionManager.startQuestions([SINGLE_QUESTION], "req-old");
    questionManager.selectOption(0, 1);
    questionManager.addMessageId(42);

    questionManager.startQuestions([MULTIPLE_QUESTION], "req-new");

    expect(questionManager.getRequestID()).toBe("req-new");
    expect(questionManager.getTotalQuestions()).toBe(1);
    expect(questionManager.getSelectedOptions(0)).toEqual(new Set<number>());
    expect(questionManager.getMessageIds()).toEqual([]);
  });

  it("handles single-choice and multiple-choice selections", () => {
    questionManager.startQuestions([SINGLE_QUESTION, MULTIPLE_QUESTION], "req-2");

    questionManager.selectOption(0, 0);
    questionManager.selectOption(0, 1);
    expect(questionManager.getSelectedOptions(0)).toEqual(new Set([1]));
    expect(questionManager.getSelectedAnswer(0)).toBe("* No: decline");

    questionManager.selectOption(1, 0);
    questionManager.selectOption(1, 1);
    questionManager.selectOption(1, 0);
    expect(questionManager.getSelectedOptions(1)).toEqual(new Set([1]));
    expect(questionManager.getSelectedAnswer(1)).toBe("* Beta: second");
  });

  it("stores custom answers per question and adds them after the ticked options", () => {
    questionManager.startQuestions([SINGLE_QUESTION, MULTIPLE_QUESTION], "req-3");

    questionManager.selectOption(0, 1);
    questionManager.selectOption(1, 0);
    questionManager.setCustomAnswer(1, "Custom response for question #2");

    expect(questionManager.hasCustomAnswer(1)).toBe(true);
    expect(questionManager.getCustomAnswer(1)).toBe("Custom response for question #2");
    expect(questionManager.isCustomAnswerSelected(1)).toBe(true);

    const answers = questionManager.getAllAnswers();
    expect(answers).toEqual([
      { question: SINGLE_QUESTION.question, answer: "* No: decline" },
      {
        question: MULTIPLE_QUESTION.question,
        answer: "* Alpha: first\nCustom response for question #2",
      },
    ]);
  });

  it("builds multi-select answer items from ticked options and the ticked custom text", () => {
    questionManager.startQuestions([MULTIPLE_QUESTION], "req-3c");

    questionManager.setCustomAnswer(0, "Line one\nline two");
    questionManager.selectOption(0, 2);
    questionManager.selectOption(0, 0);

    expect(questionManager.getAnswerItems(0)).toEqual([
      "* Gamma: third",
      "* Alpha: first",
      "Line one\nline two",
    ]);

    questionManager.toggleCustomAnswer(0);
    expect(questionManager.isCustomAnswerSelected(0)).toBe(false);
    expect(questionManager.getAnswerItems(0)).toEqual(["* Gamma: third", "* Alpha: first"]);
    expect(questionManager.getAllAnswers()).toEqual([
      { question: MULTIPLE_QUESTION.question, answer: "* Gamma: third\n* Alpha: first" },
    ]);

    questionManager.selectOption(0, 2);
    questionManager.selectOption(0, 0);
    expect(questionManager.hasAnswer(0)).toBe(false);

    questionManager.toggleCustomAnswer(0);
    expect(questionManager.hasAnswer(0)).toBe(true);
    expect(questionManager.getAnswerItems(0)).toEqual(["Line one\nline two"]);
  });

  it("keeps single-select custom answers first and split by line breaks", () => {
    questionManager.startQuestions([SINGLE_QUESTION], "req-3d");

    questionManager.setCustomAnswer(0, "First line\nSecond line");

    expect(questionManager.isCustomAnswerSelected(0)).toBe(false);
    expect(questionManager.getAnswerItems(0)).toEqual(["First line", "Second line"]);
    expect(questionManager.getAllAnswers()).toEqual([
      { question: SINGLE_QUESTION.question, answer: "First line\nSecond line" },
    ]);
  });

  it("does not toggle a custom answer that was never entered", () => {
    questionManager.startQuestions([MULTIPLE_QUESTION], "req-3e");

    questionManager.toggleCustomAnswer(0);

    expect(questionManager.isCustomAnswerSelected(0)).toBe(false);
    expect(questionManager.hasAnswer(0)).toBe(false);
  });

  it("tracks custom input mode and active message id", () => {
    questionManager.startQuestions([SINGLE_QUESTION, MULTIPLE_QUESTION], "req-3b");

    expect(questionManager.getActiveMessageId()).toBeNull();
    expect(questionManager.isWaitingForCustomInput(0)).toBe(false);

    questionManager.setActiveMessageId(123);
    expect(questionManager.isActiveMessage(123)).toBe(true);
    expect(questionManager.isActiveMessage(999)).toBe(false);

    questionManager.startCustomInput(0);
    expect(questionManager.isWaitingForCustomInput(0)).toBe(true);

    questionManager.nextQuestion();
    expect(questionManager.getActiveMessageId()).toBeNull();
    expect(questionManager.isWaitingForCustomInput(0)).toBe(false);
  });

  it("returns copied message IDs and supports cancel/clear", () => {
    questionManager.startQuestions([SINGLE_QUESTION], "req-4");
    questionManager.addMessageId(10);
    questionManager.addMessageId(11);

    const messageIds = questionManager.getMessageIds();
    messageIds.push(999);
    expect(questionManager.getMessageIds()).toEqual([10, 11]);

    questionManager.cancel();
    expect(questionManager.isActive()).toBe(false);

    questionManager.clear();
    expect(questionManager.getTotalQuestions()).toBe(0);
    expect(questionManager.getRequestID()).toBeNull();
    expect(questionManager.getCurrentQuestion()).toBeNull();
  });
});
