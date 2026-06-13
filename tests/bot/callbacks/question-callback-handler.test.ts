import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { questionManager } from "../../../src/app/managers/question-manager.js";
import { interactionManager } from "../../../src/app/managers/interaction-manager.js";
import { showCurrentQuestion } from "../../../src/bot/menus/question-menu.js";
import {
  handleQuestionCallback,
  handleQuestionTextAnswer,
} from "../../../src/bot/callbacks/question-callback-handler.js";
import type { Question } from "../../../src/app/types/question.js";
import { t } from "../../../src/i18n/index.js";

const QUESTION_ONE: Question = {
  header: "Q1",
  question: "Pick one",
  options: [
    { label: "Yes", description: "accept" },
    { label: "No", description: "decline" },
  ],
};

const QUESTION_TWO: Question = {
  header: "Q2",
  question: "Second question",
  options: [
    { label: "Alpha", description: "first" },
    { label: "Beta", description: "second" },
  ],
};

const MULTIPLE_QUESTION: Question = {
  header: "Q multi",
  question: "Pick multiple",
  multiple: true,
  options: [
    { label: "One", description: "1" },
    { label: "Two", description: "2" },
  ],
};

function createApi(sendMessageIds: number[]): Context["api"] {
  let index = 0;

  return {
    sendMessage: vi.fn().mockImplementation(async () => {
      const messageId = sendMessageIds[index] ?? sendMessageIds[sendMessageIds.length - 1] ?? 1;
      index += 1;
      return { message_id: messageId };
    }),
    editMessageText: vi.fn().mockResolvedValue(true),
    deleteMessage: vi.fn().mockResolvedValue(true),
  } as unknown as Context["api"];
}

