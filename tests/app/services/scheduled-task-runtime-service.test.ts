import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Context } from "grammy";
import type { ScheduledTask } from "../../../src/app/types/scheduled-task.js";
import { defined } from "../../helpers/defined.js";

const mocked = vi.hoisted(() => ({
  tasks: [] as ScheduledTask[],
  executeScheduledTaskMock: vi.fn(),
  sendBotTextMock: vi.fn(),
  replaceScheduledTasksMock: vi.fn(),
  removeScheduledTaskMock: vi.fn(),
  cleanupIgnoresMock: vi.fn(),
}));

function cloneTask(task: ScheduledTask): ScheduledTask {
  return {
    ...task,
    model: { ...task.model },
  };
}

vi.mock("../../../src/config.js", () => ({
  config: {
    telegram: {
      allowedUserId: 777,
    },
    bot: {
      messageFormatMode: "markdown",
      scheduledTaskExecutionTimeoutMinutes: 120,
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

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      create: vi.fn(),
      prompt: vi.fn(),
      promptAsync: vi.fn(),
      delete: vi.fn(),
      messages: vi.fn(),
      status: vi.fn(),
    },
    question: { list: vi.fn() },
    permission: { list: vi.fn() },
  },
}));

vi.mock("../../../src/app/services/folder-presence-service.js", () => ({
  checkFolderPresence: vi.fn().mockResolvedValue("present"),
}));

vi.mock("../../../src/app/services/scheduled-task-executor-service.js", () => ({
  executeScheduledTask: mocked.executeScheduledTaskMock,
}));

vi.mock("../../../src/app/services/scheduled-task-session-ignore-service.js", () => ({
  cleanupScheduledTaskSessionIgnores: mocked.cleanupIgnoresMock,
  registerScheduledTaskSessionIgnore: vi.fn(),
}));

vi.mock("../../../src/bot/messages/telegram-text.js", () => ({
  AGENT_TEXT_LINK_PREVIEW_OPTIONS: { link_preview_options: { is_disabled: false } },
  sendBotText: mocked.sendBotTextMock,
}));

vi.mock("../../../src/app/stores/scheduled-task-store.js", () => ({
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

      const nextTask = cloneTask(updater(cloneTask(defined(mocked.tasks[index]))));
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
      agent: "build",
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
    } as ScheduledTask;
  }

  return {
    id: "task-1",
    kind: "once",
    projectId: "project-1",
    projectWorktree: "D:\\Projects\\Repo",
    agent: "build",
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
  } as ScheduledTask;
}

async function createDeliverySender() {
  const { createScheduledTaskDeliverySender } =
    await import("../../../src/bot/messages/scheduled-task-delivery.js");

  return createScheduledTaskDeliverySender({ sendMessage: vi.fn() } as never, 777);
}

