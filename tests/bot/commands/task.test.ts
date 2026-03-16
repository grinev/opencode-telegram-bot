import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import {
  handleTaskCallback,
  handleTaskTextInput,
  taskCommand,
} from "../../../src/bot/commands/task.js";
import { interactionManager } from "../../../src/interaction/manager.js";
import { taskCreationManager } from "../../../src/scheduled-task/creation-manager.js";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  currentProject: {
    id: "project-1",
    worktree: "D:\\Projects\\Repo",
  } as { id: string; worktree: string } | null,
  storedModel: {
    providerID: "openai",
    modelID: "gpt-5",
    variant: "default",
  },
  parseTaskScheduleMock: vi.fn(),
  addScheduledTaskMock: vi.fn(),
  registerTaskMock: vi.fn(),
}));

vi.mock("../../../src/settings/manager.js", () => ({
  getCurrentProject: vi.fn(() => mocked.currentProject),
}));

vi.mock("../../../src/model/manager.js", () => ({
  getStoredModel: vi.fn(() => mocked.storedModel),
}));

vi.mock("../../../src/scheduled-task/schedule-parser.js", () => ({
  parseTaskSchedule: mocked.parseTaskScheduleMock,
}));

vi.mock("../../../src/scheduled-task/store.js", () => ({
  addScheduledTask: mocked.addScheduledTaskMock,
}));

vi.mock("../../../src/scheduled-task/runtime.js", () => ({
  scheduledTaskRuntime: {
    registerTask: mocked.registerTaskMock,
  },
}));

function createCommandContext(): Context {
  return {
    chat: { id: 777 },
    reply: vi.fn().mockResolvedValue({ message_id: 100 }),
  } as unknown as Context;
}

function createTextContext(text: string, messageIds: number[]): Context {
  const reply = vi.fn();
  for (const messageId of messageIds) {
    reply.mockResolvedValueOnce({ message_id: messageId });
  }

  return {
    chat: { id: 777 },
    message: { text } as Context["message"],
    reply,
    api: {
      deleteMessage: vi.fn().mockResolvedValue(true),
    },
  } as unknown as Context;
}

function createCallbackContext(data: string, messageId: number): Context {
  return {
    chat: { id: 777 },
    callbackQuery: {
      data,
      message: { message_id: messageId },
    } as Context["callbackQuery"],
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue({ message_id: 500 }),
    api: {
      deleteMessage: vi.fn().mockResolvedValue(true),
    },
  } as unknown as Context;
}

