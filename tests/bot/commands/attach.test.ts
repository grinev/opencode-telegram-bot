import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Context } from "grammy";
import { attachCommand } from "../../../src/bot/commands/attach.js";
import { attachManager } from "../../../src/attach/manager.js";
import { questionManager } from "../../../src/question/manager.js";
import { permissionManager } from "../../../src/permission/manager.js";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  currentProject: {
    id: "project-1",
    worktree: "D:\\Projects\\Repo",
  } as { id: string; worktree: string } | null,
  currentSession: {
    id: "session-1",
    title: "Session One",
    directory: "D:\\Projects\\Repo",
  } as { id: string; title: string; directory: string } | null,
  sessionStatusMock: vi.fn(),
  questionListMock: vi.fn(),
  permissionListMock: vi.fn(),
  setSessionSummaryMock: vi.fn(),
  setBotAndChatIdMock: vi.fn(),
  pinnedIsInitializedMock: vi.fn(() => true),
  pinnedInitializeMock: vi.fn(),
  pinnedGetStateMock: vi.fn(),
  pinnedOnSessionChangeMock: vi.fn(),
  pinnedLoadContextFromHistoryMock: vi.fn(),
  pinnedGetContextInfoMock: vi.fn(() => null),
  pinnedSetAttachStateMock: vi.fn(),
  keyboardInitializeMock: vi.fn(),
  keyboardUpdateContextMock: vi.fn(),
  showCurrentQuestionMock: vi.fn(),
  showPermissionRequestMock: vi.fn(),
  ensureEventSubscriptionMock: vi.fn(),
}));

vi.mock("../../../src/settings/manager.js", () => ({
  getCurrentProject: vi.fn(() => mocked.currentProject),
}));

vi.mock("../../../src/session/manager.js", () => ({
  getCurrentSession: vi.fn(() => mocked.currentSession),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      status: mocked.sessionStatusMock,
    },
    question: {
      list: mocked.questionListMock,
    },
    permission: {
      list: mocked.permissionListMock,
    },
  },
}));

vi.mock("../../../src/summary/aggregator.js", () => ({
  summaryAggregator: {
    setSession: mocked.setSessionSummaryMock,
    setBotAndChatId: mocked.setBotAndChatIdMock,
    clear: vi.fn(),
  },
}));

vi.mock("../../../src/pinned/manager.js", () => ({
  pinnedMessageManager: {
    isInitialized: mocked.pinnedIsInitializedMock,
    initialize: mocked.pinnedInitializeMock,
    getState: mocked.pinnedGetStateMock,
    onSessionChange: mocked.pinnedOnSessionChangeMock,
    loadContextFromHistory: mocked.pinnedLoadContextFromHistoryMock,
    getContextInfo: mocked.pinnedGetContextInfoMock,
    setAttachState: mocked.pinnedSetAttachStateMock,
  },
}));

vi.mock("../../../src/keyboard/manager.js", () => ({
  keyboardManager: {
    initialize: mocked.keyboardInitializeMock,
    updateContext: mocked.keyboardUpdateContextMock,
  },
}));

vi.mock("../../../src/bot/handlers/question.js", () => ({
  showCurrentQuestion: mocked.showCurrentQuestionMock,
}));

vi.mock("../../../src/bot/handlers/permission.js", () => ({
  showPermissionRequest: mocked.showPermissionRequestMock,
}));

function createCtx(): Context {
  return {
    chat: { id: 777 },
    reply: vi.fn().mockResolvedValue({ message_id: 1000 }),
  } as unknown as Context;
}

function createBot(): Bot<Context> {
  return {
    api: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 1001 }),
    },
  } as unknown as Bot<Context>;
}

