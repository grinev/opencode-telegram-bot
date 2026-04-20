import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Context } from "grammy";
import { processUserPrompt, type ProcessPromptDeps } from "../../../src/bot/handlers/prompt.js";

const mocked = vi.hoisted(() => ({
  currentProject: { id: "project-1", worktree: "D:\\Projects\\Repo" },
  currentSession: {
    id: "session-1",
    title: "Session",
    directory: "D:\\Projects\\Repo",
  } as { id: string; title: string; directory: string } | null,
  sessionStatusMock: vi.fn(),
  sessionPromptMock: vi.fn(),
  sessionCreateMock: vi.fn(),
  suppressionRegisterMock: vi.fn(),
  safeBackgroundTaskMock: vi.fn(),
  setSessionSummaryMock: vi.fn(),
  setBotAndChatIdMock: vi.fn(),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      status: mocked.sessionStatusMock,
      prompt: mocked.sessionPromptMock,
      create: mocked.sessionCreateMock,
    },
  },
}));

vi.mock("../../../src/session/manager.js", () => ({
  getCurrentSession: vi.fn(() => mocked.currentSession),
  setCurrentSession: vi.fn(),
  clearSession: vi.fn(),
}));

vi.mock("../../../src/session/cache-manager.js", () => ({
  ingestSessionInfoForCache: vi.fn(),
  __resetSessionDirectoryCacheForTests: vi.fn(),
}));

vi.mock("../../../src/settings/manager.js", () => ({
  getCurrentProject: vi.fn(() => mocked.currentProject),
  isTtsEnabled: vi.fn(() => false),
}));

vi.mock("../../../src/agent/manager.js", () => ({
  getStoredAgent: vi.fn(() => "build"),
  resolveProjectAgent: vi.fn(async (agentName?: string) => agentName ?? "build"),
}));

vi.mock("../../../src/model/manager.js", () => ({
  getStoredModel: vi.fn(() => ({
    providerID: "openai",
    modelID: "gpt-5",
    variant: "default",
  })),
}));

vi.mock("../../../src/pinned/manager.js", () => ({
  pinnedMessageManager: {
    isInitialized: vi.fn(() => true),
    initialize: vi.fn(),
    getState: vi.fn(() => ({ messageId: 1 })),
    onSessionChange: vi.fn(),
    clear: vi.fn(),
    getContextInfo: vi.fn(() => null),
  },
}));

vi.mock("../../../src/keyboard/manager.js", () => ({
  keyboardManager: {
    initialize: vi.fn(),
    clearContext: vi.fn(),
    updateAgent: vi.fn(),
  },
}));

vi.mock("../../../src/summary/aggregator.js", () => ({
  summaryAggregator: {
    setSession: mocked.setSessionSummaryMock,
    setBotAndChatId: mocked.setBotAndChatIdMock,
    clear: vi.fn(),
  },
}));

vi.mock("../../../src/interaction/manager.js", () => ({
  interactionManager: {
    clear: vi.fn(),
    getSnapshot: vi.fn(() => null),
  },
}));

vi.mock("../../../src/interaction/cleanup.js", () => ({
  clearAllInteractionState: vi.fn(),
}));

vi.mock("../../../src/utils/safe-background-task.js", () => ({
  safeBackgroundTask: vi.fn((options) => {
    mocked.safeBackgroundTaskMock(options);
  }),
}));

vi.mock("../../../src/utils/error-format.js", () => ({
  formatErrorDetails: vi.fn(() => "formatted error"),
}));

vi.mock("../../../src/scheduled-task/foreground-state.js", () => ({
  foregroundSessionState: {
    markBusy: vi.fn(),
    markIdle: vi.fn(),
    clearAll: vi.fn(),
  },
}));

vi.mock("../../../src/bot/assistant-run-state.js", () => ({
  assistantRunState: {
    startRun: vi.fn(),
    clearRun: vi.fn(),
    clearAll: vi.fn(),
  },
}));

vi.mock("../../../src/attach/service.js", () => ({
  detachAttachedSession: vi.fn(),
  markAttachedSessionBusy: vi.fn().mockResolvedValue(undefined),
  markAttachedSessionIdle: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/external-input/suppression.js", () => ({
  externalUserInputSuppressionManager: {
    register: mocked.suppressionRegisterMock,
  },
}));

function createContext(): Context {
  return {
    chat: { id: 777 },
    reply: vi.fn().mockResolvedValue({ message_id: 100 }),
  } as unknown as Context;
}

function createDeps(): ProcessPromptDeps {
  return {
    bot: { api: { sendMessage: vi.fn() } } as unknown as Bot<Context>,
    ensureEventSubscription: vi.fn().mockResolvedValue(undefined),
  };
}

describe("bot/handlers/prompt", () => {
  beforeEach(() => {
    mocked.currentProject = { id: "project-1", worktree: "D:\\Projects\\Repo" };
    mocked.currentSession = {
      id: "session-1",
      title: "Session",
      directory: "D:\\Projects\\Repo",
    };
    mocked.sessionStatusMock.mockReset();
    mocked.sessionPromptMock.mockReset();
    mocked.sessionCreateMock.mockReset();
    mocked.suppressionRegisterMock.mockReset();
    mocked.safeBackgroundTaskMock.mockReset();
    mocked.setSessionSummaryMock.mockReset();
    mocked.setBotAndChatIdMock.mockReset();

    mocked.sessionStatusMock.mockResolvedValue({
      data: {
        "session-1": { type: "idle" },
      },
      error: null,
    });
    mocked.sessionPromptMock.mockResolvedValue({ data: {}, error: null });
  });

  it("registers suppression entry for text prompts", async () => {
    const handled = await processUserPrompt(createContext(), "Review README", createDeps());

    expect(handled).toBe(true);
    expect(mocked.suppressionRegisterMock).toHaveBeenCalledWith("session-1", "Review README");
  });

  it("does not register suppression entry for file-only prompts", async () => {
    const handled = await processUserPrompt(createContext(), "", createDeps(), [
      {
        type: "file",
        mime: "text/plain",
        url: "data:text/plain;base64,SGVsbG8=",
      } as never,
    ]);

    expect(handled).toBe(true);
    expect(mocked.suppressionRegisterMock).not.toHaveBeenCalled();
  });
});
