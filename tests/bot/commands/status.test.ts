import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { statusCommand } from "../../../src/bot/commands/status-command.js";

const botVersion = (JSON.parse(readFileSync("package.json", "utf-8")) as { version: string })
  .version;

const mocked = vi.hoisted(() => ({
  healthMock: vi.fn(),
  getCurrentSessionMock: vi.fn(),
  getCurrentProjectMock: vi.fn(),
  fetchCurrentAgentMock: vi.fn(),
  fetchCurrentModelMock: vi.fn(),
  getGitWorktreeContextMock: vi.fn(),
  keyboardInitializeMock: vi.fn(),
  keyboardUpdateContextMock: vi.fn(),
  keyboardGetKeyboardMock: vi.fn(),
  pinnedIsInitializedMock: vi.fn(),
  pinnedInitializeMock: vi.fn(),
  pinnedGetContextLimitMock: vi.fn(),
  pinnedRefreshContextLimitMock: vi.fn(),
  pinnedGetContextInfoMock: vi.fn(),
  sendBotTextMock: vi.fn(),
  loggerDebugMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    debug: mocked.loggerDebugMock,
    info: mocked.loggerInfoMock,
    warn: mocked.loggerWarnMock,
    error: mocked.loggerErrorMock,
  },
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    global: {
      health: mocked.healthMock,
    },
  },
}));

vi.mock("../../../src/app/services/session-service.js", () => ({
  getCurrentSession: mocked.getCurrentSessionMock,
}));

vi.mock("../../../src/app/stores/settings-store.js", () => ({
  getCurrentProject: mocked.getCurrentProjectMock,
}));

vi.mock("../../../src/app/services/agent-selection-service.js", () => ({
  fetchCurrentAgent: mocked.fetchCurrentAgentMock,
}));

vi.mock("../../../src/app/services/model-selection-service.js", () => ({
  fetchCurrentModel: mocked.fetchCurrentModelMock,
}));

vi.mock("../../../src/app/services/worktree-service.js", () => ({
  getGitWorktreeContext: mocked.getGitWorktreeContextMock,
}));

vi.mock("../../../src/bot/keyboards/keyboard-manager.js", () => ({
  keyboardManager: {
    initialize: mocked.keyboardInitializeMock,
    updateContext: mocked.keyboardUpdateContextMock,
    getKeyboard: mocked.keyboardGetKeyboardMock,
  },
}));

vi.mock("../../../src/bot/pinned/pinned-message-manager.js", () => ({
  pinnedMessageManager: {
    isInitialized: mocked.pinnedIsInitializedMock,
    initialize: mocked.pinnedInitializeMock,
    getContextLimit: mocked.pinnedGetContextLimitMock,
    refreshContextLimit: mocked.pinnedRefreshContextLimitMock,
    getContextInfo: mocked.pinnedGetContextInfoMock,
  },
}));

vi.mock("../../../src/bot/messages/telegram-text.js", () => ({
  sendBotText: mocked.sendBotTextMock,
}));

