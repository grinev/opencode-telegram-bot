import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduledOnceTask } from "../../src/scheduled-task/types.js";

const mocked = vi.hoisted(() => ({
  createMock: vi.fn(),
  promptAsyncMock: vi.fn(),
  messagesMock: vi.fn(),
  statusMock: vi.fn(),
  deleteMock: vi.fn(),
  loggerWarnMock: vi.fn(),
}));

vi.mock("../../src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      create: mocked.createMock,
      promptAsync: mocked.promptAsyncMock,
      messages: mocked.messagesMock,
      status: mocked.statusMock,
      delete: mocked.deleteMock,
    },
  },
}));

vi.mock("../../src/config.js", () => ({
  config: {
    bot: {
      scheduledTaskExecutionTimeoutMinutes: 120,
    },
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    warn: mocked.loggerWarnMock,
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

function createTask(partial: Partial<ScheduledOnceTask> = {}): ScheduledOnceTask {
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

function createAssistantMessage(
  text: string,
  options: { completed?: boolean; error?: unknown } = {},
) {
  return {
    info: {
      id: "assistant-1",
      sessionID: "session-1",
      role: "assistant" as const,
      time: options.completed
        ? { created: Date.now(), completed: Date.now() }
        : { created: Date.now() },
      parentID: "user-1",
      modelID: "gpt-5",
      providerID: "openai",
      mode: "default",
      agent: "build",
      path: { cwd: "D:\\Projects\\Repo", root: "D:\\Projects\\Repo" },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      error: options.error,
    },
    parts: text
      ? [{ id: "part-1", sessionID: "session-1", messageID: "assistant-1", type: "text", text }]
      : [],
  };
}

describe("scheduled-task/executor", () => {
  beforeEach(() => {
    mocked.createMock.mockReset();
    mocked.promptAsyncMock.mockReset();
    mocked.messagesMock.mockReset();
    mocked.statusMock.mockReset();
    mocked.deleteMock.mockReset();
    mocked.loggerWarnMock.mockReset();
    mocked.deleteMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts scheduled task with promptAsync and polls until the assistant reply completes", async () => {
    const { executeScheduledTask } = await import("../../src/scheduled-task/executor.js");

    mocked.createMock.mockResolvedValueOnce({
      data: { id: "session-1", directory: "D:\\Projects\\Repo", title: "Scheduled task run" },
      error: null,
    });
    mocked.promptAsyncMock.mockResolvedValueOnce({ data: undefined, error: null });
    mocked.messagesMock.mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce({
      data: [createAssistantMessage("Finished successfully", { completed: true })],
      error: null,
    });
    mocked.statusMock.mockResolvedValueOnce({
      data: { "session-1": { type: "busy" } },
      error: null,
    });

    vi.useFakeTimers();

    const resultPromise = executeScheduledTask(createTask());

    await vi.advanceTimersByTimeAsync(2000);

    await expect(resultPromise).resolves.toMatchObject({
      taskId: "task-1",
      status: "success",
      resultText: "Finished successfully",
      errorMessage: null,
    });
    expect(mocked.promptAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: "session-1",
        directory: "D:\\Projects\\Repo",
        agent: "build",
        variant: "default",
      }),
    );
    expect(mocked.statusMock).toHaveBeenCalledTimes(1);
    expect(mocked.messagesMock).toHaveBeenCalledTimes(2);
    expect(mocked.deleteMock).toHaveBeenCalledWith({ sessionID: "session-1" });
  });

  it("re-reads messages after idle before returning the assistant result", async () => {
    const { executeScheduledTask } = await import("../../src/scheduled-task/executor.js");

    mocked.createMock.mockResolvedValueOnce({
      data: { id: "session-1", directory: "D:\\Projects\\Repo", title: "Scheduled task run" },
      error: null,
    });
    mocked.promptAsyncMock.mockResolvedValueOnce({ data: undefined, error: null });
    mocked.messagesMock
      .mockResolvedValueOnce({
        data: [createAssistantMessage("Partial output")],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [createAssistantMessage("Final completed output", { completed: true })],
        error: null,
      });
    mocked.statusMock.mockResolvedValueOnce({
      data: { "session-1": { type: "idle" } },
      error: null,
    });

    await expect(executeScheduledTask(createTask())).resolves.toMatchObject({
      status: "success",
      resultText: "Final completed output",
      errorMessage: null,
    });
    expect(mocked.messagesMock).toHaveBeenCalledTimes(2);
  });

  it("returns a helpful timeout message when promptAsync fails with timeout", async () => {
    const { executeScheduledTask } = await import("../../src/scheduled-task/executor.js");

    mocked.createMock.mockResolvedValueOnce({
      data: { id: "session-1", directory: "D:\\Projects\\Repo", title: "Scheduled task run" },
      error: null,
    });
    mocked.promptAsyncMock.mockResolvedValueOnce({
      data: undefined,
      error: new Error("Request timed out after 300000ms"),
    });

    await expect(executeScheduledTask(createTask())).resolves.toMatchObject({
      status: "error",
      resultText: null,
      errorMessage: expect.stringContaining("https://opencode.ai/docs/config/#models"),
    });
    expect(mocked.messagesMock).not.toHaveBeenCalled();
    expect(mocked.deleteMock).toHaveBeenCalledWith({ sessionID: "session-1" });
  });

  it("returns a helpful timeout message when assistant result contains a timeout error", async () => {
    const { executeScheduledTask } = await import("../../src/scheduled-task/executor.js");

    mocked.createMock.mockResolvedValueOnce({
      data: { id: "session-1", directory: "D:\\Projects\\Repo", title: "Scheduled task run" },
      error: null,
    });
    mocked.promptAsyncMock.mockResolvedValueOnce({ data: undefined, error: null });
    mocked.messagesMock.mockResolvedValueOnce({
      data: [
        createAssistantMessage("", {
          completed: true,
          error: { name: "APIError", data: { message: "Model request timed out" } },
        }),
      ],
      error: null,
    });

    await expect(executeScheduledTask(createTask())).resolves.toMatchObject({
      status: "error",
      resultText: null,
      errorMessage: expect.stringContaining("Check OpenCode model timeout settings"),
    });
  });

  it("fails when execution stays busy beyond the bot polling deadline", async () => {
    const { executeScheduledTask } = await import("../../src/scheduled-task/executor.js");

    mocked.createMock.mockResolvedValueOnce({
      data: { id: "session-1", directory: "D:\\Projects\\Repo", title: "Scheduled task run" },
      error: null,
    });
    mocked.promptAsyncMock.mockResolvedValueOnce({ data: undefined, error: null });
    mocked.messagesMock.mockResolvedValue({ data: [], error: null });
    mocked.statusMock.mockResolvedValue({
      data: { "session-1": { type: "busy" } },
      error: null,
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-16T10:00:00.000Z"));

    const resultPromise = executeScheduledTask(createTask());

    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000 + 2000);

    await expect(resultPromise).resolves.toMatchObject({
      status: "error",
      resultText: null,
      errorMessage: "Scheduled task exceeded bot execution timeout after 120 minutes.",
    });
    expect(mocked.deleteMock).toHaveBeenCalledWith({ sessionID: "session-1" });
  });

  it("treats an empty completed assistant reply as an execution error", async () => {
    const { executeScheduledTask } = await import("../../src/scheduled-task/executor.js");

    mocked.createMock.mockResolvedValueOnce({
      data: { id: "session-1", directory: "D:\\Projects\\Repo", title: "Scheduled task run" },
      error: null,
    });
    mocked.promptAsyncMock.mockResolvedValueOnce({ data: undefined, error: null });
    mocked.messagesMock.mockResolvedValueOnce({
      data: [createAssistantMessage("", { completed: true })],
      error: null,
    });

    await expect(executeScheduledTask(createTask())).resolves.toMatchObject({
      status: "error",
      resultText: null,
      errorMessage: "Scheduled task returned an empty assistant response",
    });
  });

  it("keeps the successful result even if temporary session cleanup fails", async () => {
    const { executeScheduledTask } = await import("../../src/scheduled-task/executor.js");

    mocked.createMock.mockResolvedValueOnce({
      data: { id: "session-1", directory: "D:\\Projects\\Repo", title: "Scheduled task run" },
      error: null,
    });
    mocked.promptAsyncMock.mockResolvedValueOnce({ data: undefined, error: null });
    mocked.messagesMock.mockResolvedValueOnce({
      data: [createAssistantMessage("All good", { completed: true })],
      error: null,
    });
    mocked.deleteMock.mockRejectedValueOnce(new Error("cleanup failed"));

    await expect(executeScheduledTask(createTask())).resolves.toMatchObject({
      status: "success",
      resultText: "All good",
      errorMessage: null,
    });
    expect(mocked.loggerWarnMock).toHaveBeenCalledWith(
      expect.stringContaining("Failed to delete temporary session"),
      expect.any(Error),
    );
  });
});