describe("bot/commands/attach", () => {
  beforeEach(() => {
    attachManager.__resetForTests();
    questionManager.clear();
    permissionManager.clear();

    mocked.currentProject = {
      id: "project-1",
      worktree: "D:\\Projects\\Repo",
    };
    mocked.currentSession = {
      id: "session-1",
      title: "Session One",
      directory: "D:\\Projects\\Repo",
    };

    mocked.sessionStatusMock.mockReset();
    mocked.sessionStatusMock.mockResolvedValue({
      data: {
        "session-1": { type: "idle" },
      },
      error: null,
    });
    mocked.questionListMock.mockReset();
    mocked.questionListMock.mockResolvedValue({ data: [], error: null });
    mocked.permissionListMock.mockReset();
    mocked.permissionListMock.mockResolvedValue({ data: [], error: null });
    mocked.setSessionSummaryMock.mockReset();
    mocked.setBotAndChatIdMock.mockReset();
    mocked.pinnedIsInitializedMock.mockReset();
    mocked.pinnedIsInitializedMock.mockReturnValue(true);
    mocked.pinnedInitializeMock.mockReset();
    mocked.pinnedGetStateMock.mockReset();
    mocked.pinnedGetStateMock.mockImplementation(() => ({
      sessionId: mocked.currentSession?.id ?? null,
      messageId: 123,
    }));
    mocked.pinnedOnSessionChangeMock.mockReset();
    mocked.pinnedOnSessionChangeMock.mockResolvedValue(undefined);
    mocked.pinnedLoadContextFromHistoryMock.mockReset();
    mocked.pinnedLoadContextFromHistoryMock.mockResolvedValue(undefined);
    mocked.pinnedGetContextInfoMock.mockReset();
    mocked.pinnedGetContextInfoMock.mockReturnValue(null);
    mocked.pinnedSetAttachStateMock.mockReset();
    mocked.pinnedSetAttachStateMock.mockResolvedValue(undefined);
    mocked.keyboardInitializeMock.mockReset();
    mocked.keyboardUpdateContextMock.mockReset();
    mocked.showCurrentQuestionMock.mockReset();
    mocked.showCurrentQuestionMock.mockResolvedValue(undefined);
    mocked.showPermissionRequestMock.mockReset();
    mocked.showPermissionRequestMock.mockResolvedValue(undefined);
    mocked.ensureEventSubscriptionMock.mockReset();
    mocked.ensureEventSubscriptionMock.mockResolvedValue(undefined);
  });

  it("requires a selected project", async () => {
    mocked.currentProject = null;

    const ctx = createCtx();
    await attachCommand(ctx as never, {
      bot: createBot(),
      ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    });

    expect(ctx.reply).toHaveBeenCalledWith(t("attach.project_not_selected"));
  });

  it("requires a selected session", async () => {
    mocked.currentSession = null;

    const ctx = createCtx();
    await attachCommand(ctx as never, {
      bot: createBot(),
      ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    });

    expect(ctx.reply).toHaveBeenCalledWith(t("attach.session_not_selected"));
  });

  it("attaches to an idle session and shows disconnect hint", async () => {
    const ctx = createCtx();
    await attachCommand(ctx as never, {
      bot: createBot(),
      ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    });

    expect(mocked.ensureEventSubscriptionMock).toHaveBeenCalledWith("D:\\Projects\\Repo");
    expect(mocked.setSessionSummaryMock).toHaveBeenCalledWith("session-1");
    expect(mocked.setBotAndChatIdMock).toHaveBeenCalled();
    expect(mocked.pinnedSetAttachStateMock).toHaveBeenCalledWith(true, false);
    expect(ctx.reply).toHaveBeenCalledWith(
      [
        t("attach.connected", { title: "Session One" }),
        t("attach.status.idle_message"),
        t("attach.disconnect_hint"),
      ].join("\n\n"),
    );
  });

  it("attaches to a busy session and marks it busy", async () => {
    mocked.sessionStatusMock.mockResolvedValueOnce({
      data: {
        "session-1": { type: "busy" },
      },
      error: null,
    });

    const ctx = createCtx();
    await attachCommand(ctx as never, {
      bot: createBot(),
      ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    });

    expect(attachManager.getSnapshot()).toMatchObject({
      sessionId: "session-1",
      directory: "D:\\Projects\\Repo",
      busy: true,
    });
    expect(mocked.pinnedSetAttachStateMock).toHaveBeenCalledWith(true, true);
    expect(ctx.reply).toHaveBeenCalledWith(
      [
        t("attach.connected", { title: "Session One" }),
        t("attach.status.busy_message"),
        t("attach.disconnect_hint"),
      ].join("\n\n"),
    );
  });

  it("reports already connected on repeated attach without resubscribing", async () => {
    const bot = createBot();
    const firstCtx = createCtx();
    await attachCommand(firstCtx as never, {
      bot,
      ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    });

    const secondCtx = createCtx();
    await attachCommand(secondCtx as never, {
      bot,
      ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    });

    expect(mocked.ensureEventSubscriptionMock).toHaveBeenCalledTimes(1);
    expect(secondCtx.reply).toHaveBeenCalledWith(
      [
        t("attach.already_connected", { title: "Session One" }),
        t("attach.status.idle_message"),
        t("attach.disconnect_hint"),
      ].join("\n\n"),
    );
  });

  it("restores a pending question for the attached session", async () => {
    mocked.questionListMock.mockResolvedValueOnce({
      data: [
        {
          id: "question-1",
          sessionID: "session-1",
          questions: [
            {
              header: "Q1",
              question: "Continue?",
              options: [{ label: "Yes", description: "continue" }],
            },
          ],
        },
      ],
      error: null,
    });

    const ctx = createCtx();
    await attachCommand(ctx as never, {
      bot: createBot(),
      ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    });

    expect(mocked.showCurrentQuestionMock).toHaveBeenCalledOnce();
    expect(ctx.reply).toHaveBeenCalledWith(
      [
        t("attach.connected", { title: "Session One" }),
        t("attach.status.idle_message"),
        t("attach.restored_question"),
        t("attach.disconnect_hint"),
      ].join("\n\n"),
    );
  });

  it("restores pending permissions when no question exists", async () => {
    mocked.permissionListMock.mockResolvedValueOnce({
      data: [
        {
          id: "perm-1",
          sessionID: "session-1",
          permission: "bash",
          patterns: ["npm test"],
          metadata: {},
          always: [],
        },
        {
          id: "perm-2",
          sessionID: "session-1",
          permission: "read",
          patterns: ["src/**"],
          metadata: {},
          always: [],
        },
      ],
      error: null,
    });

    const ctx = createCtx();
    await attachCommand(ctx as never, {
      bot: createBot(),
      ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    });

    expect(mocked.showPermissionRequestMock).toHaveBeenCalledTimes(2);
    expect(ctx.reply).toHaveBeenCalledWith(
      [
        t("attach.connected", { title: "Session One" }),
        t("attach.status.idle_message"),
        t("attach.restored_permissions", { count: 2 }),
        t("attach.disconnect_hint"),
      ].join("\n\n"),
    );
  });
});
