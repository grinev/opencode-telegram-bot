import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { taskListCommand } from "../../../src/bot/commands/tasklist-command.js";
import { handleTaskListCallback } from "../../../src/bot/callbacks/scheduled-task-callback-handler.js";
import { interactionManager } from "../../../src/app/managers/interaction-manager.js";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  listScheduledTasksMock: vi.fn(),
  getScheduledTaskMock: vi.fn(),
  removeScheduledTaskMock: vi.fn(),
  runtimeRemoveTaskMock: vi.fn(),
}));

vi.mock("../../../src/app/stores/scheduled-task-store.js", () => ({
  listScheduledTasks: mocked.listScheduledTasksMock,
  getScheduledTask: mocked.getScheduledTaskMock,
  removeScheduledTask: mocked.removeScheduledTaskMock,
}));

vi.mock("../../../src/app/services/scheduled-task-runtime-service.js", () => ({
  scheduledTaskRuntime: {
    removeTask: mocked.runtimeRemoveTaskMock,
  },
}));

function createTask(id: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    kind: "cron",
    cron: "0 * * * *",
    projectId: `project-${id}`,
    projectWorktree: `D:\\Projects\\${id}`,
    model: {
      providerID: "openai",
      modelID: "gpt-5",
      variant: "default",
    },
    scheduleText: `schedule text ${id}`,
    scheduleSummary: `Every hour ${id}`,
    timezone: "UTC",
    prompt: `Prompt for ${id}`,
    createdAt: `2026-03-1${id.length}T10:00:00.000Z`,
    nextRunAt: "2026-03-20T12:00:00.000Z",
    lastRunAt: null,
    runCount: 0,
    lastStatus: "idle",
    lastError: null,
    ...overrides,
  };
}

function createCommandContext(messageId: number = 100): Context {
  return {
    chat: { id: 777 },
    reply: vi.fn().mockResolvedValue({ message_id: messageId }),
  } as unknown as Context;
}

