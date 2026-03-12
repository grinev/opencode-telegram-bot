import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { createNewCommand } from "../../../src/bot/commands/new.js";

const mocked = vi.hoisted(() => ({
  sessionCreateMock: vi.fn(),
  sessionPromptMock: vi.fn(),
  sessionGetMock: vi.fn(),
  setCurrentProjectMock: vi.fn(),
  setCurrentSessionMock: vi.fn(),
  setCurrentAgentMock: vi.fn(),
  setCurrentModelMock: vi.fn(),
  getCurrentProjectMock: vi.fn(),
  clearAllInteractionStateMock: vi.fn(),
  setSummarySessionMock: vi.fn(),
  ingestSessionInfoForCacheMock: vi.fn(),
  pinnedIsInitializedMock: vi.fn(() => false),
  pinnedInitializeMock: vi.fn(),
  pinnedOnSessionChangeMock: vi.fn(),
  pinnedGetContextLimitMock: vi.fn(() => 0),
  pinnedRefreshContextLimitMock: vi.fn(),
  pinnedGetContextInfoMock: vi.fn(() => null),
  keyboardInitializeMock: vi.fn(),
  keyboardGetContextInfoMock: vi.fn(() => null),
  getStoredAgentMock: vi.fn(() => "builder"),
  getStoredModelMock: vi.fn(() => ({ providerID: "openai", modelID: "gpt-5", variant: "fast" })),
  formatVariantForButtonMock: vi.fn(() => "Fast"),
  createMainKeyboardMock: vi.fn(() => ({ keyboard: [] })),
  tMock: vi.fn((key: string, params?: Record<string, string>) => {
    if (params?.url) {
      return `${key}:${params.url}`;
    }
    if (params?.title) {
      return `${key}:${params.title}`;
    }
    return key;
  }),
  safeBackgroundTaskMock: vi.fn(),
  getScopeFromContextMock: vi.fn(),
  isTopicScopeMock: vi.fn(() => false),
  createScopeKeyFromParamsMock: vi.fn(() => "chat:123:thread:777"),
  getThreadSendOptionsMock: vi.fn((threadId: number | null) =>
    threadId === null ? {} : { message_thread_id: threadId },
  ),
  registerTopicSessionBindingMock: vi.fn(),
  syncTopicTitleForSessionMock: vi.fn(),
  formatTopicTitleMock: vi.fn((_topicName: string, sessionTitle: string) => sessionTitle),
  buildTopicMessageLinkMock: vi.fn(() => "https://t.me/c/123/555"),
  loggerDebugMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      create: mocked.sessionCreateMock,
      prompt: mocked.sessionPromptMock,
      get: mocked.sessionGetMock,
    },
  },
}));

vi.mock("../../../src/session/manager.js", () => ({
  setCurrentSession: mocked.setCurrentSessionMock,
}));

vi.mock("../../../src/session/cache-manager.js", () => ({
  ingestSessionInfoForCache: mocked.ingestSessionInfoForCacheMock,
  __resetSessionDirectoryCacheForTests: vi.fn(),
}));

vi.mock("../../../src/settings/manager.js", () => ({
  TOPIC_SESSION_STATUS: {
    ACTIVE: "active",
  },
  getCurrentProject: mocked.getCurrentProjectMock,
  setCurrentProject: mocked.setCurrentProjectMock,
  setCurrentAgent: mocked.setCurrentAgentMock,
  setCurrentModel: mocked.setCurrentModelMock,
}));

vi.mock("../../../src/interaction/cleanup.js", () => ({
  clearAllInteractionState: mocked.clearAllInteractionStateMock,
}));

vi.mock("../../../src/summary/aggregator.js", () => ({
  summaryAggregator: {
    setSession: mocked.setSummarySessionMock,
    clear: vi.fn(),
  },
}));

vi.mock("../../../src/pinned/manager.js", () => ({
  pinnedMessageManager: {
    isInitialized: mocked.pinnedIsInitializedMock,
    initialize: mocked.pinnedInitializeMock,
    onSessionChange: mocked.pinnedOnSessionChangeMock,
    getContextLimit: mocked.pinnedGetContextLimitMock,
    refreshContextLimit: mocked.pinnedRefreshContextLimitMock,
    getContextInfo: mocked.pinnedGetContextInfoMock,
  },
}));

