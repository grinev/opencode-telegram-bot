import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { abortCommand, abortCurrentOperation } from "../../../src/bot/commands/abort-command.js";
import { clearAllInteractionState } from "../../../src/app/managers/interaction-manager.js";
import { questionManager } from "../../../src/app/managers/question-manager.js";
import { permissionManager } from "../../../src/app/managers/permission-manager.js";
import { interactionManager } from "../../../src/app/managers/interaction-manager.js";
import { foregroundSessionState } from "../../../src/app/managers/foreground-session-state-manager.js";
import type { Question } from "../../../src/app/types/question.js";
import type { PermissionRequest } from "../../../src/app/types/permission.js";
import { t } from "../../../src/i18n/index.js";
import {
  __resetUserAbortErrorSuppressionForTests,
  shouldSuppressUserAbortSessionError,
} from "../../../src/app/managers/abort-suppression-manager.js";

const mocked = vi.hoisted(() => ({
  currentSession: null as { id: string; title: string; directory: string } | null,
  abortMock: vi.fn(),
  statusMock: vi.fn(),
  clearRunMock: vi.fn(),
  markAttachedSessionIdleMock: vi.fn(),
  clearPromptResponseModeMock: vi.fn(),
}));

vi.mock("../../../src/app/services/session-service.js", () => ({
  getCurrentSession: vi.fn(() => mocked.currentSession),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      abort: mocked.abortMock,
      status: mocked.statusMock,
    },
  },
}));

vi.mock("../../../src/app/managers/assistant-run-state-manager.js", () => ({
  assistantRunState: {
    clearRun: mocked.clearRunMock,
  },
}));

vi.mock("../../../src/app/services/attach-service.js", () => ({
  markAttachedSessionIdle: mocked.markAttachedSessionIdleMock,
}));

vi.mock("../../../src/bot/handlers/prompt.js", () => ({
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
  interactionManager.start({
    kind: "custom",
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
    expect(interactionManager.getSnapshot()).toBeNull();
    expectAbortStateReleased("abort_confirmed");
    expect(shouldSuppressUserAbortSessionError("session-1", "Aborted")).toBe(true);
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