describe("bot/commands/status-command", () => {
  beforeEach(() => {
    mocked.healthMock.mockReset();
    mocked.getCurrentSessionMock.mockReset();
    mocked.getCurrentProjectMock.mockReset();
    mocked.fetchCurrentAgentMock.mockReset();
    mocked.fetchCurrentModelMock.mockReset();
    mocked.getGitWorktreeContextMock.mockReset();
    mocked.keyboardInitializeMock.mockReset();
    mocked.keyboardUpdateContextMock.mockReset();
    mocked.keyboardGetKeyboardMock.mockReset();
    mocked.pinnedIsInitializedMock.mockReset();
    mocked.pinnedInitializeMock.mockReset();
    mocked.pinnedGetContextLimitMock.mockReset();
    mocked.pinnedRefreshContextLimitMock.mockReset();
    mocked.pinnedGetContextInfoMock.mockReset();
    mocked.sendBotTextMock.mockReset();
    mocked.loggerDebugMock.mockReset();
    mocked.loggerInfoMock.mockReset();
    mocked.loggerWarnMock.mockReset();
    mocked.loggerErrorMock.mockReset();

    mocked.healthMock.mockResolvedValue({ data: { healthy: true, version: "1.0.0" }, error: null });
    mocked.getCurrentSessionMock.mockReturnValue({ id: "s1", title: "S", directory: "/repo" });
    mocked.getCurrentProjectMock.mockReturnValue({ id: "p1", worktree: "/repo", name: "Repo" });
    mocked.fetchCurrentAgentMock.mockResolvedValue("build");
    mocked.fetchCurrentModelMock.mockReturnValue({ providerID: "openai", modelID: "gpt-5" });
    mocked.getGitWorktreeContextMock.mockResolvedValue(null);
    mocked.keyboardGetKeyboardMock.mockReturnValue({ inline_keyboard: [] });
    mocked.pinnedIsInitializedMock.mockReturnValue(false);
    mocked.pinnedGetContextLimitMock.mockReturnValue(200000);
    mocked.pinnedRefreshContextLimitMock.mockResolvedValue(undefined);
    mocked.pinnedGetContextInfoMock.mockReturnValue(null);
    mocked.sendBotTextMock.mockResolvedValue(undefined);
  });

  it("includes bot and OpenCode versions and omits health and audio replies", async () => {
    const ctx = {
      chat: { id: 42, type: "private" },
      message: { text: "/status" },
      api: {},
      reply: vi.fn(),
    } as unknown as Context;

    await statusCommand(ctx as never);

    const message = mocked.sendBotTextMock.mock.calls[0]?.[0]?.text as string;
    expect(message).toContain(`Bot version: ${botVersion}`);
    expect(message).toContain("OpenCode version: 1.0.0");
    expect(message).toContain("OpenCode version: 1.0.0\n\nAgent:");
    expect(message).not.toContain("Status: Healthy");
    expect(message).not.toContain("Audio replies");
    expect(message).not.toContain("Started by bot");
  });

  it("shows main project path and linked worktree when git metadata is available", async () => {
    mocked.getCurrentProjectMock.mockReturnValue({
      id: "p1",
      worktree: "/repo-feature",
      name: "Repo",
    });
    mocked.getGitWorktreeContextMock.mockResolvedValue({
      mainProjectPath: "/repo-main",
      activeWorktreePath: "/repo-feature",
      branch: "feature/mobile",
      isLinkedWorktree: true,
      worktrees: [],
    });

    const ctx = {
      chat: { id: 42, type: "private" },
      message: { text: "/status" },
      api: {},
      reply: vi.fn(),
    } as unknown as Context;

    await statusCommand(ctx as never);

    const message = mocked.sendBotTextMock.mock.calls[0]?.[0]?.text as string;
    expect(message).toContain("Project: /repo-main: feature/mobile");
    expect(message).toContain("Worktree: /repo-feature");
  });

  it("logs expected server unavailability as a warning", async () => {
    mocked.healthMock.mockResolvedValue({
      data: undefined,
      error: new TypeError("fetch failed"),
    });

    const reply = vi.fn();
    const ctx = {
      chat: { id: 42, type: "private" },
      message: { text: "/status" },
      api: {},
      reply,
    } as unknown as Context;

    await statusCommand(ctx as never);

    expect(mocked.loggerErrorMock).not.toHaveBeenCalled();
    expect(mocked.loggerWarnMock).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledTimes(1);
    const replyText = reply.mock.calls[0]?.[0] as string;
    expect(replyText).toContain("OpenCode Server is unavailable");
    expect(replyText).toContain(`Bot version: ${botVersion}`);
    expect(replyText).toContain("Use /opencode_start to start the server.");
    expect(replyText).not.toContain("OpenCode version:");
  });

  it("logs unexpected failures as errors", async () => {
    const unexpectedError = new Error("boom");
    mocked.healthMock.mockResolvedValue({ data: undefined, error: unexpectedError });

    const reply = vi.fn();
    const ctx = {
      chat: { id: 42, type: "private" },
      message: { text: "/status" },
      api: {},
      reply,
    } as unknown as Context;

    await statusCommand(ctx as never);

    expect(mocked.loggerWarnMock).not.toHaveBeenCalled();
    expect(mocked.loggerErrorMock).toHaveBeenCalledTimes(1);
    expect(mocked.loggerErrorMock).toHaveBeenCalledWith(
      "[Bot] Error checking server status:",
      unexpectedError,
    );
    expect(reply).toHaveBeenCalledTimes(1);
    const replyText = reply.mock.calls[0]?.[0] as string;
    expect(replyText).toContain("OpenCode Server is unavailable");
    expect(replyText).toContain(`Bot version: ${botVersion}`);
    expect(replyText).toContain("Use /opencode_start to start the server.");
    expect(replyText).not.toContain("OpenCode version:");
  });

  it("appends a named variant on the Model line", async () => {
    mocked.fetchCurrentModelMock.mockReturnValue({
      providerID: "openai",
      modelID: "gpt-5",
      variant: "low",
    });

    const ctx = {
      chat: { id: 42, type: "private" },
      message: { text: "/status" },
      api: {},
      reply: vi.fn(),
    } as unknown as Context;

    await statusCommand(ctx as never);

    const message = mocked.sendBotTextMock.mock.calls[0]?.[0]?.text as string;
    expect(message).toContain("Model: 🧠 openai/gpt-5 (low)");
  });

  it("shows (default) when the current variant is default", async () => {
    mocked.fetchCurrentModelMock.mockReturnValue({
      providerID: "openai",
      modelID: "gpt-5",
      variant: "default",
    });

    const ctx = {
      chat: { id: 42, type: "private" },
      message: { text: "/status" },
      api: {},
      reply: vi.fn(),
    } as unknown as Context;

    await statusCommand(ctx as never);

    const message = mocked.sendBotTextMock.mock.calls[0]?.[0]?.text as string;
    expect(message).toContain("Model: 🧠 openai/gpt-5 (default)");
  });

  it("omits parentheses when the model has no variant", async () => {
    mocked.fetchCurrentModelMock.mockReturnValue({
      providerID: "openai",
      modelID: "gpt-5",
    });

    const ctx = {
      chat: { id: 42, type: "private" },
      message: { text: "/status" },
      api: {},
      reply: vi.fn(),
    } as unknown as Context;

    await statusCommand(ctx as never);

    const message = mocked.sendBotTextMock.mock.calls[0]?.[0]?.text as string;
    expect(message).toContain("Model: 🧠 openai/gpt-5");
    expect(message).not.toContain("gpt-5 (");
  });
});
