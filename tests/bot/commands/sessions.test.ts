import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Context } from "grammy";
import {
  buildBackgroundSessionOpenKeyboard,
  handleBackgroundSessionOpen,
  handleRenameCancelCallback,
  handleRenameTextAnswer,
  handleSessionSelect,
  sessionsCommand,
} from "../../../src/bot/commands/sessions.js";
import { interactionManager } from "../../../src/interaction/manager.js";
import { foregroundSessionState } from "../../../src/scheduled-task/foreground-state.js";
import { t } from "../../../src/i18n/index.js";
import { safeBackgroundTask } from "../../../src/utils/safe-background-task.js";

const mocked = vi.hoisted(() => ({
  currentProject: {
    id: "project-1",
    worktree: "/repo",
  } as { id: string; worktree: string; name?: string } | null,
  sessionListMock: vi.fn(),
  sessionDeleteMock: vi.fn(),
  sessionGetMock: vi.fn(),
  sessionMessagesMock: vi.fn(),
  sessionUpdateMock: vi.fn(),
  setCurrentSessionMock: vi.fn(),
  detachAttachedSessionMock: vi.fn(),
  clearSessionMock: vi.fn(),
  getCurrentSessionMock: vi.fn(() => null),
  clearSummaryMock: vi.fn(),
  clearInteractionMock: vi.fn(),
  keyboardInitializeMock: vi.fn(),
  keyboardGetKeyboardMock: vi.fn(() => ({ inline_keyboard: [] })),
  keyboardUpdateAgentMock: vi.fn(),
  keyboardUpdateModelMock: vi.fn(),
  keyboardUpdateContextMock: vi.fn(),
  keyboardGetContextInfoMock: vi.fn(() => null),
  pinnedIsInitializedMock: vi.fn(() => false),
  pinnedInitializeMock: vi.fn(),
  pinnedClearMock: vi.fn(),
  pinnedOnSessionChangeMock: vi.fn(),
  pinnedLoadContextFromHistoryMock: vi.fn(),
  pinnedRefreshContextLimitMock: vi.fn(() => {}),
  pinnedGetContextLimitMock: vi.fn(() => 100000),
  pinnedGetContextInfoMock: vi.fn(() => null),
  fetchCurrentAgentMock: vi.fn(() => "build"),
  fetchCurrentModelFromSessionMock: vi.fn(),
  setCurrentAgentMock: vi.fn(),
  attachToSessionMock: vi.fn(),
  foregroundBusy: false,
  foregroundMarkIdleMock: vi.fn(),
  assistantClearRunMock: vi.fn(),
  clearPromptResponseModeMock: vi.fn(),
  ensureEventSubscriptionMock: vi.fn(),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      delete: mocked.sessionDeleteMock,
      list: mocked.sessionListMock,
      get: mocked.sessionGetMock,
      messages: mocked.sessionMessagesMock,
      update: mocked.sessionUpdateMock,
    },
  },
}));

vi.mock("../../../src/settings/manager.js", () => ({
  getCurrentProject: vi.fn(() => mocked.currentProject),
  setCurrentAgent: mocked.setCurrentAgentMock,
  clearCurrentAgent: mocked.setCurrentAgentMock,
}));

vi.mock("../../../src/session/manager.js", () => ({
  clearSession: mocked.clearSessionMock,
  getCurrentSession: mocked.getCurrentSessionMock,
  setCurrentSession: mocked.setCurrentSessionMock,
}));

vi.mock("../../../src/summary/aggregator.js", () => ({
  summaryAggregator: {
    clear: mocked.clearSummaryMock,
  },
}));

vi.mock("../../../src/interaction/cleanup.js", () => ({
  clearAllInteractionState: mocked.clearInteractionMock,
}));

vi.mock("../../../src/keyboard/manager.js", () => ({
  keyboardManager: {
    initialize: mocked.keyboardInitializeMock,
    getKeyboard: mocked.keyboardGetKeyboardMock,
    getContextInfo: mocked.keyboardGetContextInfoMock,
    updateAgent: mocked.keyboardUpdateAgentMock,
    updateModel: mocked.keyboardUpdateModelMock,
    updateContext: mocked.keyboardUpdateContextMock,
  },
}));

vi.mock("../../../src/agent/manager.js", () => ({
  fetchCurrentAgent: mocked.fetchCurrentAgentMock,
}));

vi.mock("../../../src/model/manager.js", () => ({
  fetchCurrentModelFromSession: mocked.fetchCurrentModelFromSessionMock,
}));

vi.mock("../../../src/pinned/manager.js", () => ({
  pinnedMessageManager: {
    isInitialized: mocked.pinnedIsInitializedMock,
    initialize: mocked.pinnedInitializeMock,
    clear: mocked.pinnedClearMock,
    onSessionChange: mocked.pinnedOnSessionChangeMock,
    loadContextFromHistory: mocked.pinnedLoadContextFromHistoryMock,
    refreshContextLimit: mocked.pinnedRefreshContextLimitMock,
    getContextLimit: mocked.pinnedGetContextLimitMock,
    getContextInfo: mocked.pinnedGetContextInfoMock,
  },
}));

