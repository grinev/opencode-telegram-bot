import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => {
  const sessionMessagesMock = vi.fn();
  return {
    sessionMessagesMock,
    loggerWarnMock: vi.fn(),
    loggerErrorMock: vi.fn(),
  };
});

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      messages: mocked.sessionMessagesMock,
    },
  },
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    error: mocked.loggerErrorMock,
    info: vi.fn(),
    warn: mocked.loggerWarnMock,
  },
}));

import { loadFullSessionHistory } from "../../../src/app/services/session-history-service.js";

function makeMessage(
  role: "user" | "assistant",
  text: string | null,
  created: number,
  options: { summary?: boolean } = {},
) {
  const parts: Array<{ type: string; text?: string }> = [];
  if (text !== null) {
    parts.push({ type: "text", text });
  }
  return {
    info: { role, summary: options.summary, time: { created } },
    parts,
  };
}

describe("session-history-service", () => {
  beforeEach(() => {
    mocked.sessionMessagesMock.mockReset();
  });

  it("returns empty result on API error", async () => {
    mocked.sessionMessagesMock.mockResolvedValue({ data: undefined, error: { code: "X" } });

    const result = await loadFullSessionHistory("ses_1", "/tmp/project");

    expect(result).toEqual({ entries: [], totalConversationMessages: 0 });
  });

  it("filters to user/assistant text messages, skips summaries, sorts oldest first", async () => {
    mocked.sessionMessagesMock.mockResolvedValue({
      data: [
        makeMessage("assistant", "later reply", 200),
        makeMessage("assistant", null, 150), // tool-only message: no text parts
        makeMessage("assistant", "summary only", 120, { summary: true }),
        makeMessage("user", "first question", 100),
      ],
      error: undefined,
    });

    const result = await loadFullSessionHistory("ses_1", "/tmp/project");

    expect(result.totalConversationMessages).toBe(2);
    expect(result.entries.map((entry) => entry.text)).toEqual(["first question", "later reply"]);
    expect(result.entries.map((entry) => entry.role)).toEqual(["user", "assistant"]);
  });

  it("requests all messages without a limit param", async () => {
    mocked.sessionMessagesMock.mockResolvedValue({ data: [], error: undefined });

    await loadFullSessionHistory("ses_1", "/tmp/project");

    expect(mocked.sessionMessagesMock).toHaveBeenCalledWith({
      sessionID: "ses_1",
      directory: "/tmp/project",
    });
  });

  it("truncates to the newest N messages when HISTORY_RENDER_LIMIT is exceeded", async () => {
    const messages = Array.from({ length: 10 }, (_, index) =>
      makeMessage(index % 2 === 0 ? "user" : "assistant", `msg-${index}`, index),
    );
    mocked.sessionMessagesMock.mockResolvedValue({ data: messages, error: undefined });

    process.env.HISTORY_RENDER_LIMIT = "3";
    try {
      // config is loaded once at import time; re-import through dynamic import
      // is overkill for this suite — assert via a fresh module registry instead.
      vi.resetModules();
      const { loadFullSessionHistory: freshLoad } = await import(
        "../../../src/app/services/session-history-service.js"
      );
      const result = await freshLoad("ses_1", "/tmp/project");

      expect(result.totalConversationMessages).toBe(10);
      expect(result.entries.map((entry) => entry.text)).toEqual(["msg-7", "msg-8", "msg-9"]);
    } finally {
      delete process.env.HISTORY_RENDER_LIMIT;
      vi.resetModules();
    }
  });

  it("keeps everything when HISTORY_RENDER_LIMIT is 0 (unlimited)", async () => {
    const messages = Array.from({ length: 5 }, (_, index) =>
      makeMessage(index % 2 === 0 ? "user" : "assistant", `msg-${index}`, index),
    );
    mocked.sessionMessagesMock.mockResolvedValue({ data: messages, error: undefined });

    process.env.HISTORY_RENDER_LIMIT = "0";
    try {
      vi.resetModules();
      const { loadFullSessionHistory: freshLoad } = await import(
        "../../../src/app/services/session-history-service.js"
      );
      const result = await freshLoad("ses_1", "/tmp/project");

      expect(result.totalConversationMessages).toBe(5);
      expect(result.entries).toHaveLength(5);
    } finally {
      delete process.env.HISTORY_RENDER_LIMIT;
      vi.resetModules();
    }
  });

  it("handles exceptions from the client without throwing", async () => {
    mocked.sessionMessagesMock.mockRejectedValue(new Error("boom"));

    const result = await loadFullSessionHistory("ses_1", "/tmp/project");

    expect(result).toEqual({ entries: [], totalConversationMessages: 0 });
  });
});