function createCallbackContext(data: string, messageId: number, api: Context["api"]): Context {
  return {
    chat: { id: 123 },
    callbackQuery: {
      data,
      message: {
        message_id: messageId,
      },
    } as Context["callbackQuery"],
    api,
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

function createTextContext(text: string, api: Context["api"]): Context {
  return {
    chat: { id: 123 },
    message: {
      text,
    } as Context["message"],
    api,
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

describe("bot question menu/callbacks", () => {
  beforeEach(() => {
    questionManager.clear();
    interactionManager.clear("test_setup");
  });

  it("shows question details and keyboard in one message", async () => {
    const api = createApi([100]);

    questionManager.startQuestions([QUESTION_ONE], "req-1");
    await showCurrentQuestion(api, 123);

    expect(api.sendMessage).toHaveBeenNthCalledWith(
      1,
      123,
      expect.stringContaining("❓ 1/1 Q1\n\nPick one\n\nYes — accept\n\nNo — decline"),
      {
        entities: [
          { type: "bold", offset: 0, length: 8 },
          { type: "bold", offset: 20, length: 3 },
          { type: "bold", offset: 34, length: 2 },
        ],
        reply_markup: expect.objectContaining({
          inline_keyboard: expect.arrayContaining([
            [{ text: "Yes", callback_data: "question:select:0:0" }],
            [{ text: "No", callback_data: "question:select:0:1" }],
          ]),
        }),
      },
    );
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    expect(questionManager.getMessageIds()).toEqual([100]);
    expect(questionManager.getActiveMessageId()).toBe(100);

    const state = interactionManager.getSnapshot();
    expect(state?.kind).toBe("question");
    expect(state?.expectedInput).toBe("callback");
    expect(state?.metadata.requestID).toBe("req-1");
    expect(state?.metadata.messageId).toBe(100);
    expect(state?.metadata.questionIndex).toBe(0);
  });

  it("falls back to raw question text when formatted send fails", async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error("Bad Request: can't parse entities"))
      .mockResolvedValueOnce({ message_id: 801 });
    const api = {
      sendMessage,
      editMessageText: vi.fn().mockResolvedValue(true),
      deleteMessage: vi.fn().mockResolvedValue(true),
    } as unknown as Context["api"];

    questionManager.startQuestions([QUESTION_ONE], "req-fallback");
    await showCurrentQuestion(api, 123);

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenNthCalledWith(
      1,
      123,
      expect.stringContaining("❓ 1/1 Q1\n\nPick one\n\nYes — accept\n\nNo — decline"),
      expect.objectContaining({
        entities: expect.any(Array),
        reply_markup: expect.anything(),
      }),
    );
    expect(sendMessage).toHaveBeenNthCalledWith(
      2,
      123,
      expect.stringContaining("❓ 1/1 Q1\n\nPick one\n\nYes — accept\n\nNo — decline"),
      expect.not.objectContaining({ entities: expect.anything() }),
    );
    expect(questionManager.getActiveMessageId()).toBe(801);
  });

  it("truncates long question text to Telegram message limit", async () => {
    const api = createApi([901]);
    const longQuestion: Question = {
      header: "Long",
      question: "Q".repeat(5000),
      options: [{ label: "Option", description: "description" }],
    };

    questionManager.startQuestions([longQuestion], "req-long");
    await showCurrentQuestion(api, 123);

    const calls = (api.sendMessage as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const sentText = calls[0][1] as string;
    const options = calls[0][2] as { entities?: Array<{ offset: number; length: number }> };

    expect(sentText.length).toBeLessThanOrEqual(4096);
    expect(sentText.endsWith("…")).toBe(true);
    expect(
      options.entities?.every((entity) => entity.offset + entity.length <= sentText.length),
    ).toBe(true);
  });

  it("switches to mixed mode on custom callback and accepts custom text", async () => {
    const api = createApi([101, 102]);

    questionManager.startQuestions([QUESTION_ONE, QUESTION_TWO], "req-2");
    await showCurrentQuestion(api, 123);

    const customCtx = createCallbackContext("question:custom:0", 101, api);
    await handleQuestionCallback(customCtx);

    expect(questionManager.isWaitingForCustomInput(0)).toBe(true);
    expect(interactionManager.getSnapshot()?.expectedInput).toBe("mixed");

    const textCtx = createTextContext("My custom answer", api);
    await handleQuestionTextAnswer(textCtx);

    expect(questionManager.getCustomAnswer(0)).toBe("My custom answer");
    expect(questionManager.getCurrentIndex()).toBe(1);
    expect(questionManager.getActiveMessageId()).toBe(102);
    expect(interactionManager.getSnapshot()?.expectedInput).toBe("callback");

    expect(api.deleteMessage).toHaveBeenCalledWith(123, 101);
  });

  it("deletes the question message after single-choice selection", async () => {
    const api = createApi([701, 702]);

    questionManager.startQuestions([QUESTION_ONE, QUESTION_TWO], "req-8");
    await showCurrentQuestion(api, 123);

    const selectCtx = createCallbackContext("question:select:0:0", 701, api);
    const handled = await handleQuestionCallback(selectCtx);

    expect(handled).toBe(true);
    expect(selectCtx.deleteMessage).toHaveBeenCalledOnce();
    expect(questionManager.getCurrentIndex()).toBe(1);
    expect(questionManager.getActiveMessageId()).toBe(702);
  });

  it("rejects stale callback from old question message", async () => {
    const api = createApi([200]);

    questionManager.startQuestions([QUESTION_ONE], "req-3");
    await showCurrentQuestion(api, 123);

    const staleCtx = createCallbackContext("question:select:0:0", 199, api);
    const handled = await handleQuestionCallback(staleCtx);

    expect(handled).toBe(true);
    expect(staleCtx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("question.inactive_callback"),
      show_alert: true,
    });
    expect(questionManager.getSelectedOptions(0)).toEqual(new Set<number>());
  });

  it("cancels poll and clears question interaction", async () => {
    const api = createApi([300]);

    questionManager.startQuestions([QUESTION_ONE], "req-4");
    await showCurrentQuestion(api, 123);

    const cancelCtx = createCallbackContext("question:cancel:0", 300, api);
    const handled = await handleQuestionCallback(cancelCtx);

    expect(handled).toBe(true);
    expect(cancelCtx.editMessageText).toHaveBeenCalledWith(t("question.cancelled"));
    expect(api.deleteMessage).not.toHaveBeenCalled();
    expect(questionManager.isActive()).toBe(false);
    expect(questionManager.getTotalQuestions()).toBe(0);
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("requires at least one selected option on multiple submit", async () => {
    const api = createApi([400]);

    questionManager.startQuestions([MULTIPLE_QUESTION], "req-5");
    await showCurrentQuestion(api, 123);

    const submitCtx = createCallbackContext("question:submit:0", 400, api);
    const handled = await handleQuestionCallback(submitCtx);

    expect(handled).toBe(true);
    expect(submitCtx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("question.select_one_required_callback"),
      show_alert: true,
    });
    expect(questionManager.isActive()).toBe(true);
  });

  it("updates question message on multiple selection with compact button label", async () => {
    const api = createApi([500]);

    questionManager.startQuestions([MULTIPLE_QUESTION], "req-6");
    await showCurrentQuestion(api, 123);

    const selectCtx = createCallbackContext("question:select:0:0", 500, api);
    const handled = await handleQuestionCallback(selectCtx);

    expect(handled).toBe(true);
    expect(api.editMessageText).toHaveBeenCalledWith(
      123,
      500,
      expect.stringContaining(
        `❓ 1/1 Q multi\n\nPick multiple${t("question.multi_hint")}\n\nOne — 1\n\nTwo — 2`,
      ),
      {
        entities: expect.arrayContaining([
          { type: "bold", offset: 0, length: 13 },
          expect.objectContaining({ type: "bold", length: 3 }),
          expect.objectContaining({ type: "bold", length: 3 }),
        ]),
        reply_markup: expect.objectContaining({
          inline_keyboard: expect.arrayContaining([
            [{ text: "✅ One", callback_data: "question:select:0:0" }],
            [{ text: "Two", callback_data: "question:select:0:1" }],
          ]),
        }),
      },
    );
  });

  it("keeps requiring custom button before accepting text answer", async () => {
    const api = createApi([600]);

    questionManager.startQuestions([QUESTION_ONE], "req-7");
    await showCurrentQuestion(api, 123);

    const textCtx = createTextContext("Typed without custom button", api);
    await handleQuestionTextAnswer(textCtx);

    expect(textCtx.reply).toHaveBeenCalledWith(t("question.use_custom_button_first"));
    expect(questionManager.getCurrentIndex()).toBe(0);
  });
});
