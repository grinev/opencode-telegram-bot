import { beforeEach, describe, expect, it, vi } from "#vitest";
import type { Bot, Context } from "grammy";
import { loadSut } from "#helpers/sut-loader.js";
const { attachToSession, configureAttachPresentation, detachAttachedSession, restoreAttachedCurrentSession } = await loadSut<typeof import("#src/app/services/attach-service.js")>(
  "#src/app/services/attach-service.ts",
  import.meta.url,
);
const { attachManager } = await loadSut<typeof import("#src/app/managers/attach-manager.js")>(
  "#src/app/managers/attach-manager.ts",
  import.meta.url,
);
const { questionManager } = await loadSut<typeof import("#src/app/managers/question-manager.js")>(
  "#src/app/managers/question-manager.ts",
  import.meta.url,
);
const { permissionManager } = await loadSut<typeof import("#src/app/managers/permission-manager.js")>(
  "#src/app/managers/permission-manager.ts",
  import.meta.url,
);
const { createAttachPresentation } = await loadSut<typeof import("#src/bot/services/attach-presentation.js")>(
  "#src/bot/services/attach-presentation.ts",
  import.meta.url,
);

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
  healthMock: vi.fn(),
  sessionStatusMock: vi.fn(),
  questionListMock: vi.fn(),
  permissionListMock: vi.fn(),
  setSessionSummaryMock: vi.fn(),
  setBotAndChatIdMock: vi.fn(),
  pinnedIsInitializedMock: vi.fn(() => true),
  pinnedInitializeMock: vi.fn(),
  pinnedGetStateMock: vi.fn(),
  pinnedOnSessionChangeMock: vi.fn(),
  pinnedRestoreExistingSessionMock: vi.fn(),
  pinnedLoadContextFromHistoryMock: vi.fn(),
  pinnedGetContextInfoMock: vi.fn(() => null),
  pinnedSetAttachStateMock: vi.fn(),
  keyboardInitializeMock: vi.fn(),
  keyboardUpdateContextMock: vi.fn(),
  showCurrentQuestionMock: vi.fn(),
  showPermissionRequestMock: vi.fn(),
  ensureEventSubscriptionMock: vi.fn(),
  stopEventListeningMock: vi.fn(),
  sessionGetMock: vi.fn(),
  clearSessionMock: vi.fn(),
  clearProjectMock: vi.fn(),
  clearPinnedMessageIdMock: vi.fn(),
  getProjectsMock: vi.fn(),
}));

vi.mock("#src/app/stores/settings-store.ts", () => ({
  getCurrentProject: vi.fn(() => mocked.currentProject),
  clearProject: mocked.clearProjectMock,
  clearPinnedMessageId: mocked.clearPinnedMessageIdMock,
}));

vi.mock("#src/app/services/session-service.ts", () => ({
  getCurrentSession: vi.fn(() => mocked.currentSession),
  clearSession: mocked.clearSessionMock,
}));

vi.mock("#src/app/services/project-service.ts", () => ({
  getProjects: mocked.getProjectsMock,
}));

vi.mock("#src/opencode/client.ts", () => ({
  opencodeClient: {
    global: {
      health: mocked.healthMock,
    },
    session: {
      status: mocked.sessionStatusMock,
      get: mocked.sessionGetMock,
    },
    question: {
      list: mocked.questionListMock,
    },
    permission: {
      list: mocked.permissionListMock,
    },
  },
}));

vi.mock("#src/opencode/events.ts", () => ({
  stopEventListening: mocked.stopEventListeningMock,
}));

vi.mock("#src/app/managers/summary-aggregation-manager.ts", () => ({
  summaryAggregator: {
    setSession: mocked.setSessionSummaryMock,
    setBotAndChatId: mocked.setBotAndChatIdMock,
    clear: vi.fn(),
  },
}));