describe("app/services/scheduled-task-runtime-service", () => {
  let ScheduledTaskRuntimeClass: typeof import("../../../src/app/services/scheduled-task-runtime-service.js").ScheduledTaskRuntime;
  let ForegroundSessionStateClass: typeof import("../../../src/app/managers/foreground-session-state-manager.js").ForegroundSessionState;

  beforeEach(() => {
    mocked.tasks = [];
    mocked.executeScheduledTaskMock.mockReset();
    mocked.sendBotTextMock.mockReset();
    mocked.replaceScheduledTasksMock.mockReset();
    mocked.removeScheduledTaskMock.mockReset();
    mocked.cleanupIgnoresMock.mockReset();
    mocked.cleanupIgnoresMock.mockResolvedValue(0);
  });

  it("queues scheduled task result while foreground session is busy and flushes later", async () => {
    ({ ScheduledTaskRuntime: ScheduledTaskRuntimeClass } =
      await import("../../../src/app/services/scheduled-task-runtime-service.js"));
    ({ ForegroundSessionState: ForegroundSessionStateClass } =
      await import("../../../src/app/managers/foreground-session-state-manager.js"));
    const foregroundSessionState = new ForegroundSessionStateClass();

    const runtime = new ScheduledTaskRuntimeClass(foregroundSessionState);
    mocked.tasks = [createTask({ nextRunAt: "2026-03-16T09:59:00.000Z" })];
    mocked.executeScheduledTaskMock.mockResolvedValue({
      taskId: "task-1",
      status: "success",
      startedAt: "2026-03-16T10:00:00.000Z",
      finishedAt: "2026-03-16T10:01:00.000Z",
      resultText: "All good",
      errorMessage: null,
      steps: [{ messageID: "msg-1", created: 0, streamed: 1_000, output: 12, reasoning: 3 }],
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-16T10:00:00.000Z"));
    foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");

    await runtime.initialize({ api: {} } as Bot<Context>, await createDeliverySender());

    expect(mocked.cleanupIgnoresMock).toHaveBeenCalledTimes(1);
    await vi.runAllTimersAsync();

    expect(mocked.removeScheduledTaskMock).toHaveBeenCalledWith("task-1");
    expect(mocked.sendBotTextMock).not.toHaveBeenCalled();

    foregroundSessionState.markIdle("session-1");
    await runtime.flushDeferredDeliveries();

    expect(mocked.sendBotTextMock).toHaveBeenCalledTimes(2);
    expect(mocked.sendBotTextMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        chatId: 777,
        format: "markdown_v2",
        options: { disable_notification: true, link_preview_options: { is_disabled: false } },
        text: expect.stringMatching(/Send report[\s\S]*All good/),
      }),
    );
    const footerCall = (mocked.sendBotTextMock as ReturnType<typeof vi.fn>).mock.calls[1]?.[0];
    expect(footerCall).toEqual(
      expect.objectContaining({
        chatId: 777,
        format: "raw",
        text: "🛠️ Build · 🧠 openai/gpt-5 · 🕒 1m · ⚡ 15.0 tok/s",
      }),
    );
    expect(footerCall).not.toHaveProperty("options");

    runtime.shutdown();
    vi.useRealTimers();
  });

  it.each([
    { kind: "once" as const, busy: false },
    { kind: "once" as const, busy: true },
    { kind: "cron" as const, busy: false },
    { kind: "cron" as const, busy: true },
  ])(
    "suppresses $kind success with busy=$busy without changing its lifecycle",
    async ({ kind, busy }) => {
      const { ScheduledTaskRuntime } =
        await import("../../../src/app/services/scheduled-task-runtime-service.js");
      const { ForegroundSessionState } =
        await import("../../../src/app/managers/foreground-session-state-manager.js");
      const foreground = new ForegroundSessionState();
      const runtime = new ScheduledTaskRuntime(foreground);
      const send = vi.fn().mockResolvedValue(true);
      mocked.tasks = [createTask({ kind })];
      mocked.executeScheduledTaskMock.mockResolvedValue({
        status: "success",
        startedAt: "2026-03-16T10:00:00.000Z",
        finishedAt: "2026-03-16T10:01:00.000Z",
        resultText: "[SILENT]\n![image](image.png)\n[report](report.txt)",
      });
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-16T10:00:00.000Z"));
      if (busy) foreground.markBusy("session-1", "D:\\Projects\\Repo");
      let restarted: InstanceType<typeof ScheduledTaskRuntime> | undefined;

      try {
        await runtime.initialize({ api: {} } as Bot<Context>, { send });
        await vi.advanceTimersByTimeAsync(0);

        expect(mocked.executeScheduledTaskMock).toHaveBeenCalledTimes(1);
        if (kind === "once") {
          expect(mocked.removeScheduledTaskMock).toHaveBeenCalledWith("task-1");
          expect(mocked.tasks).toHaveLength(0);
        } else {
          expect(mocked.tasks[0]).toMatchObject({
            lastStatus: "success",
            lastError: null,
            runCount: 1,
            nextRunAt: "2026-03-16T17:00:00.000Z",
          });
        }
        expect(send).not.toHaveBeenCalled();

        foreground.markIdle("session-1");
        await runtime.flushDeferredDeliveries();
        expect(send).not.toHaveBeenCalled();
        runtime.shutdown();

        restarted = new ScheduledTaskRuntime(foreground);
        await restarted.initialize({ api: {} } as Bot<Context>, { send });
        await restarted.flushDeferredDeliveries();
        expect(send).not.toHaveBeenCalled();

        if (kind === "cron") {
          mocked.executeScheduledTaskMock.mockResolvedValue({
            status: "success",
            startedAt: "2026-03-16T17:00:00.000Z",
            finishedAt: "2026-03-16T17:01:00.000Z",
            resultText: "Changes found",
          });
          await vi.advanceTimersByTimeAsync(7 * 60 * 60 * 1_000);
          expect(mocked.executeScheduledTaskMock).toHaveBeenCalledTimes(2);
          expect(mocked.tasks[0]).toMatchObject({
            lastStatus: "success",
            runCount: 2,
            nextRunAt: "2026-03-17T17:00:00.000Z",
          });
          expect(send).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ status: "success", resultText: "Changes found" }),
          );
        }
      } finally {
        runtime.shutdown();
        restarted?.shutdown();
        vi.useRealTimers();
      }
    },
  );

  it.each([
    { rawText: "\ufeff[SILENT]", suppressed: false, confirmAfterIdle: false },
    { rawText: "\ufeff[SILENT]", suppressed: false, confirmAfterIdle: true },
    { rawText: " [SILENT] ", suppressed: true, confirmAfterIdle: false },
    { rawText: " [SILENT] ", suppressed: true, confirmAfterIdle: true },
    { rawText: "\u001c[SILENT]\u001f", suppressed: true, confirmAfterIdle: false },
    { rawText: " No changes. [SILENT] \n", suppressed: false, confirmAfterIdle: false },
  ])(
    "filters original executor text $rawText with suppressed=$suppressed",
    async ({ rawText, suppressed, confirmAfterIdle }) => {
      const { ScheduledTaskRuntime } =
        await import("../../../src/app/services/scheduled-task-runtime-service.js");
      const { ForegroundSessionState } =
        await import("../../../src/app/managers/foreground-session-state-manager.js");
      const { executeScheduledTask } = await vi.importActual<
        typeof import("../../../src/app/services/scheduled-task-executor-service.js")
      >("../../../src/app/services/scheduled-task-executor-service.js");
      const { opencodeClient } = await import("../../../src/opencode/client.js");
      vi.mocked(opencodeClient.session.create).mockResolvedValue({
        data: { id: "temporary-session", directory: "D:\\Projects\\Repo" },
        error: null,
      } as never);
      vi.mocked(opencodeClient.session.promptAsync).mockResolvedValue({ error: null } as never);
      vi.mocked(opencodeClient.session.messages).mockResolvedValue({
        data: [
          {
            info: { id: "reply", role: "assistant", time: { completed: 1 } },
            parts: [{ type: "text", text: rawText }],
          },
        ],
        error: null,
      } as never);
      if (confirmAfterIdle) {
        vi.mocked(opencodeClient.session.messages).mockResolvedValueOnce({
          data: [],
          error: null,
        } as never);
        vi.mocked(opencodeClient.session.status).mockResolvedValue({
          data: {},
          error: null,
        } as never);
      }
      vi.mocked(opencodeClient.question.list).mockResolvedValue({ data: [], error: null } as never);
      vi.mocked(opencodeClient.permission.list).mockResolvedValue({
        data: [],
        error: null,
      } as never);
      mocked.executeScheduledTaskMock.mockImplementationOnce(executeScheduledTask);
      mocked.tasks = [createTask()];
      const runtime = new ScheduledTaskRuntime(new ForegroundSessionState());
      const send = vi.fn().mockResolvedValue(true);
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-16T10:00:00.000Z"));

      try {
        await runtime.initialize({ api: {} } as Bot<Context>, { send });
        await vi.advanceTimersByTimeAsync(0);
        expect(mocked.tasks).toHaveLength(0);
        expect(opencodeClient.session.delete).toHaveBeenCalledWith({
          sessionID: "temporary-session",
        });
        if (suppressed) {
          expect(send).not.toHaveBeenCalled();
        } else {
          expect(send).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ status: "success", resultText: rawText.trim() }),
          );
        }
      } finally {
        runtime.shutdown();
        vi.useRealTimers();
      }
    },
  );

  it("delivers execution errors even when their text starts with the silence marker", async () => {
    const { ScheduledTaskRuntime } =
      await import("../../../src/app/services/scheduled-task-runtime-service.js");
    const { ForegroundSessionState } =
      await import("../../../src/app/managers/foreground-session-state-manager.js");
    const runtime = new ScheduledTaskRuntime(new ForegroundSessionState());
    const send = vi.fn().mockResolvedValue(true);
    mocked.tasks = [createTask()];
    mocked.executeScheduledTaskMock.mockResolvedValue({
      status: "error",
      finishedAt: "2026-03-16T10:01:00.000Z",
      resultText: null,
      errorMessage: "[SILENT] Task failed",
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-16T10:00:00.000Z"));

    try {
      await runtime.initialize({ api: {} } as Bot<Context>, { send });
      await vi.advanceTimersByTimeAsync(0);
      expect(send).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          status: "error",
          notificationText: expect.stringContaining("[SILENT] Task failed"),
        }),
      );
    } finally {
      runtime.shutdown();
      vi.useRealTimers();
    }
  });

  it("keeps recurring task after execution error and schedules next run", async () => {
    ({ ScheduledTaskRuntime: ScheduledTaskRuntimeClass } =
      await import("../../../src/app/services/scheduled-task-runtime-service.js"));
    ({ ForegroundSessionState: ForegroundSessionStateClass } =
      await import("../../../src/app/managers/foreground-session-state-manager.js"));
    const foregroundSessionState = new ForegroundSessionStateClass();

    const runtime = new ScheduledTaskRuntimeClass(foregroundSessionState);
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

    await runtime.initialize({ api: {} } as Bot<Context>, await createDeliverySender());
    await vi.runAllTimersAsync();

    expect(mocked.tasks).toHaveLength(1);
    expect(mocked.tasks[0]?.lastStatus).toBe("error");
    expect(mocked.tasks[0]?.lastError).toBe("Task failed");
    expect(mocked.tasks[0]?.nextRunAt).toBe("2026-03-17T17:00:00.000Z");
    expect(mocked.sendBotTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 777,
        format: "raw",
        text: expect.stringContaining("Task failed"),
      }),
    );
    expect(mocked.sendBotTextMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("Build · 🧠"),
      }),
    );

    runtime.shutdown();
    vi.useRealTimers();
  });

  it("sends the timeout error text returned by executor", async () => {
    ({ ScheduledTaskRuntime: ScheduledTaskRuntimeClass } =
      await import("../../../src/app/services/scheduled-task-runtime-service.js"));
    ({ ForegroundSessionState: ForegroundSessionStateClass } =
      await import("../../../src/app/managers/foreground-session-state-manager.js"));
    const foregroundSessionState = new ForegroundSessionStateClass();

    const runtime = new ScheduledTaskRuntimeClass(foregroundSessionState);
    mocked.tasks = [createTask({ nextRunAt: "2026-03-16T09:59:00.000Z" })];
    mocked.executeScheduledTaskMock.mockResolvedValue({
      taskId: "task-1",
      status: "error",
      startedAt: "2026-03-16T10:00:00.000Z",
      finishedAt: "2026-03-16T10:01:00.000Z",
      resultText: null,
      errorMessage:
        "Request timed out after 300000ms. Check OpenCode model timeout settings: https://opencode.ai/docs/config/#models",
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-16T10:00:00.000Z"));

    await runtime.initialize({ api: {} } as Bot<Context>, await createDeliverySender());
    await vi.runAllTimersAsync();

    expect(mocked.sendBotTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 777,
        format: "raw",
        text: expect.stringContaining("https://opencode.ai/docs/config/#models"),
      }),
    );

    runtime.shutdown();
    vi.useRealTimers();
  });

  it("does not start the same scheduled task twice while it is already running", async () => {
    ({ ScheduledTaskRuntime: ScheduledTaskRuntimeClass } =
      await import("../../../src/app/services/scheduled-task-runtime-service.js"));
    ({ ForegroundSessionState: ForegroundSessionStateClass } =
      await import("../../../src/app/managers/foreground-session-state-manager.js"));
    const foregroundSessionState = new ForegroundSessionStateClass();

    const runtime = new ScheduledTaskRuntimeClass(foregroundSessionState);
    mocked.tasks = [createTask({ kind: "cron", nextRunAt: "2026-03-16T10:00:00.000Z" })];
    mocked.executeScheduledTaskMock.mockReturnValue(new Promise(() => undefined));

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-16T10:00:00.000Z"));

    await runtime.initialize({ api: {} } as Bot<Context>, await createDeliverySender());
    await Promise.resolve();

    (runtime as unknown as { startExecution(taskId: string): void }).startExecution("task-1");

    expect(mocked.executeScheduledTaskMock).toHaveBeenCalledTimes(1);

    runtime.shutdown();
    vi.useRealTimers();
  });

  it("does not recover or run a disabled cron task at startup", async () => {
    ({ ScheduledTaskRuntime: ScheduledTaskRuntimeClass } =
      await import("../../../src/app/services/scheduled-task-runtime-service.js"));
    ({ ForegroundSessionState: ForegroundSessionStateClass } =
      await import("../../../src/app/managers/foreground-session-state-manager.js"));
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-16T10:00:00.000Z"));
    mocked.tasks = [
      createTask({ kind: "cron", enabled: false, nextRunAt: null } as Partial<ScheduledTask>),
    ];
    const runtime = new ScheduledTaskRuntimeClass(new ForegroundSessionStateClass());
    await runtime.initialize({ api: {} } as Bot<Context>, await createDeliverySender());
    await vi.advanceTimersByTimeAsync(86400000);
    expect(mocked.executeScheduledTaskMock).not.toHaveBeenCalled();
    expect(mocked.tasks[0]?.nextRunAt).toBeNull();
    runtime.shutdown();
    vi.useRealTimers();
  });

  it("skips an overdue activation after restart without changing ordinary overdue recovery", async () => {
    ({ ScheduledTaskRuntime: ScheduledTaskRuntimeClass } =
      await import("../../../src/app/services/scheduled-task-runtime-service.js"));
    ({ ForegroundSessionState: ForegroundSessionStateClass } =
      await import("../../../src/app/managers/foreground-session-state-manager.js"));
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-16T10:00:00.000Z"));
    mocked.tasks = [
      createTask({
        kind: "cron",
        id: "activated",
        activationPending: true,
        nextRunAt: "2026-03-16T09:59:00.000Z",
      } as Partial<ScheduledTask>),
      createTask({ kind: "cron", id: "existing", nextRunAt: "2026-03-16T09:59:00.000Z" }),
    ];
    mocked.executeScheduledTaskMock.mockReturnValue(new Promise(() => undefined));
    const runtime = new ScheduledTaskRuntimeClass(new ForegroundSessionStateClass());
    await runtime.initialize({ api: {} } as Bot<Context>, await createDeliverySender());
    await vi.advanceTimersByTimeAsync(0);
    expect(mocked.executeScheduledTaskMock).toHaveBeenCalledTimes(1);
    expect(mocked.executeScheduledTaskMock.mock.calls[0]?.[0].id).toBe("existing");
    expect(mocked.tasks.find((task) => task.id === "activated")?.nextRunAt).toBe(
      "2026-03-16T17:00:00.000Z",
    );
    runtime.shutdown();
    vi.useRealTimers();
  });

  it("refreshes an activation whose first occurrence passed during save", async () => {
    ({ ScheduledTaskRuntime: ScheduledTaskRuntimeClass } =
      await import("../../../src/app/services/scheduled-task-runtime-service.js"));
    ({ ForegroundSessionState: ForegroundSessionStateClass } =
      await import("../../../src/app/managers/foreground-session-state-manager.js"));
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-16T10:00:00.000Z"));
    const runtime = new ScheduledTaskRuntimeClass(new ForegroundSessionStateClass());
    await runtime.initialize({ api: {} } as Bot<Context>, await createDeliverySender());
    mocked.tasks = [
      createTask({
        kind: "cron",
        activationPending: true,
        nextRunAt: "2026-03-16T09:59:00.000Z",
      } as Partial<ScheduledTask>),
    ];
    const task = await runtime.refreshTask("task-1");
    expect(task?.nextRunAt).toBe("2026-03-16T17:00:00.000Z");
    expect(mocked.executeScheduledTaskMock).not.toHaveBeenCalled();
    runtime.shutdown();
    vi.useRealTimers();
  });

  it("finishes and delivers a running cron task after it is disabled", async () => {
    ({ ScheduledTaskRuntime: ScheduledTaskRuntimeClass } =
      await import("../../../src/app/services/scheduled-task-runtime-service.js"));
    ({ ForegroundSessionState: ForegroundSessionStateClass } =
      await import("../../../src/app/managers/foreground-session-state-manager.js"));
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-16T10:00:00.000Z"));
    mocked.tasks = [createTask({ kind: "cron", nextRunAt: "2026-03-16T10:00:00.000Z" })];
    let finish!: (value: unknown) => void;
    mocked.executeScheduledTaskMock.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const send = vi.fn().mockResolvedValue(true);
    const runtime = new ScheduledTaskRuntimeClass(new ForegroundSessionStateClass());
    await runtime.initialize({ api: {} } as Bot<Context>, { send });
    await vi.advanceTimersByTimeAsync(0);
    mocked.tasks[0] = {
      ...defined(mocked.tasks[0]),
      enabled: false,
      nextRunAt: null,
    } as ScheduledTask;
    runtime.refreshTask("task-1");
    finish({
      status: "success",
      startedAt: "2026-03-16T10:00:00.000Z",
      finishedAt: "2026-03-16T10:01:00.000Z",
      resultText: "Done",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocked.tasks[0]).toMatchObject({
      enabled: false,
      nextRunAt: null,
      lastStatus: "success",
      runCount: 1,
    });
    expect(send).toHaveBeenCalledTimes(1);
    runtime.shutdown();
    vi.useRealTimers();
  });
});
