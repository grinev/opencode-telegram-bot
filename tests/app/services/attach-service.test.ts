import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Context } from "grammy";
import {
  attachToSession,
  configureAttachPresentation,
  detachAttachedSession,
  restoreAttachedCurrentSession,
  restorePendingInteractionsAfterReconnect,
} from "../../../src/app/services/attach-service.js";
import { createAttachPresentation } from "../../../src/bot/services/attach-presentation.js";
import type { AppContainer } from "../../../src/app/bootstrap/app-container.js";
import { createTestAppContainer } from "../../helpers/app-container.js";
import { defined } from "../../helpers/defined.js";

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
  sessionGetMock: vi.fn(),
  questionListMock: vi.fn(),
  permissionListMock: vi.fn(),
  setSessionSummaryMock: vi.fn(),
  setBotAndChatIdMock: vi.fn(),
  registerRestoredPermissionChildMock: vi.fn(),
  pinnedIsInitializedMock: vi.fn(() => true),
  pinnedInitializeMock: vi.fn(),
  pinnedGetStateMock: vi.fn(),
  pinnedPrepareSessionChangeMock: vi.fn(),
  pinnedPrepareRestoreMock: vi.fn(),
  pinnedShowPreparedSessionMock: vi.fn(),
  pinnedDropPendingPrepareMock: vi.fn(),
  pinnedLoadContextFromHistoryMock: vi.fn(),
  pinnedGetContextInfoMock: vi.fn(() => null),
  pinnedSetAttachStateMock: vi.fn(),
  pinnedClearMock: vi.fn(),
  clearSessionMock: vi.fn(),
  keyboardInitializeMock: vi.fn(),
  keyboardUpdateContextMock: vi.fn(),
  showCurrentQuestionMock: vi.fn(),
  showPermissionRequestMock: vi.fn(),
  closeQuestionSettledOutsideMock: vi.fn(),
  closeQuestionNotAnsweredMock: vi.fn(),
  getTurnEndMarkMock: vi.fn(() => 7),
  startMissedLiveTurnMock: vi.fn(),
  applyPermissionPromptChangesMock: vi.fn(),
  ensureEventSubscriptionMock: vi.fn(),
  stopEventListeningMock: vi.fn(),
}));

vi.mock("../../../src/app/stores/settings-store.js", () => ({
  getCurrentProject: vi.fn(() => mocked.currentProject),
}));

vi.mock("../../../src/app/services/session-service.js", () => ({
  getCurrentSession: vi.fn(() => mocked.currentSession),
  clearSession: mocked.clearSessionMock,
}));

vi.mock("../../../src/opencode/client.js", () => ({
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

vi.mock("../../../src/opencode/events.js", () => ({
  stopEventListening: mocked.stopEventListeningMock,
}));

vi.mock("../../../src/bot/menus/question-menu.js", () => ({
  showCurrentQuestion: mocked.showCurrentQuestionMock,
  closeQuestionSettledOutside: mocked.closeQuestionSettledOutsideMock,
  closeQuestionNotAnswered: mocked.closeQuestionNotAnsweredMock,
}));

vi.mock("../../../src/bot/menus/permission-menu.js", () => ({
  showPermissionRequest: mocked.showPermissionRequestMock,
  applyPermissionPromptChanges: mocked.applyPermissionPromptChangesMock,
}));

function createDeps(): AppContainer {
  return {
    ...container,
    summaryAggregator: {
      setSession: mocked.setSessionSummaryMock,
      setBotAndChatId: mocked.setBotAndChatIdMock,
      registerRestoredPermissionChild: mocked.registerRestoredPermissionChildMock,
      getTurnEndMark: mocked.getTurnEndMarkMock,
      startMissedLiveTurn: mocked.startMissedLiveTurnMock,
      clear: vi.fn(),
    } as unknown as AppContainer["summaryAggregator"],
    pinnedMessageManager: {
      isInitialized: mocked.pinnedIsInitializedMock,
      initialize: mocked.pinnedInitializeMock,
      getState: mocked.pinnedGetStateMock,
      prepareSessionChange: mocked.pinnedPrepareSessionChangeMock,
      prepareRestore: mocked.pinnedPrepareRestoreMock,
      showPreparedSession: mocked.pinnedShowPreparedSessionMock,
      dropPendingPrepare: mocked.pinnedDropPendingPrepareMock,
      loadContextFromHistory: mocked.pinnedLoadContextFromHistoryMock,
      getContextInfo: mocked.pinnedGetContextInfoMock,
      setAttachState: mocked.pinnedSetAttachStateMock,
      clear: mocked.pinnedClearMock,
    } as unknown as AppContainer["pinnedMessageManager"],
    keyboardManager: {
      initialize: mocked.keyboardInitializeMock,
      updateContext: mocked.keyboardUpdateContextMock,
    } as unknown as AppContainer["keyboardManager"],
  };
}

function createBot(): Bot<Context> {
  return {
    api: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 1001 }),
    },
  } as unknown as Bot<Context>;
}