vi.mock("#src/bot/pinned/pinned-message-manager.ts", () => ({
  pinnedMessageManager: {
    isInitialized: mocked.pinnedIsInitializedMock,
    initialize: mocked.pinnedInitializeMock,
    getState: mocked.pinnedGetStateMock,
    onSessionChange: mocked.pinnedOnSessionChangeMock,
    restoreExistingSession: mocked.pinnedRestoreExistingSessionMock,
    loadContextFromHistory: mocked.pinnedLoadContextFromHistoryMock,
    getContextInfo: mocked.pinnedGetContextInfoMock,
    setAttachState: mocked.pinnedSetAttachStateMock,
  },
}));

vi.mock("#src/bot/keyboards/keyboard-manager.ts", () => ({
  keyboardManager: {
    initialize: mocked.keyboardInitializeMock,
    updateContext: mocked.keyboardUpdateContextMock,
  },
}));

vi.mock("#src/bot/menus/question-menu.ts", () => ({
  showCurrentQuestion: mocked.showCurrentQuestionMock,
}));

vi.mock("#src/bot/menus/permission-menu.ts", () => ({
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
  beforeEach(async () => {
    const { __resetStreamThrottleForTests } = await import(
      "../../../src/bot/streaming/stream-throttle.js"
    );
    __resetStreamThrottleForTests();
    attachManager.__resetForTests();
    configureAttachPresentation(createAttachPresentation());
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
    mocked.healthMock.mockReset();
    mocked.healthMock.mockResolvedValue({ data: { healthy: true }, error: null });
    mocked.sessionStatusMock.mockReset();
    mocked.sessionStatusMock.mockResolvedValue({
      data: {
        "session-1": { type: "idle" },
      },
      error: null,
    });
    mocked.sessionGetMock.mockReset();
    mocked.sessionGetMock.mockResolvedValue({
      data: { id: "session-1", directory: "D:\\Projects\\Repo" },
      error: null,
    });
    mocked.getProjectsMock.mockReset();
    mocked.getProjectsMock.mockResolvedValue([
      { id: "project-1", worktree: "D:\\Projects\\Repo", name: "Repo" },
    ]);
    mocked.clearSessionMock.mockReset();
    mocked.clearProjectMock.mockReset();
    mocked.clearPinnedMessageIdMock.mockReset();
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
    mocked.pinnedRestoreExistingSessionMock.mockReset();
    mocked.pinnedRestoreExistingSessionMock.mockResolvedValue(undefined);
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
    mocked.stopEventListeningMock.mockReset();
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

  it("reuses a saved pinned message after restart instead of recreating it", async () => {
    mocked.pinnedGetStateMock.mockReturnValueOnce({
      sessionId: null,
      messageId: 123,
    });

    const restored = await restoreAttachedCurrentSession({
      bot: createBot(),
      chatId: 777,
      ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    });

    expect(restored).toBe(true);
    expect(mocked.pinnedRestoreExistingSessionMock).toHaveBeenCalledWith(
      "session-1",
      "Session One",
    );
    expect(mocked.pinnedOnSessionChangeMock).not.toHaveBeenCalled();
    expect(mocked.pinnedLoadContextFromHistoryMock).toHaveBeenCalledWith(
      "session-1",
      "D:\\Projects\\Repo",
    );
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

  it("skips guarded startup restore when OpenCode server is unavailable", async () => {
    mocked.healthMock.mockRejectedValueOnce(new Error("fetch failed"));

    const restored = await restoreAttachedCurrentSession({
      bot: createBot(),
      chatId: 777,
      ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    });

    expect(restored).toBe(false);
    expect(mocked.pinnedLoadContextFromHistoryMock).not.toHaveBeenCalled();
    expect(mocked.sessionStatusMock).not.toHaveBeenCalled();
    expect(mocked.questionListMock).not.toHaveBeenCalled();
    expect(mocked.permissionListMock).not.toHaveBeenCalled();
    expect(mocked.ensureEventSubscriptionMock).not.toHaveBeenCalled();
  });

  it("clears a stale stored session that no longer exists on the server", async () => {
    mocked.sessionGetMock.mockResolvedValueOnce({
      data: null,
      error: { name: "NotFoundError", data: { message: "Session not found: session-1" } },
    });

    const restored = await restoreAttachedCurrentSession({
      bot: createBot(),
      chatId: 777,
      ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    });

    expect(restored).toBe(false);
    expect(mocked.clearSessionMock).toHaveBeenCalledOnce();
    expect(mocked.clearPinnedMessageIdMock).toHaveBeenCalledOnce();
    expect(mocked.ensureEventSubscriptionMock).not.toHaveBeenCalled();
    expect(attachManager.getSnapshot()).toBeNull();
  });

  it("clears the stored project too when it is no longer in the visible list", async () => {
    mocked.sessionGetMock.mockResolvedValueOnce({
      data: null,
      error: { name: "NotFoundError", data: { message: "Session not found: session-1" } },
    });
    mocked.getProjectsMock.mockResolvedValueOnce([
      { id: "other-project", worktree: "D:\\Projects\\Other", name: "Other" },
    ]);

    const restored = await restoreAttachedCurrentSession({
      bot: createBot(),
      chatId: 777,
      ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    });

    expect(restored).toBe(false);
    expect(mocked.clearSessionMock).toHaveBeenCalledOnce();
    expect(mocked.clearProjectMock).toHaveBeenCalledOnce();
    expect(attachManager.getSnapshot()).toBeNull();
  });

  it("keeps the stored project when it is still in the visible list", async () => {
    mocked.sessionGetMock.mockResolvedValueOnce({
      data: null,
      error: { name: "NotFoundError", data: { message: "Session not found: session-1" } },
    });

    const restored = await restoreAttachedCurrentSession({
      bot: createBot(),
      chatId: 777,
      ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    });

    expect(restored).toBe(false);
    expect(mocked.clearSessionMock).toHaveBeenCalledOnce();
    expect(mocked.clearProjectMock).not.toHaveBeenCalled();
  });

  it("does not clear session state on unexpected session lookup errors", async () => {
    mocked.sessionGetMock.mockResolvedValueOnce({
      data: null,
      error: { name: "InternalError", data: { message: "boom" } },
    });

    const restored = await restoreAttachedCurrentSession({
      bot: createBot(),
      chatId: 777,
      ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    });

    expect(restored).toBe(false);
    expect(mocked.clearSessionMock).not.toHaveBeenCalled();
    expect(mocked.clearProjectMock).not.toHaveBeenCalled();
    expect(mocked.clearPinnedMessageIdMock).not.toHaveBeenCalled();
  });

  it("full restore repeats API-backed state without duplicating event subscription", async () => {
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
      forceFullRestore: true,
    });

    expect(result.alreadyAttached).toBe(true);
    expect(mocked.ensureEventSubscriptionMock).toHaveBeenCalledTimes(1);
    expect(mocked.pinnedLoadContextFromHistoryMock).toHaveBeenCalledTimes(1);
    expect(mocked.sessionStatusMock).toHaveBeenCalledTimes(2);
    expect(mocked.questionListMock).toHaveBeenCalledTimes(2);
  });

  it("detaches locally without stopping the directory event listener", async () => {
    const { noteStreamActivity, getStreamThrottleMs } = await import(
      "../../../src/bot/streaming/stream-throttle.js"
    );
    attachManager.attach("session-1", "D:\\Projects\\Repo");
    noteStreamActivity("session-1", Date.now() - 10 * 60_000);
    expect(getStreamThrottleMs("session-1")).toBe(5_000);

    detachAttachedSession("detach_command");

    expect(mocked.stopEventListeningMock).not.toHaveBeenCalled();
    expect(attachManager.getSnapshot()).toBeNull();
    expect(getStreamThrottleMs("session-1")).toBe(1_000);
  });
});
