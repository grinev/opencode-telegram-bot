import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseTaskSchedule } from "../../../src/app/services/scheduled-task-schedule-parser-service.js";

const mocked = vi.hoisted(() => ({
  sessionCreateMock: vi.fn(),
  sessionWaitMock: vi.fn(),
  sessionPromptMock: vi.fn(),
  sessionMessagesMock: vi.fn(),
  directApiMock: vi.fn(),
  cleanupIgnoresMock: vi.fn(),
  registerIgnoreMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  loggerWarnMock: vi.fn(),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeV2: {
    session: {
      create: mocked.sessionCreateMock,
      wait: mocked.sessionWaitMock,
    },
  },
  sendSessionPrompt: mocked.sessionPromptMock,
  getSessionMessages: mocked.sessionMessagesMock,
  directApi: mocked.directApiMock,
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    error: mocked.loggerErrorMock,
    warn: mocked.loggerWarnMock,
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../../src/app/services/scheduled-task-session-ignore-service.js", () => ({
  cleanupScheduledTaskSessionIgnores: mocked.cleanupIgnoresMock,
  registerScheduledTaskSessionIgnore: mocked.registerIgnoreMock,
}));

function parserResponse(text: string) {
  return { data: [{ role: "assistant", text }], error: null };
}

describe("app/services/scheduled-task-schedule-parser-service", () => {
  beforeEach(() => {
    mocked.sessionCreateMock.mockReset();
    mocked.sessionWaitMock.mockReset();
    mocked.sessionPromptMock.mockReset();
    mocked.sessionMessagesMock.mockReset();
    mocked.directApiMock.mockReset();
    mocked.cleanupIgnoresMock.mockReset();
    mocked.registerIgnoreMock.mockReset();
    mocked.loggerErrorMock.mockReset();
    mocked.loggerWarnMock.mockReset();

    mocked.sessionCreateMock.mockResolvedValue({
      data: { data: { id: "temp-session" } },
      error: null,
    });
    mocked.sessionWaitMock.mockResolvedValue({ data: undefined, error: null });
    mocked.sessionPromptMock.mockResolvedValue({ data: undefined, error: null });
    mocked.directApiMock.mockResolvedValue({ data: null, error: null });
    mocked.cleanupIgnoresMock.mockResolvedValue(0);
    mocked.registerIgnoreMock.mockResolvedValue(undefined);
  });

  it("parses recurring schedule JSON and removes temporary session", async () => {
    mocked.sessionMessagesMock.mockResolvedValue(
      parserResponse(
        JSON.stringify({
          kind: "cron",
          cron: "*/5 * * * *",
          timezone: "UTC",
          summary: "Every 5 minutes",
          nextRunAt: "2026-03-15T10:05:00.000Z",
        }),
      ),
    );

    const result = await parseTaskSchedule("every 5 minutes", "D:/Projects/Repo");

    expect(result).toEqual({
      kind: "cron",
      cron: "*/5 * * * *",
      timezone: "UTC",
      summary: "Every 5 minutes",
      nextRunAt: "2026-03-15T10:05:00.000Z",
    });
    expect(mocked.sessionCreateMock).toHaveBeenCalledWith({
      location: { directory: "D:/Projects/Repo" },
    });
    expect(mocked.cleanupIgnoresMock).toHaveBeenCalledTimes(1);
    expect(mocked.registerIgnoreMock).toHaveBeenCalledWith("temp-session");
    expect(mocked.directApiMock).toHaveBeenCalledWith("DELETE", "/api/session/temp-session");
  });

  it("parses one-time schedule from fenced JSON", async () => {
    mocked.sessionMessagesMock.mockResolvedValue(
      parserResponse(
        [
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
      ),
    );

    const result = await parseTaskSchedule("tomorrow at 12:00", "D:/Projects/Repo");

    expect(result).toEqual({
      kind: "once",
      runAt: "2026-03-16T12:00:00.000Z",
      timezone: "UTC",
      summary: "Tomorrow at 12:00",
      nextRunAt: "2026-03-16T12:00:00.000Z",
    });
    expect(mocked.directApiMock).toHaveBeenCalledWith("DELETE", "/api/session/temp-session");
  });

  it("cleans up temporary session when parser returns invalid JSON", async () => {
    mocked.sessionMessagesMock.mockResolvedValue(parserResponse("not json"));

    await expect(parseTaskSchedule("every friday", "D:/Projects/Repo")).rejects.toThrow(
      "invalid JSON",
    );
    expect(mocked.directApiMock).toHaveBeenCalledWith("DELETE", "/api/session/temp-session");
  });

  it("passes the provided model and variant to the parser prompt", async () => {
    mocked.sessionMessagesMock.mockResolvedValue(
      parserResponse(
        JSON.stringify({
          kind: "once",
          runAt: "2026-03-16T12:00:00.000Z",
          timezone: "UTC",
          summary: "Tomorrow at 12:00",
          nextRunAt: "2026-03-16T12:00:00.000Z",
        }),
      ),
    );

    await parseTaskSchedule("tomorrow at 12:00", "D:/Projects/Repo", {
      providerID: "lmstudio",
      modelID: "qwen_qwen3_8-27b",
      variant: "low",
    });

    expect(mocked.sessionPromptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { providerID: "lmstudio", modelID: "qwen_qwen3_8-27b", variant: "low" },
      }),
    );
  });

  it("omits model from the parser prompt when none is provided", async () => {
    mocked.sessionMessagesMock.mockResolvedValue(
      parserResponse(
        JSON.stringify({
          kind: "cron",
          cron: "*/5 * * * *",
          timezone: "UTC",
          summary: "Every 5 minutes",
          nextRunAt: "2026-03-15T10:05:00.000Z",
        }),
      ),
    );

    await parseTaskSchedule("every 5 minutes", "D:/Projects/Repo");

    const promptOptions = mocked.sessionPromptMock.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(promptOptions.model).toBeUndefined();
  });
});
