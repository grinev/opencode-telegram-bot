import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Context } from "grammy";
import {
  attachToSession,
  restoreAttachedCurrentSession,
} from "../../src/attach/service.js";
import { attachManager } from "../../src/attach/manager.js";
import { questionManager } from "../../src/question/manager.js";
import { permissionManager } from "../../src/permission/manager.js";

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

vi.mock("../../src/settings/manager.js", () => ({
  getCurrentProject: vi.fn(() => mocked.currentProject),
}));

vi.mock("../../src/session/manager.js", () => ({
  getCurrentSession: vi.fn(() => mocked.currentSession),
}));

vi.mock("../../src/opencode/client.js", () => ({
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

vi.mock("../../src/summary/aggregator.js", () => ({
  summaryAggregator: {
    setSession: mocked.setSessionSummaryMock,
    setBotAndChatId: mocked.setBotAndChatIdMock,
    clear: vi.fn(),
  },
}));

vi.mock("../../src/pinned/manager.js", () => ({
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

vi.mock("../../src/keyboard/manager.js", () => ({
  keyboardManager: {
    initialize: mocked.keyboardInitializeMock,
    updateContext: mocked.keyboardUpdateContextMock,
  },
}));

vi.mock("../../src/bot/handlers/question.js", () => ({
  showCurrentQuestion: mocked.showCurrentQuestionMock,
}));

vi.mock("../../src/bot/handlers/permission.js", () => ({
  showPermissionRequest: mocked.showPermissionRequestMock,
}));

function createBot(): Bot<Context> {
  return {
    api: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 1001 }),
    },
  } as unknown as Bot<Context>;
}

describe("attach/service", () => {
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

  it("follows an idle session and updates attach state", async () => {
    const result = await attachToSession({
      bot: createBot(),
      chatId: 777,
      session: mocked.currentSession!,
      ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    });

    expect(result).toEqual({
      busy: false,
      alreadyAttached: false,
      restoredQuestion: false,
      restoredPermissions: 0,
    });
    expect(mocked.ensureEventSubscriptionMock).toHaveBeenCalledWith("D:\\Projects\\Repo");
    expect(mocked.setSessionSummaryMock).toHaveBeenCalledWith("session-1");
    expect(mocked.setBotAndChatIdMock).toHaveBeenCalled();
    expect(mocked.pinnedSetAttachStateMock).toHaveBeenCalledWith(true, false);
    expect(attachManager.getSnapshot()).toMatchObject({
      sessionId: "session-1",
      directory: "D:\\Projects\\Repo",
      busy: false,
    });
  });

  it("does not resubscribe when already following the same session", async () => {
    const bot = createBot();

    await attachToSession({
      bot,
      chatId: 777,
      session: mocked.currentSession!,
      ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    });

    const result = await attachToSession({
      bot,
      chatId: 777,
      session: mocked.currentSession!,
      ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    });

    expect(result.alreadyAttached).toBe(true);
    expect(mocked.ensureEventSubscriptionMock).toHaveBeenCalledTimes(1);
  });

  it("restores a pending question when first following a session", async () => {
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

    const result = await attachToSession({
      bot: createBot(),
      chatId: 777,
      session: mocked.currentSession!,
      ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    });

    expect(result.restoredQuestion).toBe(true);
    expect(mocked.showCurrentQuestionMock).toHaveBeenCalledOnce();
  });

  it("restores the saved current session on startup", async () => {
    const restored = await restoreAttachedCurrentSession({
      bot: createBot(),
      chatId: 777,
      ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    });

    expect(restored).toBe(true);
    expect(mocked.ensureEventSubscriptionMock).toHaveBeenCalledWith("D:\\Projects\\Repo");
    expect(attachManager.getSnapshot()?.sessionId).toBe("session-1");
  });

  it("skips startup restore when stored project and session do not match", async () => {
    mocked.currentProject = {
      id: "project-1",
      worktree: "D:\\Projects\\Other",
    };

    const restored = await restoreAttachedCurrentSession({
      bot: createBot(),
      chatId: 777,
      ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    });

    expect(restored).toBe(false);
    expect(mocked.ensureEventSubscriptionMock).not.toHaveBeenCalled();
    expect(attachManager.getSnapshot()).toBeNull();
  });
});
