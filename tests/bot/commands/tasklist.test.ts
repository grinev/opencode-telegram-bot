import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { handleTaskListCallback, taskListCommand } from "../../../src/bot/commands/tasklist.js";
import { interactionManager } from "../../../src/interaction/manager.js";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  listScheduledTasksMock: vi.fn(),
  getScheduledTaskMock: vi.fn(),
  removeScheduledTaskMock: vi.fn(),
  runtimeRemoveTaskMock: vi.fn(),
}));

vi.mock("../../../src/scheduled-task/store.js", () => ({
  listScheduledTasks: mocked.listScheduledTasksMock,
  getScheduledTask: mocked.getScheduledTaskMock,
  removeScheduledTask: mocked.removeScheduledTaskMock,
}));

vi.mock("../../../src/scheduled-task/runtime.js", () => ({
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
    expect(text).toContain("Every hour");
    expect(text).toContain("Cron: 0 * * * *");
    expect(text).not.toContain("every hour please");

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
});
