import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { showCurrentQuestion } from "../../../src/bot/menus/question-menu.js";
import {
  handleQuestionCallback,
  handleQuestionTextAnswer,
} from "../../../src/bot/callbacks/question-callback-handler.js";
import type { Question } from "../../../src/app/types/question.js";
import { t } from "../../../src/i18n/index.js";
import { defined } from "../../helpers/defined.js";
import { createTestAppContainer } from "../../helpers/app-container.js";
import type { AppContainer } from "../../../src/app/bootstrap/app-container.js";

const mocked = vi.hoisted(() => ({
  questionReplyMock: vi.fn(),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    question: {
      reply: mocked.questionReplyMock,
    },
  },
}));

vi.mock("../../../src/app/stores/settings-store.js", () => ({
  getCurrentProject: vi.fn(() => ({ id: "project-1", worktree: "D:/repo" })),
}));

vi.mock("../../../src/app/services/session-service.js", () => ({
  getCurrentSession: vi.fn(() => null),
}));

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

  const nextMessage = async () => {
    const messageId = sendMessageIds[index] ?? sendMessageIds[sendMessageIds.length - 1] ?? 1;
    index += 1;
    return { message_id: messageId };
  };

  return {
    sendMessage: vi.fn().mockImplementation(nextMessage),
    sendRichMessage: vi.fn().mockImplementation(nextMessage),
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

async function pressButton(data: string, messageId: number, api: Context["api"]): Promise<void> {
  await handleQuestionCallback(createCallbackContext(data, messageId, api), createDeps());
}

function createDeps() {
  return container;
}

let container: AppContainer;

beforeEach(() => {
  container = createTestAppContainer();
});

describe("bot question menu/callbacks", () => {
  beforeEach(() => {
    container.questionManager.clear();
    container.interactionManager.clear("test_setup");
    mocked.questionReplyMock.mockReset();
    mocked.questionReplyMock.mockResolvedValue({ data: true, error: undefined });
  });

  it("shows question details and keyboard in one message", async () => {
    const api = createApi([100]);

    container.questionManager.startQuestions([QUESTION_ONE], "req-1");
    await showCurrentQuestion(api, 123, createDeps());

    expect(api.sendRichMessage).toHaveBeenNthCalledWith(
      1,
      123,
      {
        blocks: [
          { type: "paragraph", text: { type: "bold", text: "❓ 1/1 Q1" } },
          { type: "paragraph", text: "Pick one" },
          { type: "paragraph", text: [{ type: "bold", text: "Yes" }, " — accept"] },
          { type: "paragraph", text: [{ type: "bold", text: "No" }, " — decline"] },
        ],
      },
      {
        reply_markup: expect.objectContaining({
          inline_keyboard: expect.arrayContaining([
            [{ text: "Yes", callback_data: "question:select:0:0" }],
            [{ text: "No", callback_data: "question:select:0:1" }],
          ]),
        }),
      },
    );
    expect(api.sendRichMessage).toHaveBeenCalledTimes(1);
    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(container.questionManager.getMessageIds()).toEqual([100]);
    expect(container.questionManager.getActiveMessageId()).toBe(100);

    const state = container.interactionManager.getSnapshot();
    expect(state?.kind).toBe("question");
    expect(state?.expectedInput).toBe("callback");
    expect(state?.metadata.requestID).toBe("req-1");
    expect(state?.metadata.messageId).toBe(100);
    expect(state?.metadata.questionIndex).toBe(0);
  });

  it("falls back to raw question text when the native send fails", async () => {
    const sendMessage = vi.fn().mockResolvedValueOnce({ message_id: 801 });
    const sendRichMessage = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("Bad Request: RICH_MESSAGE_BLOCK_UNSUPPORTED"), { error_code: 400 }),
      );
    const api = {
      sendMessage,
      sendRichMessage,
      editMessageText: vi.fn().mockResolvedValue(true),
      deleteMessage: vi.fn().mockResolvedValue(true),
    } as unknown as Context["api"];

    container.questionManager.startQuestions([QUESTION_ONE], "req-fallback");
    await showCurrentQuestion(api, 123, createDeps());

    expect(sendRichMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenNthCalledWith(
      1,
      123,
      expect.stringContaining("❓ 1/1 Q1\n\nPick one\n\nYes — accept\n\nNo — decline"),
      expect.objectContaining({ reply_markup: expect.anything() }),
    );
    expect(container.questionManager.getActiveMessageId()).toBe(801);
  });

  it("renders an option without a description as a bold label only", async () => {
    const api = createApi([902]);
    const question: Question = {
      header: "Bare",
      question: "Choose",
      options: [{ label: "Only label", description: "" }],
    };

    container.questionManager.startQuestions([question], "req-bare");
    await showCurrentQuestion(api, 123, createDeps());

    const calls = (api.sendRichMessage as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const message = defined(calls[0]?.[1]) as { blocks: unknown[] };

    expect(message.blocks.at(-1)).toEqual({
      type: "paragraph",
      text: { type: "bold", text: "Only label" },
    });
  });

  it("truncates long question text to Telegram message limit", async () => {
    const api = createApi([901]);
    const longQuestion: Question = {
      header: "Long",
      question: "Q".repeat(5000),
      options: [{ label: "Option", description: "description" }],
    };

    container.questionManager.startQuestions([longQuestion], "req-long");
    await showCurrentQuestion(api, 123, createDeps());

    const calls = (api.sendRichMessage as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const message = defined(calls[0]?.[1]) as { blocks: Array<{ text: unknown }> };

    const flatten = (text: unknown): string => {
      if (typeof text === "string") {
        return text;
      }
      if (Array.isArray(text)) {
        return text.map(flatten).join("");
      }
      if (text && typeof text === "object" && "text" in text) {
        return flatten((text as { text: unknown }).text);
      }
      return "";
    };

    const rendered = message.blocks.map((block) => flatten(block.text));
    expect(rendered.join("\n\n").length).toBeLessThanOrEqual(4096);
    expect(rendered.at(-1)?.endsWith("…")).toBe(true);
  });

  it("switches to mixed mode on custom callback and accepts custom text", async () => {
    const api = createApi([101, 102]);

    container.questionManager.startQuestions([QUESTION_ONE, QUESTION_TWO], "req-2");
    await showCurrentQuestion(api, 123, createDeps());

    const customCtx = createCallbackContext("question:custom:0", 101, api);
    await handleQuestionCallback(customCtx, createDeps());

    expect(container.questionManager.isWaitingForCustomInput(0)).toBe(true);
    expect(container.interactionManager.getSnapshot()?.expectedInput).toBe("mixed");

    const textCtx = createTextContext("My custom answer", api);
    await handleQuestionTextAnswer(textCtx, createDeps());

    expect(container.questionManager.getCustomAnswer(0)).toBe("My custom answer");
    expect(container.questionManager.getCurrentIndex()).toBe(1);
    expect(container.questionManager.getActiveMessageId()).toBe(102);
    expect(container.interactionManager.getSnapshot()?.expectedInput).toBe("callback");

    expect(api.deleteMessage).toHaveBeenCalledWith(123, 101);
  });

  it("deletes the question message after single-choice selection", async () => {
    const api = createApi([701, 702]);

    container.questionManager.startQuestions([QUESTION_ONE, QUESTION_TWO], "req-8");
    await showCurrentQuestion(api, 123, createDeps());

    const selectCtx = createCallbackContext("question:select:0:0", 701, api);
    const handled = await handleQuestionCallback(selectCtx, createDeps());

    expect(handled).toBe(true);
    expect(selectCtx.deleteMessage).toHaveBeenCalledOnce();
    expect(container.questionManager.getCurrentIndex()).toBe(1);
    expect(container.questionManager.getActiveMessageId()).toBe(702);
  });

  it("rejects stale callback from old question message", async () => {
    const api = createApi([200]);

    container.questionManager.startQuestions([QUESTION_ONE], "req-3");
    await showCurrentQuestion(api, 123, createDeps());

    const staleCtx = createCallbackContext("question:select:0:0", 199, api);
    const handled = await handleQuestionCallback(staleCtx, createDeps());

    expect(handled).toBe(true);
    expect(staleCtx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("question.inactive_callback"),
      show_alert: true,
    });
    expect(container.questionManager.getSelectedOptions(0)).toEqual(new Set<number>());
  });

  it("answers the callback when the current question is already gone", async () => {
    const api = createApi([250]);

    container.questionManager.startQuestions([QUESTION_ONE], "req-stale");
    await showCurrentQuestion(api, 123, createDeps());
    // Index past the last question: the message is still active, but there is
    // nothing to answer anymore.
    container.questionManager.nextQuestion();

    const ctx = createCallbackContext("question:select:0:0", 250, api);
    const handled = await handleQuestionCallback(ctx, createDeps());

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("question.inactive_callback"),
      show_alert: true,
    });
  });

  it("cancels poll and clears question interaction", async () => {
    const api = createApi([300]);

    container.questionManager.startQuestions([QUESTION_ONE], "req-4");
    await showCurrentQuestion(api, 123, createDeps());

    const cancelCtx = createCallbackContext("question:cancel:0", 300, api);
    const handled = await handleQuestionCallback(cancelCtx, createDeps());

    expect(handled).toBe(true);
    expect(cancelCtx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("common.cancelled") });
    expect(cancelCtx.editMessageText).toHaveBeenCalledWith(t("question.cancelled"));
    expect(api.deleteMessage).not.toHaveBeenCalled();
    expect(container.questionManager.isActive()).toBe(false);
    expect(container.questionManager.getTotalQuestions()).toBe(0);
    expect(container.interactionManager.getSnapshot()).toBeNull();
  });

  it("requires at least one selected option on multiple submit", async () => {
    const api = createApi([400]);

    container.questionManager.startQuestions([MULTIPLE_QUESTION], "req-5");
    await showCurrentQuestion(api, 123, createDeps());

    const submitCtx = createCallbackContext("question:submit:0", 400, api);
    const handled = await handleQuestionCallback(submitCtx, createDeps());

    expect(handled).toBe(true);
    expect(submitCtx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("question.select_one_required_callback"),
      show_alert: true,
    });
    expect(container.questionManager.isActive()).toBe(true);
  });

  it("updates question message on multiple selection with compact button label", async () => {
    const api = createApi([500]);

    container.questionManager.startQuestions([MULTIPLE_QUESTION], "req-6");
    await showCurrentQuestion(api, 123, createDeps());

    const selectCtx = createCallbackContext("question:select:0:0", 500, api);
    const handled = await handleQuestionCallback(selectCtx, createDeps());

    expect(handled).toBe(true);
    expect(api.editMessageText).toHaveBeenCalledWith(
      123,
      500,
      {
        blocks: [
          { type: "paragraph", text: { type: "bold", text: "❓ 1/1 Q multi" } },
          { type: "paragraph", text: `Pick multiple${t("question.multi_hint")}` },
          { type: "paragraph", text: [{ type: "bold", text: "One" }, " — 1"] },
          { type: "paragraph", text: [{ type: "bold", text: "Two" }, " — 2"] },
        ],
      },
      {
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

    container.questionManager.startQuestions([QUESTION_ONE], "req-7");
    await showCurrentQuestion(api, 123, createDeps());

    const textCtx = createTextContext("Typed without custom button", api);
    await handleQuestionTextAnswer(textCtx, createDeps());

    expect(textCtx.reply).toHaveBeenCalledWith(t("question.use_custom_button_first"));
    expect(container.questionManager.getCurrentIndex()).toBe(0);
  });

  it("keeps a multi-select question open after custom text and re-sends it with the custom row", async () => {
    const api = createApi([800, 801]);

    container.questionManager.startQuestions([MULTIPLE_QUESTION], "req-multi-custom");
    await showCurrentQuestion(api, 123, createDeps());

    await pressButton("question:select:0:1", 800, api);
    await pressButton("question:custom:0", 800, api);
    await handleQuestionTextAnswer(createTextContext("My\nown answer", api), createDeps());

    expect(api.deleteMessage).toHaveBeenCalledWith(123, 800);
    expect(container.questionManager.getCurrentIndex()).toBe(0);
    expect(container.questionManager.getActiveMessageId()).toBe(801);
    expect(container.interactionManager.getSnapshot()?.expectedInput).toBe("callback");
    expect(api.sendRichMessage).toHaveBeenLastCalledWith(123, expect.anything(), {
      reply_markup: expect.objectContaining({
        inline_keyboard: [
          [{ text: "One", callback_data: "question:select:0:0" }],
          [{ text: "✅ Two", callback_data: "question:select:0:1" }],
          [{ text: "✅ ✏️ My own answer", callback_data: "question:toggle_custom:0" }],
          [{ text: t("question.button.submit"), callback_data: "question:submit:0" }],
          [{ text: t("question.button.custom"), callback_data: "question:custom:0" }],
          [{ text: t("question.button.cancel"), callback_data: "question:cancel:0" }],
        ],
      }),
    });
  });

  it("replaces the custom text when a new one is sent to a multi-select question", async () => {
    const api = createApi([810, 811, 812]);

    container.questionManager.startQuestions([MULTIPLE_QUESTION], "req-multi-replace");
    await showCurrentQuestion(api, 123, createDeps());

    await pressButton("question:custom:0", 810, api);
    await handleQuestionTextAnswer(createTextContext("First", api), createDeps());
    await pressButton("question:toggle_custom:0", 811, api);
    await pressButton("question:custom:0", 811, api);
    const textCtx = createTextContext("Second", api);
    await handleQuestionTextAnswer(textCtx, createDeps());

    expect(textCtx.reply).not.toHaveBeenCalled();
    expect(container.questionManager.getCustomAnswer(0)).toBe("Second");
    expect(container.questionManager.isCustomAnswerSelected(0)).toBe(true);
    expect(container.questionManager.getActiveMessageId()).toBe(812);
  });

  it("toggles the custom row in place", async () => {
    const api = createApi([820, 821]);

    container.questionManager.startQuestions([MULTIPLE_QUESTION], "req-multi-toggle");
    await showCurrentQuestion(api, 123, createDeps());
    await pressButton("question:custom:0", 820, api);
    await handleQuestionTextAnswer(createTextContext("Mine", api), createDeps());

    const toggleCtx = createCallbackContext("question:toggle_custom:0", 821, api);
    await handleQuestionCallback(toggleCtx, createDeps());

    expect(container.questionManager.isCustomAnswerSelected(0)).toBe(false);
    expect(toggleCtx.answerCallbackQuery).toHaveBeenCalledWith();
    expect(api.editMessageText).toHaveBeenLastCalledWith(123, 821, expect.anything(), {
      reply_markup: expect.objectContaining({
        inline_keyboard: expect.arrayContaining([
          [{ text: "✏️ Mine", callback_data: "question:toggle_custom:0" }],
        ]),
      }),
    });

    const submitCtx = createCallbackContext("question:submit:0", 821, api);
    await handleQuestionCallback(submitCtx, createDeps());

    expect(submitCtx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("question.select_one_required_callback"),
      show_alert: true,
    });
    expect(container.questionManager.isActive()).toBe(true);
  });

  it("sends the ticked options and the ticked custom text on submit", async () => {
    const api = createApi([830, 831, 832]);

    container.questionManager.startQuestions([MULTIPLE_QUESTION], "req-multi-submit");
    await showCurrentQuestion(api, 123, createDeps());
    await pressButton("question:custom:0", 830, api);
    await handleQuestionTextAnswer(createTextContext("Line one\nline two", api), createDeps());
    await pressButton("question:select:0:0", 831, api);
    await pressButton("question:submit:0", 831, api);

    expect(mocked.questionReplyMock).toHaveBeenCalledWith({
      requestID: "req-multi-submit",
      directory: "D:/repo",
      answers: [["* One: 1", "Line one\nline two"]],
    });
    expect(api.sendMessage).toHaveBeenLastCalledWith(
      123,
      expect.stringContaining(
        t("question.summary.answer", { answer: "* One: 1\nLine one\nline two" }),
      ),
    );
    expect(container.questionManager.isActive()).toBe(false);
  });

  it("submits a multi-select question whose only ticked item is the custom text", async () => {
    const api = createApi([840, 841]);

    container.questionManager.startQuestions([MULTIPLE_QUESTION], "req-multi-only-custom");
    await showCurrentQuestion(api, 123, createDeps());
    await pressButton("question:custom:0", 840, api);
    await handleQuestionTextAnswer(createTextContext("Only mine", api), createDeps());
    await pressButton("question:submit:0", 841, api);

    expect(mocked.questionReplyMock).toHaveBeenCalledWith(
      expect.objectContaining({ answers: [["Only mine"]] }),
    );
  });
});
