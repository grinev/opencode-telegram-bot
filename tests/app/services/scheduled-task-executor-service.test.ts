import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduledOnceTask } from "../../../src/app/types/scheduled-task.js";

const mocked = vi.hoisted(() => ({
  createMock: vi.fn(),
  sendSessionPromptMock: vi.fn(),
  messagesMock: vi.fn(),
  statusMock: vi.fn(),
  interruptMock: vi.fn(),
  directApiMock: vi.fn(),
  questionListMock: vi.fn(),
  questionRejectMock: vi.fn(),
  permissionListMock: vi.fn(),
  permissionReplyMock: vi.fn(),
  cleanupIgnoresMock: vi.fn(),
  registerIgnoreMock: vi.fn(),
  loggerWarnMock: vi.fn(),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeV2: {
    session: {
      create: mocked.createMock,
      messages: mocked.messagesMock,
      interrupt: mocked.interruptMock,
      question: {
        list: mocked.questionListMock,
        reject: mocked.questionRejectMock,
      },
      permission: {
        list: mocked.permissionListMock,
        reply: mocked.permissionReplyMock,
      },
    },
  },
  getBusySessionStatuses: mocked.statusMock,
  sendSessionPrompt: mocked.sendSessionPromptMock,
  directApi: mocked.directApiMock,
}));

vi.mock("../../../src/config.js", () => ({
  config: {
    bot: {
      scheduledTaskExecutionTimeoutMinutes: 120,
    },
  },
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    warn: mocked.loggerWarnMock,
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../../src/app/services/scheduled-task-session-ignore-service.js", () => ({
  cleanupScheduledTaskSessionIgnores: mocked.cleanupIgnoresMock,
  registerScheduledTaskSessionIgnore: mocked.registerIgnoreMock,
}));

function createTask(partial: Partial<ScheduledOnceTask> = {}): ScheduledOnceTask {
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
  };
}

// v2 assistant message (flat shape: type/content/time/finish/error).
function createAssistantMessage(
  text: string,
  options: {
    completed?: boolean;
    error?: unknown;
    finish?: string;
  } = {},
) {
  const content: Array<Record<string, unknown>> = [];
  if (text) {
    content.push({ type: "text", text });
  }

  return {
    type: "assistant",
    id: "assistant-1",
    time: options.completed
      ? { created: Date.now(), completed: Date.now() }
      : { created: Date.now() },
    ...(options.finish !== undefined ? { finish: options.finish } : {}),
    ...(options.error !== undefined ? { error: options.error } : {}),
    content,
  };
}