describe("bot/commands/task", () => {
  beforeEach(() => {
    interactionManager.clear("test_setup");
    taskCreationManager.clear();

    mocked.currentProject = {
      id: "project-1",
      worktree: "D:\\Projects\\Repo",
    };
    mocked.storedModel = {
      providerID: "openai",
      modelID: "gpt-5",
      variant: "default",
    };
    mocked.parseTaskScheduleMock.mockReset();
    mocked.addScheduledTaskMock.mockReset();
    mocked.registerTaskMock.mockReset();
    mocked.addScheduledTaskMock.mockResolvedValue(undefined);
    mocked.parseTaskScheduleMock.mockResolvedValue({
      kind: "cron",
      cron: "0 17 * * *",
      timezone: "UTC",
      summary: "Every day at 17:00",
      nextRunAt: "2026-03-16T17:00:00.000Z",
    });
  });

  it("starts scheduled task creation flow", async () => {
    const ctx = createCommandContext();

    await taskCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith(t("task.prompt.schedule"), {
      reply_markup: expect.any(Object),
    });
    expect(taskCreationManager.isWaitingForSchedule()).toBe(true);
    expect(interactionManager.getSnapshot()).toMatchObject({
      kind: "task",
      expectedInput: "text",
      metadata: {
        flow: "task",
        stage: "awaiting_schedule",
        projectId: "project-1",
        projectWorktree: "D:\\Projects\\Repo",
      },
    });
  });

  it("parses schedule and switches flow to prompt input", async () => {
    await taskCommand(createCommandContext() as never);

    const ctx = createTextContext("every day at 17:00", [201, 202]);
    const handled = await handleTaskTextInput(ctx);

    expect(handled).toBe(true);
    expect(mocked.parseTaskScheduleMock).toHaveBeenCalledWith(
      "every day at 17:00",
      "D:\\Projects\\Repo",
    );
    expect(ctx.reply).toHaveBeenNthCalledWith(1, t("task.parse.in_progress"));
    const previewCall = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[1] as [
      string,
      { reply_markup: unknown },
    ];
    expect(previewCall[0]).toContain("Every day at 17:00");
    expect(previewCall[0]).toContain("UTC");
    expect(previewCall[0]).toContain(t("task.kind.cron"));
    expect(previewCall[0]).toContain(t("task.prompt.body"));
    expect(previewCall[1]).toEqual(expect.objectContaining({ reply_markup: expect.any(Object) }));
    expect(taskCreationManager.isWaitingForPrompt()).toBe(true);
    expect(interactionManager.getSnapshot()).toMatchObject({
      kind: "task",
      expectedInput: "mixed",
      metadata: {
        flow: "task",
        stage: "awaiting_prompt",
        previewMessageId: 202,
      },
    });
  });

  it("saves scheduled task after receiving prompt text", async () => {
    await taskCommand(createCommandContext() as never);
    await handleTaskTextInput(createTextContext("every day at 17:00", [201, 202]));

    const ctx = createTextContext("Send me a daily summary", [301]);
    const handled = await handleTaskTextInput(ctx);

    expect(handled).toBe(true);
    expect(mocked.addScheduledTaskMock).toHaveBeenCalledTimes(1);
    expect(mocked.registerTaskMock).toHaveBeenCalledTimes(1);
    expect(mocked.addScheduledTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        projectWorktree: "D:\\Projects\\Repo",
        model: {
          providerID: "openai",
          modelID: "gpt-5",
          variant: "default",
        },
        kind: "cron",
        scheduleText: "every day at 17:00",
        scheduleSummary: "Every day at 17:00",
        prompt: "Send me a daily summary",
        timezone: "UTC",
        nextRunAt: "2026-03-16T17:00:00.000Z",
        runCount: 0,
        lastStatus: "idle",
        lastError: null,
      }),
    );
    const successCall = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(successCall[0]).toContain("Send me a daily summary");
    expect(successCall[0]).toContain("D:\\Projects\\Repo");
    expect(successCall[0]).toContain("openai/gpt-5 (default)");
    expect(successCall[0]).toContain("Every day at 17:00");
    expect(taskCreationManager.isActive()).toBe(false);
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("restarts schedule step when retry button is pressed", async () => {
    await taskCommand(createCommandContext() as never);
    await handleTaskTextInput(createTextContext("every day at 17:00", [201, 202]));

    const ctx = createCallbackContext("task:retry-schedule", 202);
    const handled = await handleTaskCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("task.retry_schedule_callback"),
    });
    expect(ctx.reply).toHaveBeenCalledWith(t("task.prompt.schedule"), {
      reply_markup: expect.any(Object),
    });
    expect(taskCreationManager.isWaitingForSchedule()).toBe(true);
    expect(interactionManager.getSnapshot()).toMatchObject({
      kind: "task",
      expectedInput: "text",
      metadata: {
        stage: "awaiting_schedule",
      },
    });
  });

  it("cancels task flow from schedule message", async () => {
    await taskCommand(createCommandContext() as never);

    const ctx = createCallbackContext("task:cancel", 100);
    const handled = await handleTaskCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("task.cancel_callback"),
    });
    expect(ctx.reply).toHaveBeenCalledWith(t("task.cancelled"));
    expect(taskCreationManager.isActive()).toBe(false);
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("rejects schedules more frequent than every 5 minutes", async () => {
    await taskCommand(createCommandContext() as never);
    mocked.parseTaskScheduleMock.mockResolvedValue({
      kind: "cron",
      cron: "*/2 * * * *",
      timezone: "UTC",
      summary: "Every 2 minutes",
      nextRunAt: "2026-03-16T17:00:00.000Z",
    });

    const ctx = createTextContext("every 2 minutes", [201, 202]);
    const handled = await handleTaskTextInput(ctx);

    expect(handled).toBe(true);
    expect(mocked.addScheduledTaskMock).not.toHaveBeenCalled();
    const errorCall = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[1] as [
      string,
      { reply_markup: unknown },
    ];
    expect(errorCall[0]).toContain(t("task.schedule_too_frequent"));
    expect(errorCall[1]).toEqual(expect.objectContaining({ reply_markup: expect.any(Object) }));
    expect(taskCreationManager.isWaitingForSchedule()).toBe(true);
  });
});
