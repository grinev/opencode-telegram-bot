import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import {
  calculateMessagesPaginationRange,
  handleMessagesCallback,
  messagesCommand,
  parseMessagePageCallback,
} from "../../../src/bot/commands/messages.js";
import { interactionManager } from "../../../src/interaction/manager.js";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  currentProject: {
    id: "project-1",
    worktree: "D:\\Projects\\Repo",
  } as { id: string; worktree: string } | null,
  currentSession: {
    id: "session-1",
    title: "Session",
    directory: "D:\\Projects\\Repo",
  } as { id: string; title: string; directory: string } | null,
  sessionMessagesMock: vi.fn(),
  sessionGetMock: vi.fn(),
  sessionRevertMock: vi.fn(),
  sessionForkMock: vi.fn(),
  attachToSessionMock: vi.fn(),
  setCurrentSessionMock: vi.fn(),
  ingestSessionInfoForCacheMock: vi.fn(),
}));

vi.mock("../../../src/settings/manager.js", () => ({
  getCurrentProject: vi.fn(() => mocked.currentProject),
}));

vi.mock("../../../src/session/manager.js", () => ({
  getCurrentSession: vi.fn(() => mocked.currentSession),
  setCurrentSession: mocked.setCurrentSessionMock,
}));

vi.mock("../../../src/attach/service.js", () => ({
  attachToSession: mocked.attachToSessionMock,
}));

vi.mock("../../../src/session/cache-manager.js", () => ({
  ingestSessionInfoForCache: mocked.ingestSessionInfoForCacheMock,
  __resetSessionDirectoryCacheForTests: vi.fn(),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      messages: mocked.sessionMessagesMock,
      get: mocked.sessionGetMock,
      revert: mocked.sessionRevertMock,
      fork: mocked.sessionForkMock,
    },
  },
}));

function createCommandContext(messageId: number): Context {
  return {
    chat: { id: 777 },
    reply: vi.fn().mockResolvedValue({ message_id: messageId }),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

function createCallbackContext(data: string, messageId: number): Context {
  return {
    chat: { id: 777 },
    callbackQuery: {
      data,
      message: {
        message_id: messageId,
      },
    } as Context["callbackQuery"],
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    api: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 999 }),
    },
  } as unknown as Context;
}

const testDeps = {
  bot: {
    api: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 999 }),
    },
  },
  ensureEventSubscription: vi.fn().mockResolvedValue(undefined),
};

function makeUserMessage(id: string, text: string, created: number) {
  return {
    info: {
      id,
      role: "user",
      time: { created },
    },
    parts: [{ type: "text", text }],
  };
}