describe("app/services/scheduled-task-executor-service", () => {
  beforeEach(() => {
    mocked.createMock.mockReset();
    mocked.sendSessionPromptMock.mockReset();
    mocked.messagesMock.mockReset();
    mocked.statusMock.mockReset();
    mocked.interruptMock.mockReset();
    mocked.directApiMock.mockReset();
    mocked.questionListMock.mockReset();
    mocked.questionRejectMock.mockReset();
    mocked.permissionListMock.mockReset();
    mocked.permissionReplyMock.mockReset();
    mocked.cleanupIgnoresMock.mockReset();
    mocked.registerIgnoreMock.mockReset();
    mocked.loggerWarnMock.mockReset();
    mocked.questionListMock.mockResolvedValue({ data: { data: [] }, error: null });
    mocked.questionRejectMock.mockResolvedValue({ data: true, error: null });
    mocked.permissionListMock.mockResolvedValue({ data: { data: [] }, error: null });
    mocked.permissionReplyMock.mockResolvedValue({ data: true, error: null });
    mocked.interruptMock.mockResolvedValue({ data: true, error: null });
    mocked.directApiMock.mockResolvedValue({ data: null, error: null });
    mocked.cleanupIgnoresMock.mockResolvedValue(0);
    mocked.registerIgnoreMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts scheduled task with prompt and polls until the assistant reply completes", async () => {
    const { executeScheduledTask } = await import(
      "../../../src/app/services/scheduled-task-executor-service.js"
    );

    mocked.createMock.mockResolvedValueOnce({
      data: { data: { id: "session-1" } },
      error: null,
    });
    mocked.sendSessionPromptMock.mockResolvedValueOnce({ data: undefined, error: null });
    mocked.messagesMock.mockResolvedValueOnce({ data: { data: [] }, error: null }).mockResolvedValueOnce({
      data: { data: [createAssistantMessage("Finished successfully", { completed: true })] },
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
    expect(mocked.sendSessionPromptMock).toHaveBeenCalledWith({
      sessionID: "session-1",
      text: "Send report",
      agent: "build",
      model: { providerID: "openai", modelID: "gpt-5", variant: "default" },
    });
    expect(mocked.statusMock).toHaveBeenCalledTimes(1);
    expect(mocked.messagesMock).toHaveBeenCalledTimes(2);
    expect(mocked.cleanupIgnoresMock).toHaveBeenCalledTimes(1);
    expect(mocked.registerIgnoreMock).toHaveBeenCalledWith("session-1");
    expect(mocked.directApiMock).toHaveBeenCalledWith("DELETE", "/api/session/session-1");
  });

  it("passes the task's stored agent to the prompt", async () => {
    const { executeScheduledTask } = await import(
      "../../../src/app/services/scheduled-task-executor-service.js"
    );

    mocked.createMock.mockResolvedValueOnce({
      data: { data: { id: "session-1" } },
      error: null,
    });
    mocked.sendSessionPromptMock.mockResolvedValueOnce({ data: undefined, error: null });
    mocked.messagesMock.mockResolvedValueOnce({
      data: { data: [createAssistantMessage("Done", { completed: true })] },
      error: null,
    });

    await expect(executeScheduledTask(createTask({ agent: "plan" }))).resolves.toMatchObject({
      status: "success",
      resultText: "Done",
      errorMessage: null,
    });
    expect(mocked.sendSessionPromptMock).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "plan" }),
    );
  });

  it("re-reads messages after idle before returning the assistant result", async () => {
    const { executeScheduledTask } = await import(
      "../../../src/app/services/scheduled-task-executor-service.js"
    );

    mocked.createMock.mockResolvedValueOnce({
      data: { data: { id: "session-1" } },
      error: null,
    });
    mocked.sendSessionPromptMock.mockResolvedValueOnce({ data: undefined, error: null });
    mocked.messagesMock
      .mockResolvedValueOnce({
        data: { data: [createAssistantMessage("Partial output")] },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { data: [createAssistantMessage("Final completed output", { completed: true })] },
        error: null,
      });
    mocked.statusMock.mockResolvedValueOnce({
      data: {},
      error: null,
    });

    await expect(executeScheduledTask(createTask())).resolves.toMatchObject({
      status: "success",
      resultText: "Final completed output",
      errorMessage: null,
    });
    expect(mocked.messagesMock).toHaveBeenCalledTimes(2);
  });

  it("returns a helpful timeout message when the prompt fails with timeout", async () => {
    const { executeScheduledTask } = await import(
      "../../../src/app/services/scheduled-task-executor-service.js"
    );

    mocked.createMock.mockResolvedValueOnce({
      data: { data: { id: "session-1" } },
      error: null,
    });
    mocked.sendSessionPromptMock.mockResolvedValueOnce({
      data: undefined,
      error: new Error("Request timed out after 300000ms"),
    });

    await expect(executeScheduledTask(createTask())).resolves.toMatchObject({
      status: "error",
      resultText: null,
      errorMessage: expect.stringContaining("https://opencode.ai/docs/config/#models"),
    });
    expect(mocked.messagesMock).not.toHaveBeenCalled();
    expect(mocked.directApiMock).toHaveBeenCalledWith("DELETE", "/api/session/session-1");
  });

  it("returns a helpful timeout message when assistant result contains a timeout error", async () => {
    const { executeScheduledTask } = await import(
      "../../../src/app/services/scheduled-task-executor-service.js"
    );

    mocked.createMock.mockResolvedValueOnce({
      data: { data: { id: "session-1" } },
      error: null,
    });
    mocked.sendSessionPromptMock.mockResolvedValueOnce({ data: undefined, error: null });
    mocked.messagesMock.mockResolvedValueOnce({
      data: {
        data: [
          createAssistantMessage("", {
            completed: true,
            error: { name: "APIError", data: { message: "Model request timed out" } },
          }),
        ],
      },
      error: null,
    });

    await expect(executeScheduledTask(createTask())).resolves.toMatchObject({
      status: "error",
      resultText: null,
      errorMessage: expect.stringContaining("Check OpenCode model timeout settings"),
    });
  });

  it("fails when execution stays busy beyond the bot polling deadline", async () => {
    const { executeScheduledTask } = await import(
      "../../../src/app/services/scheduled-task-executor-service.js"
    );

    mocked.createMock.mockResolvedValueOnce({
      data: { data: { id: "session-1" } },
      error: null,
    });
    mocked.sendSessionPromptMock.mockResolvedValueOnce({ data: undefined, error: null });
    mocked.messagesMock.mockResolvedValue({ data: { data: [] }, error: null });
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
    expect(mocked.directApiMock).toHaveBeenCalledWith("DELETE", "/api/session/session-1");
  });

  it("waits through startup before the server registers the session as active", async () => {
    const { executeScheduledTask } = await import(
      "../../../src/app/services/scheduled-task-executor-service.js"
    );

    mocked.createMock.mockResolvedValueOnce({
      data: { data: { id: "session-1" } },
      error: null,
    });
    mocked.sendSessionPromptMock.mockResolvedValueOnce({ data: undefined, error: null });

    mocked.messagesMock.mockResolvedValue({
      data: { data: [createAssistantMessage("Started late but finished", { completed: true })] },
      error: null,
    });
    for (let index = 0; index < 7; index += 1) {
      mocked.messagesMock.mockResolvedValueOnce({ data: { data: [] }, error: null });
    }

    mocked.statusMock.mockResolvedValue({
      data: { "session-1": { type: "busy" } },
      error: null,
    });
    mocked.statusMock
      .mockResolvedValueOnce({ data: {}, error: null })
      .mockResolvedValueOnce({ data: {}, error: null })
      .mockResolvedValueOnce({ data: {}, error: null });

    vi.useFakeTimers();

    const resultPromise = executeScheduledTask(createTask());

    await vi.advanceTimersByTimeAsync(12000);

    await expect(resultPromise).resolves.toMatchObject({
      taskId: "task-1",
      status: "success",
      resultText: "Started late but finished",
      errorMessage: null,
    });
    expect(mocked.statusMock.mock.calls.length).toBeGreaterThan(3);
    expect(mocked.loggerWarnMock).not.toHaveBeenCalledWith(
      expect.stringContaining("Scheduled task finished without a completed assistant response"),
    );
    expect(mocked.directApiMock).toHaveBeenCalledWith("DELETE", "/api/session/session-1");
  });

  it("treats an empty completed assistant reply as an execution error", async () => {
    const { executeScheduledTask } = await import(
      "../../../src/app/services/scheduled-task-executor-service.js"
    );

    mocked.createMock.mockResolvedValueOnce({
      data: { data: { id: "session-1" } },
      error: null,
    });
    mocked.sendSessionPromptMock.mockResolvedValueOnce({ data: undefined, error: null });
    mocked.messagesMock.mockResolvedValue({
      data: { data: [createAssistantMessage("", { completed: true, finish: "stop" })] },
      error: null,
    });

    vi.useFakeTimers();

    const resultPromise = executeScheduledTask(createTask());

    await vi.advanceTimersByTimeAsync(1500);

    await expect(resultPromise).resolves.toMatchObject({
      status: "error",
      resultText: null,
      errorMessage: "Scheduled task returned an empty assistant response",
    });
    expect(mocked.messagesMock).toHaveBeenCalledTimes(4);
    expect(mocked.directApiMock).not.toHaveBeenCalledWith("DELETE", "/api/session/session-1");
    expect(mocked.loggerWarnMock).toHaveBeenCalledWith(
      "[ScheduledTaskExecutor] Empty completed assistant response diagnostics",
      expect.objectContaining({
        taskId: "task-1",
        sessionId: "session-1",
        directory: "D:\\Projects\\Repo",
        readCount: 4,
        assistantMessage: expect.objectContaining({
          completed: true,
          summary: false,
          finish: "stop",
          parts: [],
        }),
      }),
    );
    expect(mocked.loggerWarnMock).toHaveBeenCalledWith(
      expect.stringContaining("Keeping temporary session for inspection"),
    );
  });

  it("re-reads an empty completed assistant reply before accepting late text", async () => {
    const { executeScheduledTask } = await import(
      "../../../src/app/services/scheduled-task-executor-service.js"
    );

    mocked.createMock.mockResolvedValueOnce({
      data: { data: { id: "session-1" } },
      error: null,
    });
    mocked.sendSessionPromptMock.mockResolvedValueOnce({ data: undefined, error: null });
    mocked.messagesMock
      .mockResolvedValueOnce({
        data: { data: [createAssistantMessage("", { completed: true })] },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { data: [createAssistantMessage("", { completed: true })] },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { data: [createAssistantMessage("", { completed: true })] },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { data: [createAssistantMessage("Late completed output", { completed: true })] },
        error: null,
      });

    vi.useFakeTimers();

    const resultPromise = executeScheduledTask(createTask());

    await vi.advanceTimersByTimeAsync(1500);

    await expect(resultPromise).resolves.toMatchObject({
      status: "success",
      resultText: "Late completed output",
      errorMessage: null,
    });
    expect(mocked.messagesMock).toHaveBeenCalledTimes(4);
    expect(mocked.directApiMock).toHaveBeenCalledWith("DELETE", "/api/session/session-1");
  });

  it("waits for the final assistant response after completed tool-call turns", async () => {
    const { executeScheduledTask } = await import(
      "../../../src/app/services/scheduled-task-executor-service.js"
    );

    const toolCallTurn = createAssistantMessage("", {
      completed: true,
      finish: "tool-calls",
    });

    mocked.createMock.mockResolvedValueOnce({
      data: { data: { id: "session-1" } },
      error: null,
    });
    mocked.sendSessionPromptMock.mockResolvedValueOnce({ data: undefined, error: null });
    mocked.messagesMock
      .mockResolvedValueOnce({ data: { data: [toolCallTurn] }, error: null })
      .mockResolvedValueOnce({ data: { data: [toolCallTurn] }, error: null })
      .mockResolvedValueOnce({ data: { data: [toolCallTurn] }, error: null })
      .mockResolvedValueOnce({ data: { data: [toolCallTurn] }, error: null })
      .mockResolvedValueOnce({
        data: {
          data: [
            toolCallTurn,
            createAssistantMessage("SCHEDULED_TASK_FINAL_OK", {
              completed: true,
              finish: "stop",
            }),
          ],
        },
        error: null,
      });
    mocked.statusMock.mockResolvedValue({
      data: { "session-1": { type: "busy" } },
      error: null,
    });

    vi.useFakeTimers();

    const resultPromise = executeScheduledTask(createTask());

    await vi.advanceTimersByTimeAsync(8000);

    await expect(resultPromise).resolves.toMatchObject({
      status: "success",
      resultText: "SCHEDULED_TASK_FINAL_OK",
      errorMessage: null,
    });
    expect(mocked.messagesMock).toHaveBeenCalledTimes(5);
    expect(mocked.statusMock).toHaveBeenCalledTimes(4);
    expect(mocked.directApiMock).toHaveBeenCalledWith("DELETE", "/api/session/session-1");
    expect(mocked.loggerWarnMock).not.toHaveBeenCalledWith(
      "[ScheduledTaskExecutor] Empty completed assistant response diagnostics",
      expect.anything(),
    );
  });

  it("ignores technical summary assistant messages when finding the scheduled task result", async () => {
    const { executeScheduledTask } = await import(
      "../../../src/app/services/scheduled-task-executor-service.js"
    );

    mocked.createMock.mockResolvedValueOnce({
      data: { data: { id: "session-1" } },
      error: null,
    });
    mocked.sendSessionPromptMock.mockResolvedValueOnce({ data: undefined, error: null });
    mocked.messagesMock.mockResolvedValueOnce({
      data: {
        data: [
          createAssistantMessage("Real scheduled result", { completed: true }),
          {
            type: "compaction",
            id: "compaction-1",
            reason: "auto",
            summary: "summary",
            recent: "recent",
            time: { created: Date.now() },
          },
        ],
      },
      error: null,
    });

    await expect(executeScheduledTask(createTask())).resolves.toMatchObject({
      status: "success",
      resultText: "Real scheduled result",
      errorMessage: null,
    });
    expect(mocked.directApiMock).toHaveBeenCalledWith("DELETE", "/api/session/session-1");
  });

  it("fails, rejects, aborts, and cleans up when scheduled task asks a question", async () => {
    const { executeScheduledTask } = await import(
      "../../../src/app/services/scheduled-task-executor-service.js"
    );

    mocked.createMock.mockResolvedValueOnce({
      data: { data: { id: "session-1" } },
      error: null,
    });
    mocked.sendSessionPromptMock.mockResolvedValueOnce({ data: undefined, error: null });
    mocked.questionListMock.mockResolvedValueOnce({
      data: {
        data: [
          {
            id: "question-1",
            sessionID: "session-1",
            questions: [{ header: "Choice", question: "Continue?", options: [] }],
          },
        ],
      },
      error: null,
    });

    await expect(executeScheduledTask(createTask())).resolves.toMatchObject({
      status: "error",
      resultText: null,
      errorMessage: "Scheduled task requested an interactive question and cannot continue unattended.",
    });
    expect(mocked.questionRejectMock).toHaveBeenCalledWith({
      sessionID: "session-1",
      requestID: "question-1",
    });
    expect(mocked.interruptMock).toHaveBeenCalledWith({
      sessionID: "session-1",
    });
    expect(mocked.directApiMock).toHaveBeenCalledWith("DELETE", "/api/session/session-1");
    expect(mocked.messagesMock).not.toHaveBeenCalled();
  });

  it("fails, rejects, aborts, and cleans up when scheduled task asks permission", async () => {
    const { executeScheduledTask } = await import(
      "../../../src/app/services/scheduled-task-executor-service.js"
    );

    mocked.createMock.mockResolvedValueOnce({
      data: { data: { id: "session-1" } },
      error: null,
    });
    mocked.sendSessionPromptMock.mockResolvedValueOnce({ data: undefined, error: null });
    mocked.permissionListMock.mockResolvedValueOnce({
      data: {
        data: [
          {
            id: "permission-1",
            sessionID: "session-1",
            action: "edit",
            resources: ["src/index.ts"],
            metadata: {},
            save: [],
          },
        ],
      },
      error: null,
    });

    await expect(executeScheduledTask(createTask())).resolves.toMatchObject({
      status: "error",
      resultText: null,
      errorMessage: "Scheduled task requested interactive permission and cannot continue unattended.",
    });
    expect(mocked.permissionReplyMock).toHaveBeenCalledWith({
      sessionID: "session-1",
      requestID: "permission-1",
      reply: "reject",
      message: "Scheduled task cannot continue because it requires interactive permission.",
    });
    expect(mocked.interruptMock).toHaveBeenCalledWith({
      sessionID: "session-1",
    });
    expect(mocked.directApiMock).toHaveBeenCalledWith("DELETE", "/api/session/session-1");
    expect(mocked.messagesMock).not.toHaveBeenCalled();
  });

  it("ignores pending interactive requests for other sessions", async () => {
    const { executeScheduledTask } = await import(
      "../../../src/app/services/scheduled-task-executor-service.js"
    );

    mocked.createMock.mockResolvedValueOnce({
      data: { data: { id: "session-1" } },
      error: null,
    });
    mocked.sendSessionPromptMock.mockResolvedValueOnce({ data: undefined, error: null });
    mocked.questionListMock.mockResolvedValueOnce({
      data: {
        data: [
          {
            id: "question-1",
            sessionID: "other-session",
            questions: [{ header: "Choice", question: "Continue?", options: [] }],
          },
        ],
      },
      error: null,
    });
    mocked.permissionListMock.mockResolvedValueOnce({
      data: {
        data: [
          {
            id: "permission-1",
            sessionID: "other-session",
            action: "edit",
            resources: ["src/index.ts"],
            metadata: {},
            save: [],
          },
        ],
      },
      error: null,
    });
    mocked.messagesMock.mockResolvedValueOnce({
      data: { data: [createAssistantMessage("Done", { completed: true })] },
      error: null,
    });

    await expect(executeScheduledTask(createTask())).resolves.toMatchObject({
      status: "success",
      resultText: "Done",
      errorMessage: null,
    });
    expect(mocked.questionRejectMock).not.toHaveBeenCalled();
    expect(mocked.permissionReplyMock).not.toHaveBeenCalled();
    expect(mocked.interruptMock).not.toHaveBeenCalled();
    expect(mocked.directApiMock).toHaveBeenCalledWith("DELETE", "/api/session/session-1");
  });

  it("keeps the successful result even if temporary session cleanup fails", async () => {
    const { executeScheduledTask } = await import(
      "../../../src/app/services/scheduled-task-executor-service.js"
    );

    mocked.createMock.mockResolvedValueOnce({
      data: { data: { id: "session-1" } },
      error: null,
    });
    mocked.sendSessionPromptMock.mockResolvedValueOnce({ data: undefined, error: null });
    mocked.messagesMock.mockResolvedValueOnce({
      data: { data: [createAssistantMessage("All good", { completed: true })] },
      error: null,
    });
    mocked.directApiMock.mockImplementation((method: string) =>
      method === "DELETE"
        ? Promise.reject(new Error("cleanup failed"))
        : Promise.resolve({ data: null, error: null }),
    );

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