function createCallbackContext(data: string, messageId: number): Context {
  return {
    chat: { id: 777 },
    callbackQuery: {
      data,
      message: {
        message_id: messageId,
      },
    } as Context["callbackQuery"],
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

describe("bot/commands/tasklist", () => {
  beforeEach(() => {
    interactionManager.clear("test_setup");
    mocked.listScheduledTasksMock.mockReset();
    mocked.getScheduledTaskMock.mockReset();
    mocked.removeScheduledTaskMock.mockReset();
    mocked.runtimeRemoveTaskMock.mockReset();
    mocked.removeScheduledTaskMock.mockResolvedValue(true);
  });

  it("shows empty state when no tasks exist", async () => {
    mocked.listScheduledTasksMock.mockReturnValue([]);

    const ctx = createCommandContext();
    await taskListCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith(t("tasklist.empty"));
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("shows tasks from all projects in one list", async () => {
    mocked.listScheduledTasksMock.mockReturnValue([
      createTask("task-1", {
        projectWorktree: "D:\\Projects\\RepoA",
        cron: "0 * * * *",
        scheduleSummary: "Every hour",
        prompt: "Check weather forecast",
      }),
      createTask("task-2", {
        projectWorktree: "D:\\Projects\\RepoB",
        cron: "0 9 * * *",
        scheduleSummary: "Every day at 09:00",
        prompt: "Send backup report",
        nextRunAt: "2026-03-20T09:00:00.000Z",
      }),
    ]);

    const ctx = createCommandContext(123);
    await taskListCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledTimes(1);

    const [, options] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data?: string }>> } },
    ];

    expect(options.reply_markup.inline_keyboard[0]?.[0]?.text).toContain("[daily 09:00]");
    expect(options.reply_markup.inline_keyboard[0]?.[0]?.text).toContain("Send backup report");
    expect(options.reply_markup.inline_keyboard[1]?.[0]?.text).toContain("[hourly]");
    expect(options.reply_markup.inline_keyboard[1]?.[0]?.text).toContain("Check weather forecast");
    expect(options.reply_markup.inline_keyboard[2]?.[0]?.callback_data).toBe("tasklist:cancel");

    expect(interactionManager.getSnapshot()).toMatchObject({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "tasklist",
        stage: "list",
        messageId: 123,
      },
    });
  });

  it("opens task details without showing original schedule text", async () => {
    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "tasklist",
        stage: "list",
        messageId: 300,
      },
    });

    mocked.getScheduledTaskMock.mockReturnValue(
      createTask("task-1", {
        projectWorktree: "D:\\Projects\\RepoA",
        cron: "0 * * * *",
        scheduleText: "every hour please",
        scheduleSummary: "Every hour",
        prompt: "Check weather forecast",
        runCount: 2,
      }),
    );

    const ctx = createCallbackContext("tasklist:open:task-1", 300);
    const handled = await handleTaskListCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.editMessageText).toHaveBeenCalledTimes(1);

    const [text] = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text).toContain("Check weather forecast");
    expect(text).toContain("D:\\Projects\\RepoA");
    expect(text).toContain("Model: openai/gpt-5 (default)");
    expect(text).toContain("Every hour");
    expect(text).toContain("Cron: 0 * * * *");
    expect(text).not.toContain("every hour please");
    expect(text.indexOf("D:\\Projects\\RepoA")).toBeLessThan(
      text.indexOf("Model: openai/gpt-5 (default)"),
    );
    expect(text.indexOf("Model: openai/gpt-5 (default)")).toBeLessThan(
      text.indexOf("Every hour"),
    );

    expect(interactionManager.getSnapshot()).toMatchObject({
      kind: "custom",
      metadata: {
        flow: "tasklist",
        stage: "detail",
        taskId: "task-1",
      },
    });
  });

  it("cancels task details interaction and removes message", async () => {
    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "tasklist",
        stage: "detail",
        messageId: 400,
        taskId: "task-1",
      },
    });

    const ctx = createCallbackContext("tasklist:cancel", 400);
    const handled = await handleTaskListCallback(ctx);

    expect(handled).toBe(true);
    expect(interactionManager.getSnapshot()).toBeNull();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("tasklist.cancelled_callback"),
    });
    expect(ctx.deleteMessage).toHaveBeenCalledTimes(1);
  });

  it("deletes selected task and clears runtime scheduling", async () => {
    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "tasklist",
        stage: "detail",
        messageId: 500,
        taskId: "task-2",
      },
    });

    const ctx = createCallbackContext("tasklist:delete:task-2", 500);
    const handled = await handleTaskListCallback(ctx);

    expect(handled).toBe(true);
    expect(mocked.removeScheduledTaskMock).toHaveBeenCalledWith("task-2");
    expect(mocked.runtimeRemoveTaskMock).toHaveBeenCalledWith("task-2");
    expect(interactionManager.getSnapshot()).toBeNull();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("tasklist.deleted_callback"),
    });
    expect(ctx.deleteMessage).toHaveBeenCalledTimes(1);
  });

  it("shows inactive alert for stale callbacks", async () => {
    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "tasklist",
        stage: "list",
        messageId: 600,
      },
    });

    const ctx = createCallbackContext("tasklist:open:task-1", 601);
    const handled = await handleTaskListCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("tasklist.inactive_callback"),
      show_alert: true,
    });
  });

  it("truncates long ASCII prompt by byte length to fit Telegram limit", async () => {
    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "tasklist",
        stage: "list",
        messageId: 700,
      },
    });

    const longPrompt = "A".repeat(4000);
    mocked.getScheduledTaskMock.mockReturnValue(
      createTask("task-long", {
        prompt: longPrompt,
      }),
    );

    const ctx = createCallbackContext("tasklist:open:task-long", 700);
    await handleTaskListCallback(ctx);

    const [text] = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text).toContain("...");
    expect(Buffer.byteLength(text, "utf-8")).toBeLessThanOrEqual(4096);
  });

  it("keeps short prompts intact without truncation", async () => {
    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "tasklist",
        stage: "list",
        messageId: 800,
      },
    });

    const shortPrompt = "Check weather";
    mocked.getScheduledTaskMock.mockReturnValue(
      createTask("task-short", {
        prompt: shortPrompt,
      }),
    );

    const ctx = createCallbackContext("tasklist:open:task-short", 800);
    await handleTaskListCallback(ctx);

    const [text] = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text).toContain(shortPrompt);
    expect(text).not.toContain("...");
  });

  it("truncates non-ASCII prompts by byte length (Arabic/Cyrillic)", async () => {
    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "tasklist",
        stage: "list",
        messageId: 900,
      },
    });

    // Arabic chars are ~2 bytes each in UTF-8 — 2500 chars = ~5000 bytes
    const arabicPrompt = "مرحباً".repeat(500);
    mocked.getScheduledTaskMock.mockReturnValue(
      createTask("task-ar", {
        prompt: arabicPrompt,
      }),
    );

    const ctx = createCallbackContext("tasklist:open:task-ar", 900);
    await handleTaskListCallback(ctx);

    const [text] = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text).toContain("...");
    expect(Buffer.byteLength(text, "utf-8")).toBeLessThanOrEqual(4096);
  });

  it("shows the 'Show full prompt' button when the prompt is truncated", async () => {
    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "tasklist",
        stage: "list",
        messageId: 1000,
      },
    });

    mocked.getScheduledTaskMock.mockReturnValue(
      createTask("task-long", { prompt: "B".repeat(4000) }),
    );

    const ctx = createCallbackContext("tasklist:open:task-long", 1000);
    await handleTaskListCallback(ctx);

    const [, options] = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data?: string }>> } },
    ];

    const buttons = options.reply_markup.inline_keyboard.flat();
    const showButton = buttons.find((button) => button.callback_data === "tasklist:prompt:task-long");
    expect(showButton).toBeTruthy();
    expect(showButton?.text).toBe(t("tasklist.button.show_prompt"));
  });

  it("hides the 'Show full prompt' button when the prompt fits the detail budget", async () => {
    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "tasklist",
        stage: "list",
        messageId: 1100,
      },
    });

    mocked.getScheduledTaskMock.mockReturnValue(
      createTask("task-short", { prompt: "Check weather" }),
    );

    const ctx = createCallbackContext("tasklist:open:task-short", 1100);
    await handleTaskListCallback(ctx);

    const [, options] = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data?: string }>> } },
    ];

    const buttons = options.reply_markup.inline_keyboard.flat();
    expect(buttons.some((button) => button.callback_data?.startsWith("tasklist:prompt:"))).toBe(false);
  });

  it("replies with the full prompt when 'Show full prompt' is tapped", async () => {
    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "tasklist",
        stage: "detail",
        messageId: 1200,
        taskId: "task-full",
      },
    });

    const longPrompt = "C".repeat(4000);
    mocked.getScheduledTaskMock.mockReturnValue(
      createTask("task-full", { prompt: longPrompt }),
    );

    const ctx = createCallbackContext("tasklist:prompt:task-full", 1200);
    const handled = await handleTaskListCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.reply).toHaveBeenCalledTimes(1);

    const [text] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text).toContain(t("tasklist.full_prompt_header"));
    expect(text).toContain(longPrompt);
  });

  it("splits the full prompt across messages when it exceeds the Telegram limit", async () => {
    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "tasklist",
        stage: "detail",
        messageId: 1300,
        taskId: "task-huge",
      },
    });

    const hugePrompt = "D".repeat(12000);
    mocked.getScheduledTaskMock.mockReturnValue(
      createTask("task-huge", { prompt: hugePrompt }),
    );

    const ctx = createCallbackContext("tasklist:prompt:task-huge", 1300);
    await handleTaskListCallback(ctx);

    const calls = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls as Array<[string]>;
    expect(calls.length).toBeGreaterThan(1);

    const combined = calls.map(([text]) => text).join("\n\n");
    expect(combined).toContain(hugePrompt.slice(0, 1000));
    expect(combined).toContain(hugePrompt.slice(-1000));

    for (const [text] of calls) {
      expect(Buffer.byteLength(text, "utf-8")).toBeLessThanOrEqual(4096);
    }
  });

  it("rejects 'Show full prompt' taps outside the active detail view", async () => {
    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "tasklist",
        stage: "list",
        messageId: 1400,
      },
    });

    const ctx = createCallbackContext("tasklist:prompt:task-full", 1400);
    const handled = await handleTaskListCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("tasklist.inactive_callback"),
      show_alert: true,
    });
    expect(ctx.reply).not.toHaveBeenCalled();
  });
});
