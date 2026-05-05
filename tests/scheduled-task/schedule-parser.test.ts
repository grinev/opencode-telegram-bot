import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseTaskSchedule } from "../../src/scheduled-task/schedule-parser.js";

const mocked = vi.hoisted(() => ({
  sessionCreateMock: vi.fn(),
  sessionPromptMock: vi.fn(),
  sessionDeleteMock: vi.fn(),
  cleanupIgnoresMock: vi.fn(),
  registerIgnoreMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  loggerWarnMock: vi.fn(),
}));

vi.mock("../../src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      create: mocked.sessionCreateMock,
      prompt: mocked.sessionPromptMock,
      delete: mocked.sessionDeleteMock,
    },
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    error: mocked.loggerErrorMock,
    warn: mocked.loggerWarnMock,
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../src/scheduled-task/session-ignore.js", () => ({
  cleanupScheduledTaskSessionIgnores: mocked.cleanupIgnoresMock,
  registerScheduledTaskSessionIgnore: mocked.registerIgnoreMock,
}));

describe("scheduled-task/schedule-parser", () => {
  beforeEach(() => {
    mocked.sessionCreateMock.mockReset();
    mocked.sessionPromptMock.mockReset();
    mocked.sessionDeleteMock.mockReset();
    mocked.cleanupIgnoresMock.mockReset();
    mocked.registerIgnoreMock.mockReset();
    mocked.loggerErrorMock.mockReset();
    mocked.loggerWarnMock.mockReset();

    mocked.sessionCreateMock.mockResolvedValue({
      data: { id: "temp-session", directory: "D:/Projects/Repo" },
      error: null,
    });
    mocked.sessionDeleteMock.mockResolvedValue({ data: true, error: null });
    mocked.cleanupIgnoresMock.mockResolvedValue(0);
    mocked.registerIgnoreMock.mockResolvedValue(undefined);
  });

  it("parses recurring schedule JSON and removes temporary session", async () => {
    mocked.sessionPromptMock.mockResolvedValue({
      data: {
        parts: [
          {
            type: "text",
            text: JSON.stringify({
              kind: "cron",
              cron: "*/5 * * * *",
              timezone: "UTC",
              summary: "Every 5 minutes",
              nextRunAt: "2026-03-15T10:05:00.000Z",
            }),
          },
        ],
      },
      error: null,
    });

    const result = await parseTaskSchedule("every 5 minutes", "D:/Projects/Repo");

    expect(result).toEqual({
      kind: "cron",
      cron: "*/5 * * * *",
      timezone: "UTC",
      summary: "Every 5 minutes",
      nextRunAt: "2026-03-15T10:05:00.000Z",
    });
    expect(mocked.sessionCreateMock).toHaveBeenCalledWith({
      directory: "D:/Projects/Repo",
      title: "Scheduled task schedule parser",
    });
    expect(mocked.cleanupIgnoresMock).toHaveBeenCalledTimes(1);
    expect(mocked.registerIgnoreMock).toHaveBeenCalledWith("temp-session");
    expect(mocked.sessionDeleteMock).toHaveBeenCalledWith({ sessionID: "temp-session" });
  });

  it("parses one-time schedule from fenced JSON", async () => {
    mocked.sessionPromptMock.mockResolvedValue({
      data: {
        parts: [
          {
            type: "text",
            text: [
              "```json",
              JSON.stringify({
                kind: "once",
                runAt: "2026-03-16T12:00:00.000Z",
                timezone: "UTC",
                summary: "Tomorrow at 12:00",
                nextRunAt: "2026-03-16T12:00:00.000Z",
              }),
              "```",
            ].join("\n"),
          },
        ],
      },
      error: null,
    });

    const result = await parseTaskSchedule("tomorrow at 12:00", "D:/Projects/Repo");

    expect(result).toEqual({
      kind: "once",
      runAt: "2026-03-16T12:00:00.000Z",
      timezone: "UTC",
      summary: "Tomorrow at 12:00",
      nextRunAt: "2026-03-16T12:00:00.000Z",
    });
    expect(mocked.sessionDeleteMock).toHaveBeenCalledWith({ sessionID: "temp-session" });
  });

  it("cleans up temporary session when parser returns invalid JSON", async () => {
    mocked.sessionPromptMock.mockResolvedValue({
      data: {
        parts: [{ type: "text", text: "not json" }],
      },
      error: null,
    });

    await expect(parseTaskSchedule("every friday", "D:/Projects/Repo")).rejects.toThrow(
      "invalid JSON",
    );
    expect(mocked.sessionDeleteMock).toHaveBeenCalledWith({ sessionID: "temp-session" });
  });
});