vi.mock("../../../src/attach/service.js", () => ({
  attachToSession: mocked.attachToSessionMock,
  detachAttachedSession: mocked.detachAttachedSessionMock,
}));

vi.mock("../../../src/scheduled-task/foreground-state.js", () => ({
  foregroundSessionState: {
    __resetForTests: vi.fn(() => {
      mocked.foregroundBusy = false;
    }),
    isBusy: vi.fn(() => mocked.foregroundBusy),
    markBusy: vi.fn(() => {
      mocked.foregroundBusy = true;
    }),
    markIdle: mocked.foregroundMarkIdleMock,
  },
}));

vi.mock("../../../src/bot/assistant-run-state.js", () => ({
  assistantRunState: {
    clearRun: mocked.assistantClearRunMock,
  },
}));

vi.mock("../../../src/bot/handlers/prompt.js", () => ({
  clearPromptResponseMode: mocked.clearPromptResponseModeMock,
}));

vi.mock("../../../src/utils/safe-background-task.js", () => ({
  safeBackgroundTask: vi.fn(),
}));

const safeBackgroundTaskMock = vi.mocked(safeBackgroundTask);

type SessionStub = {
  id: string;
  title: string;
  directory: string;
  time: {
    created: number;
  };
};

type SessionMessageStub = {
  info: {
    role: "user" | "assistant";
    summary?: boolean;
    time: {
      created: number;
    };
  };
  parts: Array<{ type: string; text?: string }>;
};

function createSession(index: number): SessionStub {
  return {
    id: `session-${index + 1}`,
    title: `Session ${index + 1}`,
    directory: "/repo",
    time: {
      created: 1700000000000 + index * 1000,
    },
  };
}

function createSessionMessage(
  role: "user" | "assistant",
  text: string | null,
  created: number,
  summary = false,
): SessionMessageStub {
  return {
    info: {
      role,
      summary,
      time: {
        created,
      },
    },
    parts: text === null ? [] : [{ type: "text", text }],
  };
}

function createCommandContext(): Context {
  return {
    chat: { id: 111 },
    reply: vi.fn().mockResolvedValue({ message_id: 456 }),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    api: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 999 }),
      deleteMessage: vi.fn().mockResolvedValue(true),
      editMessageText: vi.fn().mockResolvedValue(true),
    },
  } as unknown as Context;
}

function createCallbackContext(data: string, messageId: number): Context {
  return {
    chat: { id: 111 },
    callbackQuery: {
      data,
      message: {
        message_id: messageId,
      },
    } as Context["callbackQuery"],
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    api: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 888 }),
      deleteMessage: vi.fn().mockResolvedValue(true),
      editMessageText: vi.fn().mockResolvedValue(true),
    },
  } as unknown as Context;
}

function createDeps() {
  return {
    bot: { api: {} } as Bot<Context>,
    ensureEventSubscription: mocked.ensureEventSubscriptionMock,
  };
}

function getKeyboardButtons(ctx: Context): Array<Array<{ text: string; callback_data?: string }>> {
  const calls = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls;
  const options = calls[0]?.[1] as {
    reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data?: string }>> };
  };
  return options.reply_markup.inline_keyboard;
}