let container: AppContainer;

beforeEach(() => {
  container = createTestAppContainer();
});

describe("attach/service", () => {
  let deps: AppContainer;

  beforeEach(async () => {
    const { __resetStreamThrottleForTests } = await import(
      "../../../src/bot/streaming/stream-throttle.js"
    );
    __resetStreamThrottleForTests();
    deps = createDeps();
    configureAttachPresentation(createAttachPresentation(deps));
    container.questionManager.clear();
    container.permissionManager.clear();

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
    mocked.sessionGetMock.mockResolvedValue({ data: { id: "session-1" }, error: undefined });
    mocked.pinnedClearMock.mockReset();
    mocked.pinnedClearMock.mockResolvedValue(undefined);
    mocked.clearSessionMock.mockReset();
    mocked.registerRestoredPermissionChildMock.mockReset();
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
    mocked.pinnedPrepareSessionChangeMock.mockReset();
    mocked.pinnedPrepareSessionChangeMock.mockResolvedValue(undefined);
    mocked.pinnedPrepareRestoreMock.mockReset();
    mocked.pinnedPrepareRestoreMock.mockResolvedValue(undefined);
    mocked.pinnedShowPreparedSessionMock.mockReset();
    mocked.pinnedShowPreparedSessionMock.mockResolvedValue(undefined);
    mocked.pinnedDropPendingPrepareMock.mockReset();
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
    mocked.closeQuestionSettledOutsideMock.mockReset();
    mocked.closeQuestionSettledOutsideMock.mockResolvedValue(undefined);
    mocked.closeQuestionNotAnsweredMock.mockReset();
    mocked.closeQuestionNotAnsweredMock.mockResolvedValue(undefined);
    mocked.startMissedLiveTurnMock.mockReset();
    mocked.applyPermissionPromptChangesMock.mockReset();
    mocked.applyPermissionPromptChangesMock.mockResolvedValue(undefined);
    mocked.ensureEventSubscriptionMock.mockReset();
    mocked.ensureEventSubscriptionMock.mockResolvedValue(undefined);
    mocked.stopEventListeningMock.mockReset();
  });

  it("draws the dashboard only after the session's updates are followed", async () => {
    mocked.pinnedGetStateMock.mockReturnValueOnce({ sessionId: "other", messageId: 1 });

    await attachToSession({
      ...deps,
      bot: createBot(),
      chatId: 777,
      session: mocked.currentSession!,
      ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    });

    const prepared = defined(mocked.pinnedPrepareSessionChangeMock.mock.invocationCallOrder[0]);
    const followed = defined(mocked.setSessionSummaryMock.mock.invocationCallOrder[0]);
    const shown = defined(mocked.pinnedShowPreparedSessionMock.mock.invocationCallOrder[0]);
    expect(prepared).toBeLessThan(followed);
    expect(followed).toBeLessThan(shown);
  });

  it("still draws the prepared dashboard when following the session fails", async () => {
    mocked.ensureEventSubscriptionMock.mockRejectedValueOnce(new Error("subscribe failed"));

    await expect(
      attachToSession({
        ...deps,
        bot: createBot(),
        chatId: 777,
        session: mocked.currentSession!,
        ensureEventSubscription: mocked.ensureEventSubscriptionMock,
      }),
    ).rejects.toThrow("subscribe failed");

    expect(mocked.pinnedShowPreparedSessionMock).toHaveBeenCalledTimes(1);
  });

  it("follows an idle session and updates attach state", async () => {
    const result = await attachToSession({
      ...deps,
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
    expect(container.attachManager.getSnapshot()).toMatchObject({
      sessionId: "session-1",
      directory: "D:\\Projects\\Repo",
      busy: false,
    });
  });

  it("does not resubscribe when already following the same session", async () => {
    const bot = createBot();

    await attachToSession({
      ...deps,
      bot,
      chatId: 777,
      session: mocked.currentSession!,
      ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    });

    const result = await attachToSession({
      ...deps,
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
      ...deps,
      bot: createBot(),
      chatId: 777,
      session: mocked.currentSession!,
      ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    });

    expect(result.restoredQuestion).toBe(true);
    expect(mocked.showCurrentQuestionMock).toHaveBeenCalledOnce();
  });

  it("restores a detached child permission and attributes it to the followed root", async () => {
    const request = { id: "permission-child", sessionID: "child", permission: "edit", patterns: ["*"], metadata: {}, always: [] };
    mocked.permissionListMock.mockResolvedValue({ data: [request], error: null });
    mocked.sessionGetMock.mockResolvedValue({ data: { parentID: "session-1" }, error: null });

    const result = await attachToSession({
      ...deps, bot: createBot(), chatId: 777, session: mocked.currentSession!,
      ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    });

    expect(result.restoredPermissions).toBe(1);
    expect(mocked.registerRestoredPermissionChildMock).toHaveBeenCalledWith("child", "session-1");
    expect(mocked.showPermissionRequestMock).toHaveBeenCalledWith(expect.anything(), 777, request, expect.anything());
  });

  it("queues a child permission behind a restored question", async () => {
    mocked.questionListMock.mockResolvedValue({ data: [{ id: "question-1", sessionID: "session-1", questions: [] }], error: null });
    mocked.permissionListMock.mockResolvedValue({ data: [{ id: "permission-child", sessionID: "child", permission: "edit", patterns: ["*"], metadata: {}, always: [] }], error: null });
    mocked.sessionGetMock.mockResolvedValue({ data: { parentID: "session-1" }, error: null });

    await attachToSession({
      ...deps, bot: createBot(), chatId: 777, session: mocked.currentSession!,
      ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    });

    expect(mocked.showCurrentQuestionMock).toHaveBeenCalledOnce();
    expect(deps.interactionManager.getWaitingKind()).toBe("permission");
    expect(mocked.showPermissionRequestMock).not.toHaveBeenCalled();
  });

  it("restores a subagent's pending question through its parent chain", async () => {
    mocked.questionListMock.mockResolvedValue({
      data: [{ id: "question-child", sessionID: "child", questions: [] }],
      error: null,
    });
    mocked.sessionGetMock.mockResolvedValue({ data: { parentID: "session-1" }, error: null });

    const result = await attachToSession({
      ...deps, bot: createBot(), chatId: 777, session: mocked.currentSession!,
      ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    });

    expect(result.restoredQuestion).toBe(true);
    expect(mocked.registerRestoredPermissionChildMock).toHaveBeenCalledWith("child", "session-1");
    expect(mocked.showCurrentQuestionMock).toHaveBeenCalledOnce();
    expect(deps.questionManager.getRequestID()).toBe("question-child");
    expect(deps.questionManager.getSessionId()).toBe("child");
  });

  it("queues the pending questions after the first one", async () => {
    mocked.questionListMock.mockResolvedValue({
      data: [
        { id: "question-root", sessionID: "session-1", questions: [] },
        { id: "question-child", sessionID: "child", questions: [] },
      ],
      error: null,
    });
    mocked.sessionGetMock.mockResolvedValue({ data: { parentID: "session-1" }, error: null });

    await attachToSession({
      ...deps, bot: createBot(), chatId: 777, session: mocked.currentSession!,
      ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    });

    expect(mocked.showCurrentQuestionMock).toHaveBeenCalledOnce();
    expect(deps.questionManager.getRequestID()).toBe("question-root");
    expect(deps.interactionManager.getWaitingQuestionRequestIds()).toEqual(["question-child"]);
  });

  it("restores the saved current session on startup", async () => {
    const restored = await restoreAttachedCurrentSession({
      ...deps,
      bot: createBot(),
      chatId: 777,
      ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    });

    expect(restored).toBe(true);
    expect(mocked.ensureEventSubscriptionMock).toHaveBeenCalledWith("D:\\Projects\\Repo");
    expect(container.attachManager.getSnapshot()?.sessionId).toBe("session-1");
  });

  it("joins a restore already in progress instead of restoring the session twice", async () => {
    let releaseSubscription: () => void = () => {};
    mocked.ensureEventSubscriptionMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseSubscription = resolve;
        }),
    );

    const restoreDeps = {
      ...deps,
      bot: createBot(),
      chatId: 777,
      ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    };

    const first = restoreAttachedCurrentSession(restoreDeps);
    await vi.waitFor(() => {
      expect(mocked.ensureEventSubscriptionMock).toHaveBeenCalledTimes(1);
    });
    const second = restoreAttachedCurrentSession(restoreDeps);

    releaseSubscription();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toBe(true);
    expect(secondResult).toBe(true);
    expect(mocked.ensureEventSubscriptionMock).toHaveBeenCalledTimes(1);
  });

  it("reuses a saved pinned message after restart instead of recreating it", async () => {
    mocked.pinnedGetStateMock.mockReturnValueOnce({
      sessionId: null,
      messageId: 123,
    });

    const restored = await restoreAttachedCurrentSession({
      ...deps,
      bot: createBot(),
      chatId: 777,
      ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    });

    expect(restored).toBe(true);
    expect(mocked.pinnedPrepareRestoreMock).toHaveBeenCalledWith(
      "session-1",
      "Session One",
      "D:\\Projects\\Repo",
    );
    expect(mocked.pinnedPrepareSessionChangeMock).not.toHaveBeenCalled();
    expect(mocked.pinnedShowPreparedSessionMock).toHaveBeenCalledTimes(1);
  });

  it("drops a saved session the server no longer has instead of following it", async () => {
    mocked.sessionGetMock.mockResolvedValue({
      data: undefined,
      error: { name: "NotFoundError", data: { message: "Session not found: session-1" } },
    });

    const restored = await restoreAttachedCurrentSession({
      ...deps,
      bot: createBot(),
      chatId: 777,
      ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    });

    expect(restored).toBe(false);
    expect(mocked.clearSessionMock).toHaveBeenCalledOnce();
    expect(mocked.pinnedClearMock).toHaveBeenCalledOnce();
    expect(mocked.ensureEventSubscriptionMock).not.toHaveBeenCalled();
    expect(container.attachManager.getSnapshot()).toBeNull();
  });

  it("keeps the saved session when its lookup fails for another reason", async () => {
    mocked.sessionGetMock.mockResolvedValue({ data: undefined, error: new Error("boom") });

    const restored = await restoreAttachedCurrentSession({
      ...deps,
      bot: createBot(),
      chatId: 777,
      ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    });

    expect(restored).toBe(true);
    expect(mocked.clearSessionMock).not.toHaveBeenCalled();
  });

  it("restores requests that arrived while the event stream was down", async () => {
    container.attachManager.attach("session-1", "D:\Projects\Repo");
    mocked.questionListMock.mockResolvedValue({
      data: [{ id: "question-1", sessionID: "session-1", questions: [] }],
      error: null,
    });

    await restorePendingInteractionsAfterReconnect({ ...deps, bot: createBot(), chatId: 777 });

    expect(mocked.questionListMock).toHaveBeenCalledWith({ directory: "D:\Projects\Repo" });
    expect(mocked.showCurrentQuestionMock).toHaveBeenCalledOnce();
  });

  it("does not show again a request that is already on screen after a reconnect", async () => {
    container.attachManager.attach("session-1", "D:\Projects\Repo");
    const request = {
      id: "permission-1",
      sessionID: "session-1",
      permission: "edit",
      patterns: ["*"],
      metadata: {},
      always: [],
    };
    container.permissionManager.startPermission(request, 501);
    mocked.permissionListMock.mockResolvedValue({ data: [request], error: null });

    await restorePendingInteractionsAfterReconnect({ ...deps, bot: createBot(), chatId: 777 });

    expect(mocked.showPermissionRequestMock).not.toHaveBeenCalled();
  });

  describe("prompts settled while the event stream was down", () => {
    const permission = {
      id: "permission-1",
      sessionID: "session-1",
      permission: "edit",
      patterns: ["*"],
      metadata: {},
      always: [],
    };

    beforeEach(() => {
      container.attachManager.attach("session-1", "D:\\Projects\\Repo");
    });

    it("ends a permission prompt OpenCode no longer lists as answered outside Telegram", async () => {
      container.permissionManager.startPermission(permission, 501);

      await restorePendingInteractionsAfterReconnect({ ...deps, bot: createBot(), chatId: 777 });

      expect(mocked.applyPermissionPromptChangesMock).toHaveBeenCalledWith(
        expect.anything(),
        777,
        [expect.objectContaining({ messageId: 501, outcome: { kind: "settled_outside" } })],
        expect.anything(),
      );
      expect(container.permissionManager.isActive()).toBe(false);
    });

    it("closes a poll OpenCode no longer lists", async () => {
      container.questionManager.startQuestions([], "question-1", "session-1");

      await restorePendingInteractionsAfterReconnect({ ...deps, bot: createBot(), chatId: 777 });

      expect(mocked.closeQuestionSettledOutsideMock).toHaveBeenCalledWith(
        expect.anything(),
        777,
        "answered",
        expect.anything(),
      );
    });

    it("leaves answers being sent from Telegram to that send", async () => {
      container.permissionManager.startPermission(permission, 501);
      container.permissionManager.markSending(501, "once", false);

      await restorePendingInteractionsAfterReconnect({ ...deps, bot: createBot(), chatId: 777 });

      expect(mocked.applyPermissionPromptChangesMock).not.toHaveBeenCalled();
      expect(container.permissionManager.isActiveMessage(501)).toBe(true);

      container.permissionManager.clear();
      container.questionManager.startQuestions([], "question-1", "session-1");
      container.questionManager.startAnswer();

      await restorePendingInteractionsAfterReconnect({ ...deps, bot: createBot(), chatId: 777 });

      expect(mocked.closeQuestionSettledOutsideMock).not.toHaveBeenCalled();

      container.questionManager.startQuestions([], "question-2", "session-1");
      container.questionManager.startDismissal();

      await restorePendingInteractionsAfterReconnect({ ...deps, bot: createBot(), chatId: 777 });

      expect(mocked.closeQuestionSettledOutsideMock).not.toHaveBeenCalled();
    });

    it("drops waiting requests OpenCode no longer lists", async () => {
      container.questionManager.startQuestions([], "question-1", "session-1");
      container.interactionManager.waitPermission(permission);
      container.interactionManager.waitQuestion([], "question-2", "child");
      mocked.questionListMock.mockResolvedValue({
        data: [{ id: "question-1", sessionID: "session-1", questions: [] }],
        error: null,
      });

      await restorePendingInteractionsAfterReconnect({ ...deps, bot: createBot(), chatId: 777 });

      expect(container.interactionManager.getWaitingKind()).toBeNull();
      expect(mocked.closeQuestionSettledOutsideMock).not.toHaveBeenCalled();
    });

    it("leaves a prompt that arrived while the lists were loading", async () => {
      mocked.permissionListMock.mockImplementation(async () => {
        container.permissionManager.startPermission(permission, 502);
        return { data: [], error: null };
      });

      await restorePendingInteractionsAfterReconnect({ ...deps, bot: createBot(), chatId: 777 });

      expect(mocked.applyPermissionPromptChangesMock).not.toHaveBeenCalled();
      expect(container.permissionManager.isActiveMessage(502)).toBe(true);
      expect(container.permissionManager.isResolved("permission-1")).toBe(false);
    });

    it("does not restore a question released from the queue that is still being shown", async () => {
      container.interactionManager.setOnWaitingRequestReady(() => new Promise<void>(() => {}));
      container.permissionManager.startPermission({ ...permission, id: "permission-2" }, 503);
      container.interactionManager.waitQuestion([], "question-2", "session-1");
      container.permissionManager.endPrompt(503, { kind: "replied", reply: "once", outside: false });
      container.interactionManager.clearKind("permission", "permission_replied");
      mocked.questionListMock.mockResolvedValue({
        data: [{ id: "question-2", sessionID: "session-1", questions: [] }],
        error: null,
      });

      await restorePendingInteractionsAfterReconnect({ ...deps, bot: createBot(), chatId: 777 });

      expect(mocked.showCurrentQuestionMock).not.toHaveBeenCalled();
      expect(container.questionManager.isActive()).toBe(false);
    });

    it("checks nothing against a list that failed to load", async () => {
      container.permissionManager.startPermission(permission, 501);
      mocked.permissionListMock.mockResolvedValue({ data: undefined, error: new Error("boom") });

      await restorePendingInteractionsAfterReconnect({ ...deps, bot: createBot(), chatId: 777 });

      expect(mocked.applyPermissionPromptChangesMock).not.toHaveBeenCalled();
      expect(container.permissionManager.isActiveMessage(501)).toBe(true);
    });

    describe("after the server restarted", () => {
      it("ends a permission prompt OpenCode no longer lists as not answered", async () => {
        container.permissionManager.startPermission(permission, 501);

        await restorePendingInteractionsAfterReconnect(
          { ...deps, bot: createBot(), chatId: 777 },
          true,
        );

        expect(mocked.applyPermissionPromptChangesMock).toHaveBeenCalledWith(
          expect.anything(),
          777,
          [expect.objectContaining({ messageId: 501, outcome: { kind: "not_answered" } })],
          expect.anything(),
        );
      });

      it("closes a poll OpenCode no longer lists as not answered", async () => {
        container.questionManager.startQuestions([], "question-1", "session-1");

        await restorePendingInteractionsAfterReconnect(
          { ...deps, bot: createBot(), chatId: 777 },
          true,
        );

        expect(mocked.closeQuestionNotAnsweredMock).toHaveBeenCalledWith(
          expect.anything(),
          777,
          expect.anything(),
        );
        expect(mocked.closeQuestionSettledOutsideMock).not.toHaveBeenCalled();
      });

      it("starts the resumed turn the stream missed when the session is busy", async () => {
        mocked.sessionStatusMock.mockResolvedValue({
          data: { "session-1": { type: "busy" } },
          error: null,
        });

        await restorePendingInteractionsAfterReconnect(
          { ...deps, bot: createBot(), chatId: 777 },
          true,
        );

        expect(mocked.startMissedLiveTurnMock).toHaveBeenCalledWith("session-1", 7);
      });

      it("starts no turn for an idle session", async () => {
        mocked.sessionStatusMock.mockResolvedValue({ data: {}, error: null });

        await restorePendingInteractionsAfterReconnect(
          { ...deps, bot: createBot(), chatId: 777 },
          true,
        );

        expect(mocked.startMissedLiveTurnMock).not.toHaveBeenCalled();
      });
    });

    it("reads no session status after a reconnect to the same server", async () => {
      mocked.sessionStatusMock.mockClear();

      await restorePendingInteractionsAfterReconnect({ ...deps, bot: createBot(), chatId: 777 });

      expect(mocked.sessionStatusMock).not.toHaveBeenCalled();
      expect(mocked.startMissedLiveTurnMock).not.toHaveBeenCalled();
    });
  });

  it("does not show again on attach a permission already settled", async () => {
    const request = {
      id: "permission-1",
      sessionID: "session-1",
      permission: "edit",
      patterns: ["*"],
      metadata: {},
      always: [],
    };
    container.permissionManager.settleRequest("permission-1", "once");
    mocked.permissionListMock.mockResolvedValue({ data: [request], error: null });

    await attachToSession({
      ...deps,
      bot: createBot(),
      chatId: 777,
      session: { id: "session-1", title: "Session One", directory: "D:\\Projects\\Repo" },
      ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    });

    expect(mocked.showPermissionRequestMock).not.toHaveBeenCalled();
  });

  it("skips the reconnect restore when no session is followed", async () => {
    await restorePendingInteractionsAfterReconnect({ ...deps, bot: createBot(), chatId: 777 });

    expect(mocked.questionListMock).not.toHaveBeenCalled();
    expect(mocked.permissionListMock).not.toHaveBeenCalled();
  });

  it("skips startup restore when stored project and session do not match", async () => {
    mocked.currentProject = {
      id: "project-1",
      worktree: "D:\\Projects\\Other",
    };

    const restored = await restoreAttachedCurrentSession({
      ...deps,
      bot: createBot(),
      chatId: 777,
      ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    });

    expect(restored).toBe(false);
    expect(mocked.ensureEventSubscriptionMock).not.toHaveBeenCalled();
    expect(container.attachManager.getSnapshot()).toBeNull();
  });

  it("skips guarded startup restore when OpenCode server is unavailable", async () => {
    mocked.healthMock.mockRejectedValueOnce(new Error("fetch failed"));

    const restored = await restoreAttachedCurrentSession({
      ...deps,
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

  it("full restore repeats API-backed state without duplicating event subscription", async () => {
    const bot = createBot();

    await attachToSession({
      ...deps,
      bot,
      chatId: 777,
      session: mocked.currentSession!,
      ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    });

    const result = await attachToSession({
      ...deps,
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
    container.attachManager.attach("session-1", "D:\\Projects\\Repo");
    noteStreamActivity("session-1", Date.now() - 10 * 60_000);
    expect(getStreamThrottleMs("session-1")).toBe(5_000);

    detachAttachedSession("detach_command", deps);

    expect(mocked.stopEventListeningMock).not.toHaveBeenCalled();
    expect(container.attachManager.getSnapshot()).toBeNull();
    expect(getStreamThrottleMs("session-1")).toBe(1_000);
  });
});
