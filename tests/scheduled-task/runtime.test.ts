import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Context } from "grammy";
import type { ScheduledTask } from "../../src/scheduled-task/types.js";

const mocked = vi.hoisted(() => ({
  tasks: [] as ScheduledTask[],
  executeScheduledTaskMock: vi.fn(),
  sendBotTextMock: vi.fn(),
  replaceScheduledTasksMock: vi.fn(),
  removeScheduledTaskMock: vi.fn(),
}));

function cloneTask(task: ScheduledTask): ScheduledTask {
  return {
    ...task,
    model: { ...task.model },
  };
}

vi.mock("../../src/config.js", () => ({
  config: {
    telegram: {
      allowedUserId: 777,
    },
    opencode: {
      apiUrl: "http://localhost:4096",
      password: "",
    },
    server: {
      logLevel: "error",
    },
  },
}));

vi.mock("../../src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      create: vi.fn(),
      prompt: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock("../../src/scheduled-task/executor.js", () => ({
  executeScheduledTask: mocked.executeScheduledTaskMock,
}));

vi.mock("../../src/bot/utils/telegram-text.js", () => ({
  sendBotText: mocked.sendBotTextMock,
}));

vi.mock("../../src/scheduled-task/store.js", () => ({
  listScheduledTasks: vi.fn(() => mocked.tasks.map((task) => cloneTask(task))),
  getScheduledTask: vi.fn((taskId: string) => {
    const task = mocked.tasks.find((item) => item.id === taskId);
    return task ? cloneTask(task) : null;
  }),
  replaceScheduledTasks: vi.fn(async (tasks: ScheduledTask[]) => {
    mocked.tasks = tasks.map((task) => cloneTask(task));
    mocked.replaceScheduledTasksMock(tasks);
  }),
  updateScheduledTask: vi.fn(
    async (taskId: string, updater: (task: ScheduledTask) => ScheduledTask) => {
      const index = mocked.tasks.findIndex((task) => task.id === taskId);
      if (index < 0) {
        return null;
      }

      const nextTask = cloneTask(updater(cloneTask(mocked.tasks[index])));
      mocked.tasks[index] = nextTask;
      return cloneTask(nextTask);
    },
  ),
  removeScheduledTask: vi.fn(async (taskId: string) => {
    const nextTasks = mocked.tasks.filter((task) => task.id !== taskId);
    const removed = nextTasks.length !== mocked.tasks.length;
    mocked.tasks = nextTasks;
    mocked.removeScheduledTaskMock(taskId);
    return removed;
  }),
}));

function createTask(partial: Partial<ScheduledTask> = {}): ScheduledTask {
  const kind = partial.kind ?? "once";

  if (kind === "cron") {
    return {
      id: "task-1",
      kind: "cron",
      projectId: "project-1",
      projectWorktree: "D:\\Projects\\Repo",
      model: {
        providerID: "openai",
        modelID: "gpt-5",
        variant: "default",
      },
      scheduleText: "every day at 17:00",
      scheduleSummary: "Every day at 17:00",
      timezone: "UTC",
      cron: "0 17 * * *",
      prompt: "Send report",
      createdAt: "2026-03-16T10:00:00.000Z",
      nextRunAt: "2026-03-16T10:00:00.000Z",
      lastRunAt: null,
      runCount: 0,
      lastStatus: "idle",
      lastError: null,
      ...partial,
    };
  }

  return {
    id: "task-1",
    kind: "once",
    projectId: "project-1",
    projectWorktree: "D:\\Projects\\Repo",
    model: {
      providerID: "openai",
      modelID: "gpt-5",
      variant: "default",
    },
    scheduleText: "tomorrow at 12:00",
    scheduleSummary: "Tomorrow at 12:00",
    timezone: "UTC",
    runAt: "2026-03-16T10:00:00.000Z",
    prompt: "Send report",
    createdAt: "2026-03-16T09:00:00.000Z",
    nextRunAt: "2026-03-16T10:00:00.000Z",
    lastRunAt: null,
    runCount: 0,
    lastStatus: "idle",
    lastError: null,
    ...partial,
  };
}

describe("scheduled-task/runtime", () => {
  let ScheduledTaskRuntimeClass: typeof import("../../src/scheduled-task/runtime.js").ScheduledTaskRuntime;
  let foregroundSessionState: typeof import("../../src/scheduled-task/foreground-state.js").foregroundSessionState;

  beforeEach(() => {
    mocked.tasks = [];
    mocked.executeScheduledTaskMock.mockReset();
    mocked.sendBotTextMock.mockReset();
    mocked.replaceScheduledTasksMock.mockReset();
    mocked.removeScheduledTaskMock.mockReset();
  });

  it("queues scheduled task result while foreground session is busy and flushes later", async () => {
    ({ ScheduledTaskRuntime: ScheduledTaskRuntimeClass } =
      await import("../../src/scheduled-task/runtime.js"));
    ({ foregroundSessionState } = await import("../../src/scheduled-task/foreground-state.js"));
    foregroundSessionState.__resetForTests();

    const runtime = new ScheduledTaskRuntimeClass();
    mocked.tasks = [createTask({ nextRunAt: "2026-03-16T09:59:00.000Z" })];
    mocked.executeScheduledTaskMock.mockResolvedValue({
      taskId: "task-1",
      status: "success",
      startedAt: "2026-03-16T10:00:00.000Z",
      finishedAt: "2026-03-16T10:01:00.000Z",
      resultText: "All good",
      errorMessage: null,
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-16T10:00:00.000Z"));
    foregroundSessionState.markBusy("session-1");

    await runtime.initialize({ api: {} } as Bot<Context>);
    await vi.runAllTimersAsync();

    expect(mocked.removeScheduledTaskMock).toHaveBeenCalledWith("task-1");
    expect(mocked.sendBotTextMock).not.toHaveBeenCalled();

    foregroundSessionState.markIdle("session-1");
    await runtime.flushDeferredDeliveries();

    expect(mocked.sendBotTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 777,
        text: expect.stringContaining("All good"),
      }),
    );

    runtime.__resetForTests();
    vi.useRealTimers();
  });

  it("keeps recurring task after execution error and schedules next run", async () => {
    ({ ScheduledTaskRuntime: ScheduledTaskRuntimeClass } =
      await import("../../src/scheduled-task/runtime.js"));
    ({ foregroundSessionState } = await import("../../src/scheduled-task/foreground-state.js"));
    foregroundSessionState.__resetForTests();

    const runtime = new ScheduledTaskRuntimeClass();
    mocked.tasks = [createTask({ kind: "cron", nextRunAt: "2026-03-16T16:59:00.000Z" })];
    mocked.executeScheduledTaskMock.mockResolvedValue({
      taskId: "task-1",
      status: "error",
      startedAt: "2026-03-16T17:00:00.000Z",
      finishedAt: "2026-03-16T17:01:00.000Z",
      resultText: null,
      errorMessage: "Task failed",
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-16T17:00:00.000Z"));

    await runtime.initialize({ api: {} } as Bot<Context>);
    await vi.runAllTimersAsync();

    expect(mocked.tasks).toHaveLength(1);
    expect(mocked.tasks[0]?.lastStatus).toBe("error");
    expect(mocked.tasks[0]?.lastError).toBe("Task failed");
    expect(mocked.tasks[0]?.nextRunAt).toBe("2026-03-17T17:00:00.000Z");
    expect(mocked.sendBotTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 777,
        text: expect.stringContaining("Task failed"),
      }),
    );

    runtime.__resetForTests();
    vi.useRealTimers();
  });
});