vi.mock("../../../src/keyboard/manager.js", () => ({
  keyboardManager: {
    initialize: mocked.keyboardInitializeMock,
    getContextInfo: mocked.keyboardGetContextInfoMock,
  },
}));

vi.mock("../../../src/agent/manager.js", () => ({
  getStoredAgent: mocked.getStoredAgentMock,
}));

vi.mock("../../../src/model/manager.js", () => ({
  getStoredModel: mocked.getStoredModelMock,
}));

vi.mock("../../../src/variant/manager.js", () => ({
  formatVariantForButton: mocked.formatVariantForButtonMock,
}));

vi.mock("../../../src/bot/utils/keyboard.js", () => ({
  createMainKeyboard: mocked.createMainKeyboardMock,
}));

vi.mock("../../../src/i18n/index.js", () => ({
  t: mocked.tMock,
}));

vi.mock("../../../src/utils/safe-background-task.js", () => ({
  safeBackgroundTask: mocked.safeBackgroundTaskMock,
}));

vi.mock("../../../src/bot/scope.js", () => ({
  GENERAL_TOPIC_THREAD_ID: 1,
  GLOBAL_SCOPE_KEY: "global",
  SCOPE_CONTEXT: {
    GROUP_GENERAL: "group-general",
    GROUP_TOPIC: "group-topic",
  },
  createScopeKeyFromParams: mocked.createScopeKeyFromParamsMock,
  getScopeFromContext: mocked.getScopeFromContextMock,
  getThreadSendOptions: mocked.getThreadSendOptionsMock,
  isTopicScope: mocked.isTopicScopeMock,
}));

vi.mock("../../../src/topic/colors.js", () => ({
  TOPIC_COLORS: {
    BLUE: 123,
  },
}));

vi.mock("../../../src/topic/manager.js", () => ({
  registerTopicSessionBinding: mocked.registerTopicSessionBindingMock,
}));

vi.mock("../../../src/topic/title-sync.js", () => ({
  syncTopicTitleForSession: mocked.syncTopicTitleForSessionMock,
}));

vi.mock("../../../src/topic/title-format.js", () => ({
  formatTopicTitle: mocked.formatTopicTitleMock,
}));

vi.mock("../../../src/bot/utils/topic-link.js", () => ({
  buildTopicMessageLink: mocked.buildTopicMessageLinkMock,
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    debug: mocked.loggerDebugMock,
    info: mocked.loggerInfoMock,
    warn: mocked.loggerWarnMock,
    error: mocked.loggerErrorMock,
  },
}));

function createContext(text = "/new Audit branches"): Context {
  return {
    chat: {
      id: -100123,
      type: "supergroup",
      is_forum: true,
    },
    message: {
      text,
    },
    reply: vi.fn().mockResolvedValue({ message_id: 321 }),
    api: {
      createForumTopic: vi.fn().mockResolvedValue({ message_thread_id: 777 }),
      sendMessage: vi.fn().mockResolvedValue({ message_id: 555 }),
    },
  } as unknown as Context;
}

