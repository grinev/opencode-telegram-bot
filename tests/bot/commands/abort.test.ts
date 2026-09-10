import { beforeEach, describe, expect, it, vi } from "#vitest";
import type { Context } from "grammy";
import { loadSut } from "#helpers/sut-loader.js";
const { abortCommand, abortCurrentOperation } = await loadSut<typeof import("#src/bot/commands/abort-command.js")>(
  "#src/bot/commands/abort-command.ts",
  import.meta.url,
);
const { clearAllInteractionState } = await loadSut<typeof import("#src/app/managers/interaction-manager.js")>(
  "#src/app/managers/interaction-manager.ts",
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
const { renameManager } = await loadSut<typeof import("#src/app/managers/rename-manager.js")>(
  "#src/app/managers/rename-manager.ts",
  import.meta.url,
);
const { interactionManager } = await loadSut<typeof import("#src/app/managers/interaction-manager.js")>(
  "#src/app/managers/interaction-manager.ts",
  import.meta.url,
);
const { foregroundSessionState } = await loadSut<typeof import("#src/app/managers/foreground-session-state-manager.js")>(
  "#src/app/managers/foreground-session-state-manager.ts",
  import.meta.url,
);
import type { Question } from "#src/app/types/question.js";
import type { PermissionRequest } from "#src/app/types/permission.js";
const { t } = await loadSut<typeof import("#src/i18n/index.js")>(
  "#src/i18n/index.ts",
  import.meta.url,
);
const { __resetUserAbortErrorSuppressionForTests, shouldSuppressUserAbortSessionError } = await loadSut<typeof import("#src/app/managers/abort-suppression-manager.js")>(
  "#src/app/managers/abort-suppression-manager.ts",
  import.meta.url,
);
import { promptQueue } from "#src/app/managers/prompt-queue-manager.js";
import { promptAttachment } from "#src/app/managers/prompt-attachment-manager.js";
import { createIncomingPrompt } from "#src/app/types/prompt.js";

const mocked = vi.hoisted(() => ({
  currentSession: null as { id: string; title: string; directory: string } | null,
  abortMock: vi.fn(),
  statusMock: vi.fn(),
  clearRunMock: vi.fn(),
  markAttachedSessionIdleMock: vi.fn(),
  clearPromptResponseModeMock: vi.fn(),
}));

vi.mock("#src/app/services/session-service.ts", () => ({
  getCurrentSession: vi.fn(() => mocked.currentSession),
}));

vi.mock("#src/opencode/client.ts", () => ({
  opencodeClient: {
    session: {
      abort: mocked.abortMock,
      status: mocked.statusMock,
    },
  },
}));

vi.mock("#src/app/managers/assistant-run-state-manager.ts", () => ({
  assistantRunState: {
    clearRun: mocked.clearRunMock,
  },
}));

vi.mock("#src/app/services/attach-service.ts", () => ({
  markAttachedSessionIdle: mocked.markAttachedSessionIdleMock,
}));

vi.mock("#src/bot/handlers/prompt.ts", () => ({
  clearPromptResponseMode: mocked.clearPromptResponseModeMock,
}));

const TEST_QUESTION: Question = {
  header: "Q1",
  question: "Pick one",
  options: [
    { label: "Yes", description: "accept" },
    { label: "No", description: "decline" },
  ],
};

const TEST_PERMISSION: PermissionRequest = {
  id: "perm-1",
  sessionID: "session-1",
  permission: "bash",
  patterns: ["npm test"],
  metadata: {},
  always: [],
};

function activateInteractionState(): void {
  questionManager.startQuestions([TEST_QUESTION], "req-abort");
  permissionManager.startPermission(TEST_PERMISSION, 101);
  renameManager.startWaiting("session-1", "D:/repo", "Old title");
  interactionManager.start({
    kind: "rename",
    expectedInput: "text",
    metadata: { sessionId: "session-1" },
  });
}

describe("bot/commands/abort", () => {
  beforeEach(() => {
    clearAllInteractionState("test_setup");
    foregroundSessionState.__resetForTests();
    mocked.currentSession = null;
    mocked.abortMock.mockReset();
    mocked.statusMock.mockReset();
    mocked.clearRunMock.mockReset();
    mocked.markAttachedSessionIdleMock.mockReset();
    mocked.markAttachedSessionIdleMock.mockResolvedValue(undefined);
    mocked.clearPromptResponseModeMock.mockReset();
    __resetUserAbortErrorSuppressionForTests();
  });

  function markSessionBusy(): void {
    foregroundSessionState.markBusy("session-1", "D:/repo");
  }

  function expectAbortStateReleased(reason: string): void {
    expect(foregroundSessionState.isBusy()).toBe(false);
    expect(mocked.clearRunMock).toHaveBeenCalledWith("session-1", reason);
    expect(mocked.markAttachedSessionIdleMock).toHaveBeenCalledWith("session-1");
    expect(mocked.clearPromptResponseModeMock).toHaveBeenCalledWith("session-1");
  }

  it("clears interaction state even when there is no active session", async () => {
    activateInteractionState();

    const replyMock = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      reply: replyMock,
    } as unknown as Context;

    await abortCommand(ctx as never);

    expect(replyMock).toHaveBeenCalledWith(t("stop.no_active_session"));
    expect(questionManager.isActive()).toBe(false);
    expect(permissionManager.isActive()).toBe(false);
    expect(renameManager.isWaitingForName()).toBe(false);
    expect(interactionManager.getSnapshot()).toBeNull();
    expect(mocked.abortMock).not.toHaveBeenCalled();
  });

  it("clears interaction state and aborts active session", async () => {
    activateInteractionState();

    mocked.currentSession = {
      id: "session-1",
      title: "Session",
      directory: "D:/repo",
    };
    markSessionBusy();

    mocked.abortMock.mockResolvedValue({ data: true, error: null });
    mocked.statusMock.mockResolvedValue({
      data: {
        "session-1": { type: "idle" },
      },
      error: null,
    });

    const replyMock = vi.fn().mockResolvedValue({ message_id: 88 });
    const editMessageTextMock = vi.fn().mockResolvedValue(undefined);

    const ctx = {
      chat: { id: 777 },
      reply: replyMock,
      api: {
        editMessageText: editMessageTextMock,
      },
    } as unknown as Context;

    await abortCommand(ctx as never);

    expect(replyMock).toHaveBeenCalledWith(t("stop.in_progress"));
    expect(mocked.abortMock).toHaveBeenCalled();
    expect(editMessageTextMock).toHaveBeenCalledWith(777, 88, t("stop.success"));

    expect(questionManager.isActive()).toBe(false);
    expect(permissionManager.isActive()).toBe(false);
    expect(renameManager.isWaitingForName()).toBe(false);
    expect(interactionManager.getSnapshot()).toBeNull();
    expectAbortStateReleased("abort_confirmed");
    expect(shouldSuppressUserAbortSessionError("session-1", "Aborted")).toBe(true);
  });

  it("drops queued prompts so they do not run after the abort", async () => {
    mocked.currentSession = {
      id: "session-1",
      title: "Session",
      directory: "D:\\Projects\\Repo",
    };
    mocked.abortMock.mockResolvedValue({ data: true, error: null });
    mocked.statusMock.mockResolvedValue({
      data: { "session-1": { type: "idle" } },
      error: null,
    });
    promptQueue.add(createIncomingPrompt("queued while running"));

    const ctx = {
      chat: { id: 777 },
      reply: vi.fn().mockResolvedValue({ message_id: 88 }),
      api: { editMessageText: vi.fn().mockResolvedValue(undefined) },
    } as unknown as Context;

    await abortCommand(ctx as never);

    expect(promptQueue.size()).toBe(0);
  });

  it("drops the pending attachment so it does not ride along on a later prompt", async () => {
    mocked.currentSession = {
      id: "session-1",
      title: "Session",
      directory: "D:\\Projects\\Repo",
    };
    mocked.abortMock.mockResolvedValue({ data: true, error: null });
    mocked.statusMock.mockResolvedValue({
      data: { "session-1": { type: "idle" } },
      error: null,
    });
    promptAttachment.set("D:\\Projects\\Repo\\src\\index.ts", "D:\\Projects\\Repo");

    const ctx = {
      chat: { id: 777 },
      reply: vi.fn().mockResolvedValue({ message_id: 88 }),
      api: { editMessageText: vi.fn().mockResolvedValue(undefined) },
    } as unknown as Context;

    await abortCommand(ctx as never);

    expect(promptAttachment.get()).toBeNull();
  });

  it("marks only Aborted session errors for suppression after user abort", async () => {
    mocked.currentSession = {
      id: "session-1",
      title: "Session",
      directory: "D:/repo",
    };
    markSessionBusy();

    mocked.abortMock.mockResolvedValue({ data: true, error: null });
    mocked.statusMock.mockResolvedValue({
      data: {
        "session-1": { type: "idle" },
      },
      error: null,
    });

    const ctx = {
      chat: { id: 777 },
      reply: vi.fn().mockResolvedValue({ message_id: 88 }),
      api: {
        editMessageText: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as Context;

    await abortCommand(ctx as never);

    expect(shouldSuppressUserAbortSessionError("session-1", "Model not found")).toBe(false);
    expect(shouldSuppressUserAbortSessionError("session-1", " Aborted ")).toBe(true);
    expect(shouldSuppressUserAbortSessionError("session-1", "Aborted")).toBe(false);
  });

  it("can abort silently without progress messages", async () => {
    activateInteractionState();

    mocked.currentSession = {
      id: "session-1",
      title: "Session",
      directory: "D:/repo",
    };
    markSessionBusy();

    mocked.abortMock.mockResolvedValue({ data: true, error: null });
    mocked.statusMock.mockResolvedValue({
      data: {
        "session-1": { type: "idle" },
      },
      error: null,
    });

    const replyMock = vi.fn().mockResolvedValue({ message_id: 88 });
    const editMessageTextMock = vi.fn().mockResolvedValue(undefined);

    const ctx = {
      chat: { id: 777 },
      reply: replyMock,
      api: {
        editMessageText: editMessageTextMock,
      },
    } as unknown as Context;

    await abortCurrentOperation(ctx as never, { notifyUser: false });

    expect(mocked.abortMock).toHaveBeenCalled();
    expect(replyMock).not.toHaveBeenCalled();
    expect(editMessageTextMock).not.toHaveBeenCalled();

    expect(questionManager.isActive()).toBe(false);
    expect(permissionManager.isActive()).toBe(false);
    expect(renameManager.isWaitingForName()).toBe(false);
    expect(interactionManager.getSnapshot()).toBeNull();
    expectAbortStateReleased("abort_confirmed");
  });

  it("releases local busy state when abort request returns an API error", async () => {
    mocked.currentSession = {
      id: "session-1",
      title: "Session",
      directory: "D:/repo",
    };
    markSessionBusy();

    mocked.abortMock.mockResolvedValue({ data: null, error: new Error("abort failed") });

    const editMessageTextMock = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      chat: { id: 777 },
      reply: vi.fn().mockResolvedValue({ message_id: 88 }),
      api: {
        editMessageText: editMessageTextMock,
      },
    } as unknown as Context;

    await abortCommand(ctx as never);

    expect(editMessageTextMock).toHaveBeenCalledWith(777, 88, t("stop.warn_unconfirmed"));
    expectAbortStateReleased("abort_unconfirmed");
  });

  it("releases local busy state when abort result is not confirmed", async () => {
    mocked.currentSession = {
      id: "session-1",
      title: "Session",
      directory: "D:/repo",
    };
    markSessionBusy();

    mocked.abortMock.mockResolvedValue({ data: false, error: null });

    const editMessageTextMock = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      chat: { id: 777 },
      reply: vi.fn().mockResolvedValue({ message_id: 88 }),
      api: {
        editMessageText: editMessageTextMock,
      },
    } as unknown as Context;

    await abortCommand(ctx as never);

    expect(editMessageTextMock).toHaveBeenCalledWith(777, 88, t("stop.warn_maybe_finished"));
    expectAbortStateReleased("abort_maybe_finished");
  });

  it("releases local busy state when abort request times out", async () => {
    mocked.currentSession = {
      id: "session-1",
      title: "Session",
      directory: "D:/repo",
    };
    markSessionBusy();

    const abortError = new Error("timeout");
    abortError.name = "AbortError";
    mocked.abortMock.mockRejectedValue(abortError);

    const editMessageTextMock = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      chat: { id: 777 },
      reply: vi.fn().mockResolvedValue({ message_id: 88 }),
      api: {
        editMessageText: editMessageTextMock,
      },
    } as unknown as Context;

    await abortCommand(ctx as never);

    expect(editMessageTextMock).toHaveBeenCalledWith(777, 88, t("stop.warn_timeout"));
    expectAbortStateReleased("abort_error");
  });

  it("releases local busy state when abort request fails locally", async () => {
    mocked.currentSession = {
      id: "session-1",
      title: "Session",
      directory: "D:/repo",
    };
    markSessionBusy();

    mocked.abortMock.mockRejectedValue(new Error("network failed"));

    const editMessageTextMock = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      chat: { id: 777 },
      reply: vi.fn().mockResolvedValue({ message_id: 88 }),
      api: {
        editMessageText: editMessageTextMock,
      },
    } as unknown as Context;

    await abortCommand(ctx as never);

    expect(editMessageTextMock).toHaveBeenCalledWith(777, 88, t("stop.warn_local_only"));
    expectAbortStateReleased("abort_error");
  });
});