describe("bot/commands/messages", () => {
  beforeEach(() => {
    interactionManager.clear("test_setup");

    mocked.currentProject = {
      id: "project-1",
      worktree: "D:\\Projects\\Repo",
    };
    mocked.currentSession = {
      id: "session-1",
      title: "Session",
      directory: "D:\\Projects\\Repo",
    };
    mocked.sessionMessagesMock.mockReset();
    mocked.sessionGetMock.mockReset();
    mocked.sessionRevertMock.mockReset();
    mocked.sessionForkMock.mockReset();
    mocked.attachToSessionMock.mockReset();
    mocked.setCurrentSessionMock.mockReset();
    mocked.ingestSessionInfoForCacheMock.mockReset();

    // Default: session without revert
    mocked.sessionGetMock.mockResolvedValue({
      data: { id: "session-1", directory: "D:\\Projects\\Repo" },
      error: null,
    });
  });

  it("asks to select project when project is missing", async () => {
    mocked.currentProject = null;

    const ctx = createCommandContext(100);
    await messagesCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith(t("messages.project_not_selected"));
    expect(mocked.sessionMessagesMock).not.toHaveBeenCalled();
  });

  it("asks to select session when session is missing", async () => {
    mocked.currentSession = null;

    const ctx = createCommandContext(101);
    await messagesCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith(t("messages.session_not_selected"));
    expect(mocked.sessionMessagesMock).not.toHaveBeenCalled();
  });

  it("does not load messages when session belongs to another project", async () => {
    mocked.currentSession = {
      id: "session-2",
      title: "Other",
      directory: "D:\\Projects\\Other",
    };

    const ctx = createCommandContext(102);
    await messagesCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith(t("messages.session_project_mismatch"));
    expect(mocked.sessionMessagesMock).not.toHaveBeenCalled();
  });

  it("shows user messages newest first and starts custom interaction", async () => {
    const oldTime = new Date(2026, 4, 30, 10, 3).getTime();
    const newTime = new Date(2026, 4, 30, 14, 5).getTime();
    mocked.sessionMessagesMock.mockResolvedValue({
      data: [
        makeUserMessage("old", "older prompt", oldTime),
        {
          info: { id: "assistant-1", role: "assistant", time: { created: newTime + 1 } },
          parts: [{ type: "text", text: "assistant reply" }],
        },
        makeUserMessage("empty", "", newTime + 2),
        makeUserMessage("new", "newer prompt with\nline break", newTime),
      ],
      error: null,
    });

    const ctx = createCommandContext(200);
    await messagesCommand(ctx as never);

    expect(mocked.sessionMessagesMock).toHaveBeenCalledWith({
      sessionID: "session-1",
      directory: "D:\\Projects\\Repo",
    });

    const [, options] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { reply_markup: { inline_keyboard: Array<Array<{ callback_data?: string; text: string }>> } },
    ];

    expect(options.reply_markup.inline_keyboard[0]?.[0]?.callback_data).toBe("messages:select:0");
    expect(options.reply_markup.inline_keyboard[0]?.[0]?.text).toContain("[14:05] newer prompt with line break");
    expect(options.reply_markup.inline_keyboard[1]?.[0]?.callback_data).toBe("messages:select:1");
    expect(options.reply_markup.inline_keyboard[1]?.[0]?.text).toContain("[10:03] older prompt");
    expect(options.reply_markup.inline_keyboard[2]?.[0]?.callback_data).toBe("messages:cancel");

    const state = interactionManager.getSnapshot();
    expect(state?.kind).toBe("custom");
    expect(state?.expectedInput).toBe("callback");
    expect(state?.metadata.flow).toBe("messages");
    expect(state?.metadata.stage).toBe("list");
    expect(state?.metadata.messageId).toBe(200);
    expect(state?.metadata.messages).toEqual([
      { id: "new", text: "newer prompt with\nline break", created: newTime },
      { id: "old", text: "older prompt", created: oldTime },
    ]);
  });

  it("shows empty state when there are no user messages", async () => {
    mocked.sessionMessagesMock.mockResolvedValue({
      data: [
        {
          info: { id: "assistant-1", role: "assistant", time: { created: 1 } },
          parts: [{ type: "text", text: "assistant reply" }],
        },
      ],
      error: null,
    });

    const ctx = createCommandContext(201);
    await messagesCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith(t("messages.empty"));
  });

  it("filters messages to show only those before revert point", async () => {
    const time1 = new Date(2026, 4, 30, 10, 0).getTime();
    const time2 = new Date(2026, 4, 30, 11, 0).getTime();
    const time3 = new Date(2026, 4, 30, 12, 0).getTime();

    mocked.sessionMessagesMock.mockResolvedValue({
      data: [
        makeUserMessage("msg-1", "first message", time1),
        makeUserMessage("msg-2", "second message", time2),
        makeUserMessage("msg-3", "third message", time3),
      ],
      error: null,
    });

    // Session has revert to msg-2, so only msg-1 should be shown
    mocked.sessionGetMock.mockResolvedValue({
      data: {
        id: "session-1",
        directory: "D:\\Projects\\Repo",
        revert: { messageID: "msg-2" },
      },
      error: null,
    });

    const ctx = createCommandContext(202);
    await messagesCommand(ctx as never);

    const [, options] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { reply_markup: { inline_keyboard: Array<Array<{ callback_data?: string; text: string }>> } },
    ];

    // Should only show msg-1 (before the revert point)
    expect(options.reply_markup.inline_keyboard[0]?.[0]?.callback_data).toBe("messages:select:0");
    expect(options.reply_markup.inline_keyboard[0]?.[0]?.text).toContain("first message");
    // msg-2 and msg-3 should not be present
    expect(options.reply_markup.inline_keyboard[1]?.[0]?.callback_data).toBe("messages:cancel");

    const state = interactionManager.getSnapshot();
    expect(state?.metadata.messages).toEqual([
      { id: "msg-1", text: "first message", created: time1 },
    ]);
  });

  it("handles pagination callbacks", async () => {
    const messages = Array.from({ length: 12 }, (_, index) => ({
      id: `msg-${index + 1}`,
      text: `message ${index + 1}`,
      created: new Date(2026, 4, 30, 12, index).getTime(),
    }));

    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "messages",
        stage: "list",
        messageId: 300,
        projectDirectory: "D:\\Projects\\Repo",
        sessionId: "session-1",
        messages,
        page: 0,
      },
    });

    const ctx = createCallbackContext("messages:page:1", 300);
    const handled = await handleMessagesCallback(ctx, testDeps);

    expect(handled).toBe(true);
    const [text, options] = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { reply_markup: { inline_keyboard: Array<Array<{ callback_data?: string; text: string }>> } },
    ];
    expect(text).toBe(t("messages.select_page", { page: 2 }));
    expect(options.reply_markup.inline_keyboard[0]?.[0]?.callback_data).toBe("messages:select:10");
    expect(options.reply_markup.inline_keyboard[2]?.[0]?.callback_data).toBe("messages:page:0");
    expect(interactionManager.getSnapshot()?.metadata.page).toBe(1);
  });

  it("opens full message and provides placeholder actions", async () => {
    const created = new Date(2026, 4, 30, 9, 8).getTime();
    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "messages",
        stage: "list",
        messageId: 400,
        projectDirectory: "D:\\Projects\\Repo",
        sessionId: "session-1",
        messages: [{ id: "msg-1", text: "full prompt text", created }],
        page: 0,
      },
    });

    const ctx = createCallbackContext("messages:select:0", 400);
    const handled = await handleMessagesCallback(ctx, testDeps);

    expect(handled).toBe(true);
    const [text, options] = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { reply_markup: { inline_keyboard: Array<Array<{ callback_data?: string; text: string }>> } },
    ];
    expect(text).toBe("[09:08]\n\nfull prompt text");
    expect(options.reply_markup.inline_keyboard[0]?.[0]?.callback_data).toBe("messages:revert");
    expect(options.reply_markup.inline_keyboard[1]?.[0]?.callback_data).toBe("messages:fork");
    expect(options.reply_markup.inline_keyboard[2]?.[0]?.callback_data).toBe("messages:back");
    expect(options.reply_markup.inline_keyboard[2]?.[1]?.callback_data).toBe("messages:cancel");
    expect(interactionManager.getSnapshot()?.metadata.stage).toBe("detail");
  });

  it("returns to list from message detail on back", async () => {
    const messages = [{ id: "msg-1", text: "full prompt text", created: 1000 }];
    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "messages",
        stage: "detail",
        messageId: 500,
        projectDirectory: "D:\\Projects\\Repo",
        sessionId: "session-1",
        messages,
        page: 0,
        selectedIndex: 0,
      },
    });

    const ctx = createCallbackContext("messages:back", 500);
    const handled = await handleMessagesCallback(ctx, testDeps);

    expect(handled).toBe(true);
    expect(ctx.editMessageText).toHaveBeenCalledWith(
      t("messages.select"),
      expect.objectContaining({ reply_markup: expect.any(Object) }),
    );
    expect(interactionManager.getSnapshot()?.metadata.stage).toBe("list");
  });

  it("closes menu on cancel from detail", async () => {
    const messages = [{ id: "msg-1", text: "full prompt text", created: 1000 }];
    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "messages",
        stage: "detail",
        messageId: 500,
        projectDirectory: "D:\\Projects\\Repo",
        sessionId: "session-1",
        messages,
        page: 0,
        selectedIndex: 0,
      },
    });

    const ctx = createCallbackContext("messages:cancel", 500);
    const handled = await handleMessagesCallback(ctx, testDeps);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("messages.cancelled_callback"),
    });
    expect(ctx.deleteMessage).toHaveBeenCalledTimes(1);
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("closes menu on cancel from list", async () => {
    const messages = [{ id: "msg-1", text: "full prompt text", created: 1000 }];
    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "messages",
        stage: "list",
        messageId: 501,
        projectDirectory: "D:\\Projects\\Repo",
        sessionId: "session-1",
        messages,
        page: 0,
      },
    });

    const ctx = createCallbackContext("messages:cancel", 501);
    const handled = await handleMessagesCallback(ctx, testDeps);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("messages.cancelled_callback"),
    });
    expect(ctx.deleteMessage).toHaveBeenCalledTimes(1);
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("reverts message successfully", async () => {
    const messages = [{ id: "msg-1", text: "test prompt", created: 1000 }];
    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "messages",
        stage: "detail",
        messageId: 600,
        projectDirectory: "D:\\Projects\\Repo",
        sessionId: "session-1",
        messages,
        page: 0,
        selectedIndex: 0,
      },
    });

    mocked.sessionRevertMock.mockResolvedValue({});

    const ctx = createCallbackContext("messages:revert", 600);
    const handled = await handleMessagesCallback(ctx, testDeps);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith();
    expect(mocked.sessionRevertMock).toHaveBeenCalledWith({
      sessionID: "session-1",
      directory: "D:\\Projects\\Repo",
      messageID: "msg-1",
    });
    expect(ctx.editMessageText).toHaveBeenCalledWith(
      t("messages.revert_success", { text: "test prompt" }),
      { reply_markup: undefined },
    );
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("handles revert error", async () => {
    const messages = [{ id: "msg-1", text: "test prompt", created: 1000 }];
    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "messages",
        stage: "detail",
        messageId: 600,
        projectDirectory: "D:\\Projects\\Repo",
        sessionId: "session-1",
        messages,
        page: 0,
        selectedIndex: 0,
      },
    });

    mocked.sessionRevertMock.mockRejectedValue(new Error("API error"));

    const ctx = createCallbackContext("messages:revert", 600);
    const handled = await handleMessagesCallback(ctx, testDeps);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith();
    expect(mocked.sessionRevertMock).toHaveBeenCalledWith({
      sessionID: "session-1",
      directory: "D:\\Projects\\Repo",
      messageID: "msg-1",
    });
    expect(ctx.editMessageText).toHaveBeenCalledWith(t("messages.revert_error"), {
      reply_markup: undefined,
    });
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("rejects revert from list stage", async () => {
    const messages = [{ id: "msg-1", text: "test prompt", created: 1000 }];
    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "messages",
        stage: "list",
        messageId: 600,
        projectDirectory: "D:\\Projects\\Repo",
        sessionId: "session-1",
        messages,
        page: 0,
      },
    });

    const ctx = createCallbackContext("messages:revert", 600);
    const handled = await handleMessagesCallback(ctx, testDeps);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("messages.inactive_callback"),
      show_alert: true,
    });
    expect(mocked.sessionRevertMock).not.toHaveBeenCalled();
    expect(ctx.editMessageText).not.toHaveBeenCalled();
  });

  it("handles successful fork", async () => {
    const messages = [{ id: "msg-1", text: "test prompt", created: 1000 }];
    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "messages",
        stage: "detail",
        messageId: 600,
        projectDirectory: "D:\\Projects\\Repo",
        sessionId: "session-1",
        messages,
        page: 0,
        selectedIndex: 0,
      },
    });

    const forkedSession = {
      id: "session-2",
      title: "Forked Session",
      directory: "D:\\Projects\\Repo",
    };
    mocked.sessionForkMock.mockResolvedValue({ data: forkedSession, error: null });
    mocked.attachToSessionMock.mockResolvedValue({
      busy: false,
      alreadyAttached: false,
      restoredQuestion: false,
      restoredPermissions: 0,
    });
    mocked.ingestSessionInfoForCacheMock.mockResolvedValue(undefined);

    const ctx = createCallbackContext("messages:fork", 600);
    const handled = await handleMessagesCallback(ctx, testDeps);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith();
    expect(mocked.sessionForkMock).toHaveBeenCalledWith({
      sessionID: "session-1",
      messageID: "msg-1",
      directory: "D:\\Projects\\Repo",
    });
    expect(mocked.setCurrentSessionMock).toHaveBeenCalledWith({
      id: "session-2",
      title: "Forked Session",
      directory: "D:\\Projects\\Repo",
    });
    expect(mocked.attachToSessionMock).toHaveBeenCalled();
    expect(ctx.editMessageText).toHaveBeenCalledWith(
      t("messages.fork_success", { text: "test prompt" }),
      { reply_markup: undefined },
    );
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("handles fork error", async () => {
    const messages = [{ id: "msg-1", text: "test prompt", created: 1000 }];
    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "messages",
        stage: "detail",
        messageId: 600,
        projectDirectory: "D:\\Projects\\Repo",
        sessionId: "session-1",
        messages,
        page: 0,
        selectedIndex: 0,
      },
    });

    mocked.sessionForkMock.mockRejectedValue(new Error("API error"));

    const ctx = createCallbackContext("messages:fork", 600);
    const handled = await handleMessagesCallback(ctx, testDeps);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith();
    expect(mocked.sessionForkMock).toHaveBeenCalledWith({
      sessionID: "session-1",
      messageID: "msg-1",
      directory: "D:\\Projects\\Repo",
    });
    expect(ctx.editMessageText).toHaveBeenCalledWith(t("messages.fork_error"), {
      reply_markup: undefined,
    });
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("rejects fork from list stage", async () => {
    const messages = [{ id: "msg-1", text: "test prompt", created: 1000 }];
    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "messages",
        stage: "list",
        messageId: 600,
        projectDirectory: "D:\\Projects\\Repo",
        sessionId: "session-1",
        messages,
        page: 0,
      },
    });

    const ctx = createCallbackContext("messages:fork", 600);
    const handled = await handleMessagesCallback(ctx, testDeps);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("messages.inactive_callback"),
      show_alert: true,
    });
    expect(mocked.sessionForkMock).not.toHaveBeenCalled();
    expect(ctx.editMessageText).not.toHaveBeenCalled();
  });

  it("handles stale callback as inactive", async () => {
    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "messages",
        stage: "list",
        messageId: 700,
        projectDirectory: "D:\\Projects\\Repo",
        sessionId: "session-1",
        messages: [{ id: "msg-1", text: "text", created: 1000 }],
        page: 0,
      },
    });

    const ctx = createCallbackContext("messages:select:0", 999);
    const handled = await handleMessagesCallback(ctx, testDeps);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("messages.inactive_callback"),
      show_alert: true,
    });
    expect(ctx.editMessageText).not.toHaveBeenCalled();
  });
});

describe("messages pagination helpers", () => {
  it("parses valid page callbacks", () => {
    expect(parseMessagePageCallback("messages:page:0")).toBe(0);
    expect(parseMessagePageCallback("messages:page:12")).toBe(12);
  });

  it("returns null for non-page callbacks", () => {
    expect(parseMessagePageCallback("messages:select:0")).toBeNull();
    expect(parseMessagePageCallback("messages:page:-1")).toBeNull();
    expect(parseMessagePageCallback("messages:page:abc")).toBeNull();
  });

  it("calculates pagination bounds", () => {
    expect(calculateMessagesPaginationRange(25, 1, 10)).toEqual({
      page: 1,
      totalPages: 3,
      startIndex: 10,
      endIndex: 20,
    });
    expect(calculateMessagesPaginationRange(25, 99, 10)).toEqual({
      page: 2,
      totalPages: 3,
      startIndex: 20,
      endIndex: 25,
    });
  });
});