describe("bot/commands/sessions", () => {
  beforeEach(() => {
    interactionManager.clear("test_setup");
    foregroundSessionState.__resetForTests();
    mocked.currentProject = {
      id: "project-1",
      worktree: "/repo",
    };

    mocked.sessionListMock.mockReset();
    mocked.sessionDeleteMock.mockReset();
    mocked.sessionDeleteMock.mockResolvedValue({ data: true, error: null });
    mocked.sessionGetMock.mockReset();
    mocked.sessionMessagesMock.mockReset();
    mocked.sessionMessagesMock.mockResolvedValue({ data: [], error: null });
    mocked.sessionUpdateMock.mockReset();
    mocked.setCurrentSessionMock.mockReset();
    mocked.detachAttachedSessionMock.mockReset();
    mocked.clearSessionMock.mockReset();
    mocked.getCurrentSessionMock.mockReset();
    mocked.getCurrentSessionMock.mockReturnValue(null);
    mocked.clearSummaryMock.mockReset();
    mocked.clearInteractionMock.mockReset();
    mocked.keyboardInitializeMock.mockReset();
    mocked.keyboardGetKeyboardMock.mockReset();
    mocked.keyboardGetKeyboardMock.mockReturnValue({ inline_keyboard: [] });
    mocked.keyboardGetContextInfoMock.mockReset();
    mocked.keyboardGetContextInfoMock.mockReturnValue(null);
    mocked.keyboardUpdateAgentMock.mockReset();
    mocked.keyboardUpdateModelMock.mockReset();
    mocked.keyboardUpdateContextMock.mockReset();
    mocked.pinnedIsInitializedMock.mockReset();
    mocked.pinnedIsInitializedMock.mockReturnValue(false);
    mocked.pinnedInitializeMock.mockReset();
    mocked.pinnedClearMock.mockReset();
    mocked.pinnedClearMock.mockResolvedValue(undefined);
    mocked.pinnedOnSessionChangeMock.mockReset();
    mocked.pinnedOnSessionChangeMock.mockResolvedValue(undefined);
    mocked.pinnedLoadContextFromHistoryMock.mockReset();
    mocked.pinnedLoadContextFromHistoryMock.mockResolvedValue(undefined);
    mocked.pinnedRefreshContextLimitMock.mockReset();
    mocked.pinnedRefreshContextLimitMock.mockResolvedValue(undefined);
    mocked.pinnedGetContextLimitMock.mockReset();
    mocked.pinnedGetContextLimitMock.mockReturnValue(100000);
    mocked.pinnedGetContextInfoMock.mockReset();
    mocked.pinnedGetContextInfoMock.mockReturnValue(null);
    mocked.fetchCurrentAgentMock.mockReset();
    mocked.fetchCurrentAgentMock.mockReturnValue("code");
    mocked.fetchCurrentModelFromSessionMock.mockReset();
    mocked.fetchCurrentModelFromSessionMock.mockResolvedValue({
      providerID: "anthropic",
      modelID: "claude-3.5-sonnet",
      variant: "default",
    });
    mocked.attachToSessionMock.mockReset();
    mocked.attachToSessionMock.mockResolvedValue({
      busy: false,
      alreadyAttached: false,
      restoredQuestion: false,
      restoredPermissions: 0,
    });
    mocked.foregroundMarkIdleMock.mockReset();
    mocked.assistantClearRunMock.mockReset();
    mocked.clearPromptResponseModeMock.mockReset();
    mocked.ensureEventSubscriptionMock.mockReset();
    safeBackgroundTaskMock.mockReset();
  });

  it("shows next-page button when sessions exceed page size", async () => {
    const sessions = Array.from({ length: 11 }, (_, index) => createSession(index));
    mocked.sessionListMock.mockResolvedValueOnce({ data: sessions, error: null });

    const ctx = createCommandContext();
    await sessionsCommand(ctx as never);

    expect(mocked.sessionListMock).toHaveBeenCalledWith({
      directory: "/repo",
      limit: 11,
      roots: true,
    });

    const keyboardRows = getKeyboardButtons(ctx);
    expect(keyboardRows[0]?.[0]?.callback_data).toBe("session:preview:session-1");
    expect(keyboardRows[9]?.[0]?.callback_data).toBe("session:preview:session-10");
    expect(keyboardRows[10]?.[0]?.callback_data).toBe("session:page:1");
    expect(keyboardRows[11]?.[0]?.callback_data).toBe("inline:cancel:session");
  });

  it("blocks sessions command while foreground session is busy", async () => {
    foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");

    const ctx = createCommandContext();
    await sessionsCommand(ctx as never);

    expect(mocked.sessionListMock).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(t("bot.session_busy"));
  });

  it("handles next-page callback and renders second page with prev button", async () => {
    const pageTwoData = Array.from({ length: 12 }, (_, index) => createSession(index));
    mocked.sessionListMock.mockResolvedValueOnce({ data: pageTwoData, error: null });

    interactionManager.start({
      kind: "inline",
      expectedInput: "callback",
      metadata: {
        menuKind: "session",
        messageId: 456,
      },
    });

    const ctx = createCallbackContext("session:page:1", 456);
    const handled = await handleSessionSelect(ctx, createDeps());

    expect(handled).toBe(true);
    expect(mocked.sessionListMock).toHaveBeenCalledWith({
      directory: "/repo",
      limit: 21,
      roots: true,
    });
    expect(ctx.editMessageText).toHaveBeenCalledTimes(1);

    const [text, options] = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { reply_markup: { inline_keyboard: Array<Array<{ callback_data?: string }>> } },
    ];

    expect(text).toBe(t("sessions.select_page", { page: 2 }));
    const inlineRows = options.reply_markup.inline_keyboard;
    expect(inlineRows[0]?.[0]?.callback_data).toBe("session:preview:session-11");
    expect(inlineRows[1]?.[0]?.callback_data).toBe("session:preview:session-12");
    expect(inlineRows[2]?.[0]?.callback_data).toBe("session:page:0");
    expect(inlineRows[3]?.[0]?.callback_data).toBe("inline:cancel:session");
  });

  it("returns page-empty callback message when requested page has no sessions", async () => {
    mocked.sessionListMock.mockResolvedValueOnce({ data: [], error: null });

    interactionManager.start({
      kind: "inline",
      expectedInput: "callback",
      metadata: {
        menuKind: "session",
        messageId: 456,
      },
    });

    const ctx = createCallbackContext("session:page:2", 456);
    const handled = await handleSessionSelect(ctx, createDeps());

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("sessions.page_empty_callback"),
    });
    expect(ctx.editMessageText).not.toHaveBeenCalled();
  });

  it("keeps active menu and interaction state when page load fails", async () => {
    mocked.sessionListMock.mockResolvedValueOnce({
      data: null,
      error: new Error("session list failed"),
    });

    interactionManager.start({
      kind: "inline",
      expectedInput: "callback",
      metadata: {
        menuKind: "session",
        messageId: 456,
      },
    });

    const ctx = createCallbackContext("session:page:1", 456);
    const handled = await handleSessionSelect(ctx, createDeps());

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("sessions.page_load_error_callback"),
    });
    expect((ctx.api.deleteMessage as ReturnType<typeof vi.fn>).mock.calls).toEqual([]);
    expect(ctx.deleteMessage).not.toHaveBeenCalled();
    expect(mocked.clearInteractionMock).not.toHaveBeenCalled();
  });

  it("keeps generic selection error flow when session details fetch fails", async () => {
    mocked.sessionGetMock.mockResolvedValueOnce({
      data: null,
      error: new Error("session get failed"),
    });

    interactionManager.start({
      kind: "inline",
      expectedInput: "callback",
      metadata: {
        menuKind: "session",
        messageId: 456,
      },
    });

    const ctx = createCallbackContext("session:preview:session-1", 456);
    const handled = await handleSessionSelect(ctx, createDeps());

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("sessions.select_error"),
      show_alert: true,
    });
  });

  it("syncs context, agent, and model before sending the keyboard for an existing session", async () => {
    mocked.sessionGetMock.mockResolvedValueOnce({
      data: createSession(0),
      error: null,
    });
    mocked.fetchCurrentAgentMock.mockReturnValueOnce("plan");

    interactionManager.start({
      kind: "inline",
      expectedInput: "callback",
      metadata: {
        menuKind: "session",
        messageId: 456,
      },
    });

    const ctx = createCallbackContext("session:select:session-1", 456);
    const handled = await handleSessionSelect(ctx, createDeps());

    expect(handled).toBe(true);
    expect(mocked.pinnedRefreshContextLimitMock).toHaveBeenCalled();
    expect(mocked.fetchCurrentAgentMock).toHaveBeenCalled();
    expect(mocked.fetchCurrentModelFromSessionMock).toHaveBeenCalled();
    expect(mocked.keyboardUpdateAgentMock).toHaveBeenCalledWith("plan");
    expect(mocked.keyboardUpdateModelMock).toHaveBeenCalledWith(
      expect.objectContaining({ providerID: "anthropic", modelID: "claude-3.5-sonnet" }),
    );
    expect(mocked.attachToSessionMock).toHaveBeenCalledWith({
      bot: expect.any(Object),
      chatId: 111,
      session: {
        id: "session-1",
        title: "Session 1",
        directory: "/repo",
      },
      ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    });
    const sendMessageCalls = (ctx.api.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
    const selectedCall = sendMessageCalls.find(
      (call: unknown[]) => typeof call[1] === "string" && (call[1] as string).includes("Session 1"),
    );
    expect(selectedCall).toEqual([
      111,
      t("sessions.selected", { title: "Session 1" }),
      expect.objectContaining({
        reply_markup: { inline_keyboard: [] },
      }),
    ]);
  });

  it("blocks session selection callback while foreground session is busy", async () => {
    foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");

    interactionManager.start({
      kind: "inline",
      expectedInput: "callback",
      metadata: {
        menuKind: "session",
        messageId: 456,
      },
    });

    const ctx = createCallbackContext("session:preview:session-1", 456);
    const handled = await handleSessionSelect(ctx, createDeps());

    expect(handled).toBe(true);
    expect(mocked.sessionGetMock).not.toHaveBeenCalled();
    expect(mocked.setCurrentSessionMock).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("bot.session_busy"),
    });
  });

  it("builds a persistent background session open button", () => {
    const keyboard = buildBackgroundSessionOpenKeyboard("session-1", "assistant_response");

    expect(keyboard.inline_keyboard[0]?.[0]).toEqual({
      text: t("background.open_session_button"),
      callback_data: "background-session:a:session-1",
    });
  });

  it("selects a background session without an active sessions menu", async () => {
    mocked.sessionGetMock.mockResolvedValueOnce({
      data: createSession(0),
      error: null,
    });

    const ctx = createCallbackContext("background-session:session-1", 456);
    const handled = await handleBackgroundSessionOpen(ctx, createDeps());

    expect(handled).toBe(true);
    expect(mocked.sessionGetMock).toHaveBeenCalledWith({
      sessionID: "session-1",
      directory: "/repo",
    });
    expect(mocked.setCurrentSessionMock).toHaveBeenCalledWith({
      id: "session-1",
      title: "Session 1",
      directory: "/repo",
    });
    expect(mocked.attachToSessionMock).toHaveBeenCalledWith({
      bot: expect.any(Object),
      chatId: 111,
      session: {
        id: "session-1",
        title: "Session 1",
        directory: "/repo",
      },
      ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    });
    expect(ctx.editMessageReplyMarkup).toHaveBeenCalledOnce();
    expect(ctx.deleteMessage).not.toHaveBeenCalled();
    expect((ctx.api.sendMessage as ReturnType<typeof vi.fn>).mock.calls[1]).toEqual([
      111,
      t("sessions.selected", { title: "Session 1" }),
      expect.objectContaining({
        reply_markup: { inline_keyboard: [] },
      }),
    ]);
    expect(safeBackgroundTaskMock).not.toHaveBeenCalled();
  });

  it("sends the full latest assistant response after opening an assistant background notification", async () => {
    mocked.sessionGetMock.mockResolvedValueOnce({
      data: createSession(0),
      error: null,
    });
    const latestResponse = `Final assistant response. ${"More details. ".repeat(380)}`.trimEnd();
    mocked.sessionMessagesMock.mockResolvedValueOnce({
      data: [
        createSessionMessage("assistant", "Old assistant response", 100),
        createSessionMessage("user", "User prompt should not be forwarded", 200),
        createSessionMessage("assistant", "Summary should be ignored", 300, true),
        createSessionMessage("assistant", latestResponse, 400),
      ],
      error: null,
    });

    const ctx = createCallbackContext("background-session:a:session-1", 456);
    const handled = await handleBackgroundSessionOpen(ctx, createDeps());

    expect(handled).toBe(true);
    expect(safeBackgroundTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskName: "sessions.sendLatestAssistantResponse",
      }),
    );

    const taskOptions = safeBackgroundTaskMock.mock.calls[0]?.[0];
    if (!taskOptions) {
      throw new Error("Expected latest assistant response background task");
    }

    const sendMessageMock = ctx.api.sendMessage as ReturnType<typeof vi.fn>;
    const previousSendCount = sendMessageMock.mock.calls.length;
    await taskOptions.task();

    expect(mocked.sessionMessagesMock).toHaveBeenCalledWith({
      sessionID: "session-1",
      directory: "/repo",
      limit: 20,
    });

    const assistantResponseCalls = sendMessageMock.mock.calls.slice(previousSendCount);
    expect(assistantResponseCalls.length).toBeGreaterThan(1);
    expect(assistantResponseCalls.map((call) => call[1]).join("")).toBe(latestResponse);
    expect(assistantResponseCalls.map((call) => call[1]).join("")).not.toContain(
      "User prompt should not be forwarded",
    );
  });

  it("does not send preview or latest assistant response for background question notifications", async () => {
    mocked.sessionGetMock.mockResolvedValueOnce({
      data: createSession(0),
      error: null,
    });

    const ctx = createCallbackContext("background-session:q:session-1", 456);
    const handled = await handleBackgroundSessionOpen(ctx, createDeps());

    expect(handled).toBe(true);
    expect(mocked.sessionMessagesMock).not.toHaveBeenCalled();
    expect(safeBackgroundTaskMock).not.toHaveBeenCalled();
  });

  it("keeps background session button usable when another inline menu is active", async () => {
    mocked.sessionGetMock.mockResolvedValueOnce({
      data: createSession(0),
      error: null,
    });
    interactionManager.start({
      kind: "inline",
      expectedInput: "callback",
      metadata: {
        menuKind: "model",
        messageId: 999,
      },
    });

    const ctx = createCallbackContext("background-session:session-1", 456);
    const handled = await handleBackgroundSessionOpen(ctx, createDeps());

    expect(handled).toBe(true);
    expect(mocked.sessionGetMock).toHaveBeenCalledWith({
      sessionID: "session-1",
      directory: "/repo",
    });
    expect(mocked.setCurrentSessionMock).toHaveBeenCalledWith({
      id: "session-1",
      title: "Session 1",
      directory: "/repo",
    });
    expect(ctx.editMessageReplyMarkup).toHaveBeenCalledOnce();
  });

  it("keeps successful background selection when removing the button fails", async () => {
    mocked.sessionGetMock.mockResolvedValueOnce({
      data: createSession(0),
      error: null,
    });

    const ctx = createCallbackContext("background-session:session-1", 456);
    (ctx.editMessageReplyMarkup as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("edit failed"),
    );
    const handled = await handleBackgroundSessionOpen(ctx, createDeps());

    expect(handled).toBe(true);
    expect(mocked.setCurrentSessionMock).toHaveBeenCalledWith({
      id: "session-1",
      title: "Session 1",
      directory: "/repo",
    });
    expect(mocked.attachToSessionMock).toHaveBeenCalledOnce();
    expect(ctx.editMessageReplyMarkup).toHaveBeenCalledOnce();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith();
  });

  it("blocks background session open while foreground session is busy", async () => {
    foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");

    const ctx = createCallbackContext("background-session:session-2", 456);
    const handled = await handleBackgroundSessionOpen(ctx, createDeps());

    expect(handled).toBe(true);
    expect(mocked.sessionGetMock).not.toHaveBeenCalled();
    expect(mocked.setCurrentSessionMock).not.toHaveBeenCalled();
    expect(ctx.editMessageReplyMarkup).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("bot.session_busy"),
    });
  });

  it("blocks background session open during non-inline interactions", async () => {
    interactionManager.start({
      kind: "question",
      expectedInput: "callback",
    });

    const ctx = createCallbackContext("background-session:session-1", 456);
    const handled = await handleBackgroundSessionOpen(ctx, createDeps());

    expect(handled).toBe(true);
    expect(mocked.sessionGetMock).not.toHaveBeenCalled();
    expect(mocked.setCurrentSessionMock).not.toHaveBeenCalled();
    expect(ctx.editMessageReplyMarkup).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("interaction.blocked.finish_current"),
    });
  });

  it("ignores unrelated callbacks in background session handler", async () => {
    const ctx = createCallbackContext("model:openai/gpt", 456);
    const handled = await handleBackgroundSessionOpen(ctx, createDeps());

    expect(handled).toBe(false);
    expect(mocked.sessionGetMock).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).not.toHaveBeenCalled();
  });

  describe("session preview panel", () => {
    it("shows preview with action buttons when session:preview:{id} is clicked", async () => {
      mocked.sessionGetMock.mockResolvedValueOnce({ data: createSession(0), error: null });
      mocked.sessionMessagesMock.mockResolvedValueOnce({
        data: [
          createSessionMessage("user", "Please inspect the bug", 100),
          createSessionMessage("assistant", "The issue is fixed", 200),
        ],
        error: null,
      });
      interactionManager.start({
        kind: "inline",
        expectedInput: "callback",
        metadata: {
          menuKind: "session",
          messageId: 456,
        },
      });

      const ctx = createCallbackContext("session:preview:session-1", 456);
      const handled = await handleSessionSelect(ctx, createDeps());

      expect(handled).toBe(true);
      expect(mocked.sessionGetMock).toHaveBeenCalledWith({
        sessionID: "session-1",
        directory: "/repo",
      });
      expect(mocked.sessionMessagesMock).toHaveBeenCalledWith({
        sessionID: "session-1",
        directory: "/repo",
        limit: 6,
      });
      expect(ctx.editMessageText).toHaveBeenCalledTimes(1);

      const [text, options] = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        { reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data?: string }>> } },
      ];

      expect(text).toContain(t("sessions.preview.title"));
      expect(text).toContain(`${t("sessions.preview.you")} Please inspect the bug`);
      expect(text).toContain(`${t("sessions.preview.agent")} The issue is fixed`);
      expect(options.reply_markup.inline_keyboard).toEqual([
        [
          { text: t("sessions.button.select"), callback_data: "session:select:session-1" },
          { text: t("sessions.button.rename"), callback_data: "session:rename:session-1" },
        ],
        [
          { text: t("sessions.button.delete"), callback_data: "session:delete:session-1" },
          { text: t("sessions.button.close"), callback_data: "inline:cancel:session" },
        ],
      ]);
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith();
    });

    it("answers callback with error when preview fetch fails", async () => {
      mocked.sessionGetMock.mockResolvedValueOnce({
        data: null,
        error: new Error("session get failed"),
      });
      interactionManager.start({
        kind: "inline",
        expectedInput: "callback",
        metadata: {
          menuKind: "session",
          messageId: 456,
        },
      });

      const ctx = createCallbackContext("session:preview:session-1", 456);
      const handled = await handleSessionSelect(ctx, createDeps());

      expect(handled).toBe(true);
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
        text: t("sessions.select_error"),
        show_alert: true,
      });
      expect(ctx.editMessageText).not.toHaveBeenCalled();
    });
  });

  describe("session select from preview panel", () => {
    it("selects session when session:select:{id} is clicked", async () => {
      mocked.sessionGetMock.mockResolvedValueOnce({ data: createSession(0), error: null });
      mocked.fetchCurrentAgentMock.mockReturnValueOnce("plan");
      interactionManager.start({
        kind: "inline",
        expectedInput: "callback",
        metadata: {
          menuKind: "session",
          messageId: 456,
        },
      });

      const ctx = createCallbackContext("session:select:session-1", 456);
      const handled = await handleSessionSelect(ctx, createDeps());

      expect(handled).toBe(true);
      expect(mocked.setCurrentSessionMock).toHaveBeenCalledWith({
        id: "session-1",
        title: "Session 1",
        directory: "/repo",
      });
      expect(mocked.attachToSessionMock).toHaveBeenCalledWith({
        bot: expect.any(Object),
        chatId: 111,
        session: {
          id: "session-1",
          title: "Session 1",
          directory: "/repo",
        },
        ensureEventSubscription: mocked.ensureEventSubscriptionMock,
      });
      expect(mocked.pinnedRefreshContextLimitMock).toHaveBeenCalled();
      expect(mocked.fetchCurrentAgentMock).toHaveBeenCalled();
      expect(mocked.fetchCurrentModelFromSessionMock).toHaveBeenCalled();
      expect(mocked.keyboardUpdateAgentMock).toHaveBeenCalledWith("plan");
      expect(mocked.keyboardUpdateModelMock).toHaveBeenCalledWith(
        expect.objectContaining({ providerID: "anthropic", modelID: "claude-3.5-sonnet" }),
      );
      expect(ctx.editMessageReplyMarkup).toHaveBeenCalledOnce();
    });
  });

  describe("session rename flow", () => {
    it("enters rename mode when session:rename:{id} is clicked", async () => {
      mocked.sessionGetMock.mockResolvedValueOnce({ data: createSession(0), error: null });
      interactionManager.start({
        kind: "inline",
        expectedInput: "callback",
        metadata: {
          menuKind: "session",
          messageId: 456,
        },
      });

      const ctx = createCallbackContext("session:rename:session-1", 456);
      const handled = await handleSessionSelect(ctx, createDeps());

      expect(handled).toBe(true);
      expect(ctx.editMessageText).toHaveBeenCalledWith(t("sessions.rename.prompt", { title: "Session 1" }), {
        reply_markup: expect.objectContaining({
          inline_keyboard: [[{ text: t("sessions.rename.cancel"), callback_data: "rename:cancel" }]],
        }),
      });

      const snapshot = interactionManager.getSnapshot();
      expect(snapshot?.kind).toBe("custom");
      expect(snapshot?.metadata).toEqual({
        action: "session_rename",
        sessionId: "session-1",
        directory: "/repo",
        currentTitle: "Session 1",
      });
    });

    it("processes rename text input successfully", async () => {
      interactionManager.start({
        kind: "custom",
        expectedInput: "text",
        metadata: {
          action: "session_rename",
          sessionId: "session-1",
          directory: "/repo",
          currentTitle: "Session 1",
        },
      });
      mocked.sessionUpdateMock.mockResolvedValueOnce({
        data: { ...createSession(0), title: "New Title" },
        error: null,
      });

      const ctx = {
        ...createCommandContext(),
        message: { text: "New Title" },
      } as unknown as Context;
      const handled = await handleRenameTextAnswer(ctx);

      expect(handled).toBe(true);
      expect(mocked.sessionUpdateMock).toHaveBeenCalledWith({
        sessionID: "session-1",
        directory: "/repo",
        title: "New Title",
      });
      expect(ctx.reply).toHaveBeenCalledWith(t("sessions.rename.success", { title: "New Title" }));
      expect(interactionManager.getSnapshot()).toBeNull();
    });

    it("rejects empty title during rename", async () => {
      interactionManager.start({
        kind: "custom",
        expectedInput: "text",
        metadata: {
          action: "session_rename",
          sessionId: "session-1",
          directory: "/repo",
          currentTitle: "Session 1",
        },
      });

      const ctx = {
        ...createCommandContext(),
        message: { text: "   " },
      } as unknown as Context;
      const handled = await handleRenameTextAnswer(ctx);

      expect(handled).toBe(true);
      expect(ctx.reply).toHaveBeenCalledWith(t("sessions.rename.empty"));
      expect(mocked.sessionUpdateMock).not.toHaveBeenCalled();
      expect(interactionManager.getSnapshot()).toEqual(
        expect.objectContaining({
          kind: "custom",
          metadata: expect.objectContaining({ action: "session_rename" }),
        }),
      );
    });

    it("cancels rename when cancel button is clicked", async () => {
      interactionManager.start({
        kind: "custom",
        expectedInput: "text",
        metadata: {
          action: "session_rename",
          sessionId: "session-1",
          directory: "/repo",
          currentTitle: "Session 1",
        },
      });
      mocked.sessionGetMock.mockResolvedValueOnce({ data: createSession(0), error: null });
      mocked.sessionMessagesMock.mockResolvedValueOnce({ data: [], error: null });

      const ctx = createCallbackContext("rename:cancel", 456);
      const handled = await handleRenameCancelCallback(ctx);

      expect(handled).toBe(true);
      expect(interactionManager.getSnapshot()).toBeNull();
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith();
      expect(ctx.editMessageText).toHaveBeenCalledWith(t("sessions.preview.empty"), {
        reply_markup: expect.objectContaining({
          inline_keyboard: expect.any(Array),
        }),
      });
    });

    it("ignores text input when not in rename interaction", async () => {
      const ctx = {
        ...createCommandContext(),
        message: { text: "New Title" },
      } as unknown as Context;
      const handled = await handleRenameTextAnswer(ctx);

      expect(handled).toBe(false);
      expect(mocked.sessionUpdateMock).not.toHaveBeenCalled();
    });
  });

  describe("session delete flow", () => {
    it("shows delete confirmation when session:delete:{id} is clicked", async () => {
      mocked.sessionGetMock.mockResolvedValueOnce({ data: createSession(0), error: null });
      interactionManager.start({
        kind: "inline",
        expectedInput: "callback",
        metadata: {
          menuKind: "session",
          messageId: 456,
        },
      });

      const ctx = createCallbackContext("session:delete:session-1", 456);
      const handled = await handleSessionSelect(ctx, createDeps());

      expect(handled).toBe(true);
      expect(ctx.editMessageText).toHaveBeenCalledWith(t("sessions.delete.confirm", { title: "Session 1" }), {
        reply_markup: expect.objectContaining({
          inline_keyboard: [
            [
              { text: t("sessions.delete.yes"), callback_data: "session:delete:confirm:session-1" },
              { text: t("sessions.delete.no"), callback_data: "session:delete:cancel:session-1" },
            ],
          ],
        }),
      });
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith();
    });

    it("deletes session when session:delete:confirm:{id} is clicked", async () => {
      mocked.sessionGetMock.mockResolvedValueOnce({ data: createSession(0), error: null });
      mocked.sessionDeleteMock.mockResolvedValueOnce({ data: true, error: null });
      interactionManager.start({
        kind: "inline",
        expectedInput: "callback",
        metadata: {
          menuKind: "session",
          messageId: 456,
        },
      });

      const ctx = createCallbackContext("session:delete:confirm:session-1", 456);
      const handled = await handleSessionSelect(ctx, createDeps());

      expect(handled).toBe(true);
      expect(mocked.sessionDeleteMock).toHaveBeenCalledWith({
        sessionID: "session-1",
        directory: "/repo",
      });
      expect(mocked.clearInteractionMock).toHaveBeenCalledWith("session_deleted_other");
      expect(ctx.editMessageText).toHaveBeenCalledWith(
        t("sessions.delete.success", { title: "Session 1" }),
      );
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith();
    });

    it("cleans up local state when deleting current active session", async () => {
      mocked.sessionGetMock.mockResolvedValueOnce({ data: createSession(0), error: null });
      mocked.sessionDeleteMock.mockResolvedValueOnce({ data: true, error: null });
      mocked.getCurrentSessionMock.mockReturnValueOnce({
        id: "session-1",
        title: "Session 1",
        directory: "/repo",
      });
      interactionManager.start({
        kind: "inline",
        expectedInput: "callback",
        metadata: {
          menuKind: "session",
          messageId: 456,
        },
      });

      const ctx = createCallbackContext("session:delete:confirm:session-1", 456);
      const handled = await handleSessionSelect(ctx, createDeps());

      expect(handled).toBe(true);
      expect(mocked.detachAttachedSessionMock).toHaveBeenCalledWith("session_deleted");
      expect(mocked.clearPromptResponseModeMock).toHaveBeenCalledWith("session-1");
      expect(mocked.foregroundMarkIdleMock).toHaveBeenCalledWith("session-1");
      expect(mocked.assistantClearRunMock).toHaveBeenCalledWith("session-1", "session_deleted");
      expect(mocked.clearInteractionMock).toHaveBeenCalledWith("session_deleted");
      expect(mocked.clearSessionMock).toHaveBeenCalledOnce();
      expect(mocked.keyboardInitializeMock).toHaveBeenCalledWith(ctx.api, 111);
      expect(mocked.pinnedRefreshContextLimitMock).toHaveBeenCalledOnce();
      expect(mocked.keyboardUpdateContextMock).toHaveBeenCalledWith(0, 100000);
    });

    it("cancels delete when no button is clicked", async () => {
      mocked.sessionGetMock.mockResolvedValueOnce({ data: createSession(0), error: null });
      mocked.sessionMessagesMock.mockResolvedValueOnce({ data: [], error: null });
      interactionManager.start({
        kind: "inline",
        expectedInput: "callback",
        metadata: {
          menuKind: "session",
          messageId: 456,
        },
      });

      const ctx = createCallbackContext("session:delete:cancel:session-1", 456);
      const handled = await handleSessionSelect(ctx, createDeps());

      expect(handled).toBe(true);
      expect(mocked.sessionDeleteMock).not.toHaveBeenCalled();
      expect(ctx.editMessageText).toHaveBeenCalledWith(t("sessions.preview.empty"), {
        reply_markup: expect.objectContaining({
          inline_keyboard: expect.any(Array),
        }),
      });
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith();
    });

    it("handles delete failure gracefully", async () => {
      mocked.sessionGetMock.mockResolvedValueOnce({ data: createSession(0), error: null });
      mocked.sessionDeleteMock.mockResolvedValueOnce({
        data: null,
        error: new Error("delete failed"),
      });
      interactionManager.start({
        kind: "inline",
        expectedInput: "callback",
        metadata: {
          menuKind: "session",
          messageId: 456,
        },
      });

      const ctx = createCallbackContext("session:delete:confirm:session-1", 456);
      const handled = await handleSessionSelect(ctx, createDeps());

      expect(handled).toBe(true);
      expect(ctx.editMessageText).toHaveBeenCalledWith(t("sessions.delete.error"));
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
        text: t("sessions.delete.error"),
        show_alert: true,
      });
    });
  });
});
