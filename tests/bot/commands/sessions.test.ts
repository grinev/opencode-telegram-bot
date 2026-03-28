import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { sessionsCommand, handleSessionSelect } from "../../../src/bot/commands/sessions.js";
import { interactionManager } from "../../../src/interaction/manager.js";
import { foregroundSessionState } from "../../../src/scheduled-task/foreground-state.js";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  currentProject: {
    id: "project-1",
    worktree: "/repo",
  } as { id: string; worktree: string; name?: string } | null,
  sessionListMock: vi.fn(),
  sessionGetMock: vi.fn(),
  setCurrentSessionMock: vi.fn(),
  clearSummaryMock: vi.fn(),
  clearInteractionMock: vi.fn(),
  keyboardInitializeMock: vi.fn(),
  keyboardGetKeyboardMock: vi.fn(() => ({ inline_keyboard: [] })),
  keyboardUpdateContextMock: vi.fn(),
  pinnedIsInitializedMock: vi.fn(() => false),
  pinnedInitializeMock: vi.fn(),
  pinnedOnSessionChangeMock: vi.fn(),
  pinnedLoadContextFromHistoryMock: vi.fn(),
  pinnedGetContextInfoMock: vi.fn(() => null),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      list: mocked.sessionListMock,
      get: mocked.sessionGetMock,
    },
  },
}));

vi.mock("../../../src/settings/manager.js", () => ({
  getCurrentProject: vi.fn(() => mocked.currentProject),
}));

vi.mock("../../../src/session/manager.js", () => ({
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
    updateContext: mocked.keyboardUpdateContextMock,
  },
}));

vi.mock("../../../src/pinned/manager.js", () => ({
  pinnedMessageManager: {
    isInitialized: mocked.pinnedIsInitializedMock,
    initialize: mocked.pinnedInitializeMock,
    onSessionChange: mocked.pinnedOnSessionChangeMock,
    loadContextFromHistory: mocked.pinnedLoadContextFromHistoryMock,
    getContextInfo: mocked.pinnedGetContextInfoMock,
  },
}));

vi.mock("../../../src/utils/safe-background-task.js", () => ({
  safeBackgroundTask: vi.fn(),
}));

type SessionStub = {
  id: string;
  title: string;
  directory: string;
  time: {
    created: number;
  };
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
    reply: vi.fn().mockResolvedValue(undefined),
    api: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 888 }),
      deleteMessage: vi.fn().mockResolvedValue(true),
      editMessageText: vi.fn().mockResolvedValue(true),
    },
  } as unknown as Context;
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
    mocked.sessionGetMock.mockReset();
    mocked.setCurrentSessionMock.mockReset();
    mocked.clearSummaryMock.mockReset();
    mocked.clearInteractionMock.mockReset();
    mocked.keyboardInitializeMock.mockReset();
    mocked.keyboardGetKeyboardMock.mockReset();
    mocked.keyboardGetKeyboardMock.mockReturnValue({ inline_keyboard: [] });
    mocked.keyboardUpdateContextMock.mockReset();
    mocked.pinnedIsInitializedMock.mockReset();
    mocked.pinnedIsInitializedMock.mockReturnValue(false);
    mocked.pinnedInitializeMock.mockReset();
    mocked.pinnedOnSessionChangeMock.mockReset();
    mocked.pinnedOnSessionChangeMock.mockResolvedValue(undefined);
    mocked.pinnedLoadContextFromHistoryMock.mockReset();
    mocked.pinnedLoadContextFromHistoryMock.mockResolvedValue(undefined);
    mocked.pinnedGetContextInfoMock.mockReset();
    mocked.pinnedGetContextInfoMock.mockReturnValue(null);
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
    expect(keyboardRows[0]?.[0]?.callback_data).toBe("session:session-1");
    expect(keyboardRows[9]?.[0]?.callback_data).toBe("session:session-10");
    expect(keyboardRows[10]?.[0]?.callback_data).toBe("session:page:1");
    expect(keyboardRows[11]?.[0]?.callback_data).toBe("inline:cancel:session");
  });

  it("blocks sessions command while foreground session is busy", async () => {
    foregroundSessionState.markBusy("session-1");

    const ctx = createCommandContext();
    await sessionsCommand(ctx as never);

    expect(mocked.sessionListMock).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(t("interaction.blocked.finish_current"));
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
    const handled = await handleSessionSelect(ctx);

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
    expect(inlineRows[0]?.[0]?.callback_data).toBe("session:session-11");
    expect(inlineRows[1]?.[0]?.callback_data).toBe("session:session-12");
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
    const handled = await handleSessionSelect(ctx);

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
    const handled = await handleSessionSelect(ctx);

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

    const ctx = createCallbackContext("session:session-1", 456);
    const handled = await handleSessionSelect(ctx);

    expect(handled).toBe(true);
    expect(mocked.clearInteractionMock).toHaveBeenCalledWith("session_select_error");
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(t("sessions.select_error"));
  });

  it("blocks session selection callback while foreground session is busy", async () => {
    foregroundSessionState.markBusy("session-1");

    interactionManager.start({
      kind: "inline",
      expectedInput: "callback",
      metadata: {
        menuKind: "session",
        messageId: 456,
      },
    });

    const ctx = createCallbackContext("session:session-1", 456);
    const handled = await handleSessionSelect(ctx);

    expect(handled).toBe(true);
    expect(mocked.sessionGetMock).not.toHaveBeenCalled();
    expect(mocked.setCurrentSessionMock).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("interaction.blocked.finish_current"),
    });
  });
});