describe("bot/commands/new", () => {
  beforeEach(() => {
    mocked.sessionCreateMock.mockReset();
    mocked.sessionPromptMock.mockReset();
    mocked.sessionGetMock.mockReset();
    mocked.setCurrentProjectMock.mockReset();
    mocked.setCurrentSessionMock.mockReset();
    mocked.setCurrentAgentMock.mockReset();
    mocked.setCurrentModelMock.mockReset();
    mocked.getCurrentProjectMock.mockReset();
    mocked.clearAllInteractionStateMock.mockReset();
    mocked.setSummarySessionMock.mockReset();
    mocked.ingestSessionInfoForCacheMock.mockReset();
    mocked.pinnedIsInitializedMock.mockReset();
    mocked.pinnedInitializeMock.mockReset();
    mocked.pinnedOnSessionChangeMock.mockReset();
    mocked.pinnedGetContextLimitMock.mockReset();
    mocked.pinnedRefreshContextLimitMock.mockReset();
    mocked.pinnedGetContextInfoMock.mockReset();
    mocked.keyboardInitializeMock.mockReset();
    mocked.keyboardGetContextInfoMock.mockReset();
    mocked.getStoredAgentMock.mockReset();
    mocked.getStoredModelMock.mockReset();
    mocked.formatVariantForButtonMock.mockReset();
    mocked.createMainKeyboardMock.mockReset();
    mocked.tMock.mockClear();
    mocked.safeBackgroundTaskMock.mockReset();
    mocked.getScopeFromContextMock.mockReset();
    mocked.isTopicScopeMock.mockReset();
    mocked.createScopeKeyFromParamsMock.mockReset();
    mocked.getThreadSendOptionsMock.mockClear();
    mocked.registerTopicSessionBindingMock.mockReset();
    mocked.syncTopicTitleForSessionMock.mockReset();
    mocked.formatTopicTitleMock.mockReset();
    mocked.buildTopicMessageLinkMock.mockReset();
    mocked.loggerDebugMock.mockReset();
    mocked.loggerInfoMock.mockReset();
    mocked.loggerWarnMock.mockReset();
    mocked.loggerErrorMock.mockReset();

    mocked.getCurrentProjectMock.mockReturnValue({
      id: "project-1",
      worktree: "/repo/culinary-commander",
    });
    mocked.pinnedIsInitializedMock.mockReturnValue(false);
    mocked.pinnedOnSessionChangeMock.mockResolvedValue(undefined);
    mocked.pinnedGetContextLimitMock.mockReturnValue(0);
    mocked.pinnedRefreshContextLimitMock.mockResolvedValue(undefined);
    mocked.pinnedGetContextInfoMock.mockReturnValue(null);
    mocked.keyboardGetContextInfoMock.mockReturnValue(null);
    mocked.getStoredAgentMock.mockReturnValue("builder");
    mocked.getStoredModelMock.mockReturnValue({
      providerID: "openai",
      modelID: "gpt-5",
      variant: "fast",
    });
    mocked.formatVariantForButtonMock.mockReturnValue("Fast");
    mocked.createMainKeyboardMock.mockReturnValue({ keyboard: [] });
    mocked.getScopeFromContextMock.mockReturnValue({
      key: "chat:-100123:general",
      context: "group-general",
      threadId: 1,
    });
    mocked.isTopicScopeMock.mockReturnValue(false);
    mocked.createScopeKeyFromParamsMock.mockReturnValue("chat:-100123:thread:777");
    mocked.formatTopicTitleMock.mockImplementation(
      (_topicName: string, sessionTitle: string) => sessionTitle,
    );
    mocked.buildTopicMessageLinkMock.mockReturnValue("https://t.me/c/123/555");
    mocked.sessionCreateMock.mockResolvedValue({
      data: {
        id: "session-123",
        title: "Open PRs and unpushed branch audit",
      },
      error: null,
    });
  });

  it("ensures event subscription before tracking and prompting a new session", async () => {
    const ensureEventSubscription = vi.fn().mockResolvedValue(undefined);
    const command = createNewCommand({ ensureEventSubscription });
    const ctx = createContext();

    await command(ctx as never);

    expect(ensureEventSubscription).toHaveBeenCalledWith("/repo/culinary-commander");
    expect(ensureEventSubscription.mock.invocationCallOrder[0]).toBeLessThan(
      mocked.setSummarySessionMock.mock.invocationCallOrder[0],
    );

    const promptTask = mocked.safeBackgroundTaskMock.mock.calls.find(
      ([options]) => options.taskName === "new.session.prompt",
    )?.[0];
    expect(promptTask).toBeDefined();
  });

  it("surfaces background prompt API errors in the created topic", async () => {
    const ensureEventSubscription = vi.fn().mockResolvedValue(undefined);
    const command = createNewCommand({ ensureEventSubscription });
    const ctx = createContext();

    await command(ctx as never);

    const promptTask = mocked.safeBackgroundTaskMock.mock.calls.find(
      ([options]) => options.taskName === "new.session.prompt",
    )?.[0] as { onSuccess?: (value: { error: unknown }) => Promise<void> };

    expect(promptTask.onSuccess).toBeTypeOf("function");
    await promptTask.onSuccess?.({ error: new Error("prompt failed") });

    expect((ctx.api.sendMessage as ReturnType<typeof vi.fn>).mock.calls).toContainEqual([
      -100123,
      "bot.prompt_send_error",
      { message_thread_id: 777 },
    ]);
  });
});
