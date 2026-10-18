import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { abortCommand, abortCurrentOperation } from "../../../src/bot/commands/abort-command.js";
import { promptQueue } from "../../../src/app/managers/prompt-queue-manager.js";
import { createIncomingPrompt } from "../../../src/app/types/prompt.js";
import { promptAttachment } from "../../../src/app/managers/prompt-attachment-manager.js";
import type { Question } from "../../../src/app/types/question.js";
import type { PermissionRequest } from "../../../src/app/types/permission.js";
import { t } from "../../../src/i18n/index.js";
import {
  __resetUserAbortErrorSuppressionForTests,
  shouldSuppressUserAbortSessionError,
} from "../../../src/app/managers/abort-suppression-manager.js";
import { createTestAppContainer } from "../../helpers/app-container.js";
import { defined } from "../../helpers/defined.js";
import type { AppContainer } from "../../../src/app/bootstrap/app-container.js";

const mocked = vi.hoisted(() => ({
  currentSession: null as { id: string; title: string; directory: string } | null,
  abortMock: vi.fn(),
  statusMock: vi.fn(),
  clearRunMock: vi.fn(),
  markAttachedSessionIdleMock: vi.fn(),
  clearPromptResponseModeMock: vi.fn(),
  inboxCancelMock: vi.fn(),
  withdrawHandedOverPromptsMock: vi.fn(),
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
  opencodeV2Client: {
    session: { inbox: { cancel: mocked.inboxCancelMock } },
  },
}));

vi.mock("../../../src/app/services/attach-service.js", () => ({
  markAttachedSessionIdle: mocked.markAttachedSessionIdleMock,
}));

vi.mock("../../../src/bot/handlers/prompt.js", () => ({
  clearPromptResponseMode: mocked.clearPromptResponseModeMock,
}));

vi.mock("../../../src/bot/handlers/prompt-handover.js", () => ({
  withdrawHandedOverPrompts: mocked.withdrawHandedOverPromptsMock,
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

function createDeps() {
  return {
    ...container,
    assistantRunState: { clearRun: mocked.clearRunMock } as never,
  };
}

function activateInteractionState(): void {
  container.questionManager.startQuestions([TEST_QUESTION], "req-abort", "session-1");
  container.interactionManager.waitPermission(TEST_PERMISSION);
}

let container: AppContainer;

beforeEach(() => {
  container = createTestAppContainer();
});

describe("bot/commands/abort", () => {
  beforeEach(() => {
    container.interactionManager.reset("test_setup");
    mocked.currentSession = null;
    mocked.abortMock.mockReset();
    mocked.statusMock.mockReset();
    mocked.clearRunMock.mockReset();
    mocked.markAttachedSessionIdleMock.mockReset();
    mocked.markAttachedSessionIdleMock.mockResolvedValue(undefined);
    mocked.clearPromptResponseModeMock.mockReset();
    mocked.withdrawHandedOverPromptsMock.mockReset().mockResolvedValue(undefined);
    __resetUserAbortErrorSuppressionForTests();
  });

  it("withdraws what /detach handed over to the session before aborting it", async () => {
    mocked.currentSession = { id: "session-1", title: "Session", directory: "D:/repo" };
    mocked.abortMock.mockResolvedValue({ data: true, error: null });
    mocked.statusMock.mockResolvedValue({ data: { "session-1": { type: "idle" } }, error: null });
    const ctx = { chat: { id: 1 }, reply: vi.fn().mockResolvedValue({ message_id: 1 }) };

    await abortCommand(ctx as never, createDeps());

    expect(mocked.withdrawHandedOverPromptsMock).toHaveBeenCalledWith("session-1", "abort_command");
    expect(
      defined(mocked.withdrawHandedOverPromptsMock.mock.invocationCallOrder[0]),
    ).toBeLessThan(defined(mocked.abortMock.mock.invocationCallOrder[0]));
  });

  it("leaves handed-over messages alone in the abort /start shares", async () => {
    mocked.currentSession = { id: "session-1", title: "Session", directory: "D:/repo" };
    mocked.abortMock.mockResolvedValue({ data: true, error: null });
    mocked.statusMock.mockResolvedValue({ data: { "session-1": { type: "idle" } }, error: null });
    const ctx = { chat: { id: 1 }, reply: vi.fn().mockResolvedValue({ message_id: 1 }) };

    await abortCurrentOperation(ctx as never, createDeps(), { notifyUser: false });

    expect(mocked.withdrawHandedOverPromptsMock).not.toHaveBeenCalled();
  });

  function markSessionBusy(): void {
    container.foregroundSessionState.markBusy("session-1", "D:/repo");
  }

  function expectAbortStateReleased(reason: string): void {
    expect(container.foregroundSessionState.isBusy()).toBe(false);
    expect(mocked.clearRunMock).toHaveBeenCalledWith("session-1", reason);
    expect(mocked.markAttachedSessionIdleMock).toHaveBeenCalledWith("session-1", expect.anything());
    expect(mocked.clearPromptResponseModeMock).toHaveBeenCalledWith("session-1");
  }

  it("clears interaction state even when there is no active session", async () => {
    activateInteractionState();

    const replyMock = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      reply: replyMock,
    } as unknown as Context;

    await abortCommand(ctx as never, createDeps());

    expect(replyMock).toHaveBeenCalledWith(t("stop.no_active_session"));
    expect(container.questionManager.isActive()).toBe(false);
    expect(container.permissionManager.isActive()).toBe(false);
    expect(container.renameManager.isWaitingForName()).toBe(false);
    expect(container.interactionManager.getSnapshot()).toBeNull();
    expect(container.interactionManager.getWaitingKind()).toBeNull();
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

    await abortCommand(ctx as never, createDeps());

    expect(replyMock).toHaveBeenCalledWith(t("stop.in_progress"));
    expect(mocked.abortMock).toHaveBeenCalled();
    expect(editMessageTextMock).toHaveBeenCalledWith(777, 88, t("stop.success"));

    expect(container.questionManager.isActive()).toBe(false);
    expect(container.permissionManager.isActive()).toBe(false);
    expect(container.renameManager.isWaitingForName()).toBe(false);
    expect(container.interactionManager.getSnapshot()).toBeNull();
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

    await abortCommand(ctx as never, createDeps());

    expect(promptQueue.size()).toBe(0);
  });

  it("withdraws prompts waiting in the OpenCode inbox before interrupting the turn", async () => {
    mocked.currentSession = {
      id: "session-1",
      title: "Session",
      directory: "D:/repo",
    };
    const order: string[] = [];
    mocked.inboxCancelMock.mockReset().mockImplementation(async () => {
      order.push("cancel");
      return { data: true, error: undefined };
    });
    mocked.abortMock.mockImplementation(async () => {
      order.push("abort");
      return { data: true, error: null };
    });
    mocked.statusMock.mockResolvedValue({
      data: { "session-1": { type: "idle" } },
      error: null,
    });
    promptQueue.confirmReservation(promptQueue.reserve()!, {
      displayText: "steered",
      inbox: { sessionId: "session-1", inboxId: "msg-1", delivery: "steer" },
    });

    const ctx = {
      chat: { id: 777 },
      reply: vi.fn().mockResolvedValue({ message_id: 88 }),
      api: { editMessageText: vi.fn().mockResolvedValue(undefined) },
    } as unknown as Context;

    await abortCommand(ctx as never, createDeps());

    expect(mocked.inboxCancelMock).toHaveBeenCalledWith({ sessionID: "session-1", inboxID: "msg-1" });
    expect(order).toEqual(["cancel", "abort"]);
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

    await abortCommand(ctx as never, createDeps());

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

    await abortCommand(ctx as never, createDeps());

    expect(shouldSuppressUserAbortSessionError("session-1", "Model not found")).toBe(false);
    expect(shouldSuppressUserAbortSessionError("session-1", " Aborted ")).toBe(true);
    expect(shouldSuppressUserAbortSessionError("session-1", "Aborted")).toBe(false);
  });

  describe("background operations and subagent cards", () => {
    function createBackgroundDeps() {
      return {
        ...createDeps(),
        countBackgroundOperations: vi.fn().mockReturnValue(0),
        interruptSubagents: vi.fn(),
      };
    }

    function createCtx(editMessageText = vi.fn().mockResolvedValue(undefined)) {
      return {
        chat: { id: 777 },
        reply: vi.fn().mockResolvedValue({ message_id: 88 }),
        api: { editMessageText },
      } as unknown as Context;
    }

    beforeEach(() => {
      mocked.currentSession = { id: "session-1", title: "Session", directory: "D:/repo" };
    });

    it("says how many background operations keep running in the success reply", async () => {
      mocked.abortMock.mockResolvedValue({ data: true, error: null });
      mocked.statusMock.mockResolvedValue({ data: { "session-1": { type: "idle" } }, error: null });
      const editMessageText = vi.fn().mockResolvedValue(undefined);
      const deps = createBackgroundDeps();
      deps.countBackgroundOperations.mockReturnValue(2);

      await abortCommand(createCtx(editMessageText) as never, deps);

      expect(deps.countBackgroundOperations).toHaveBeenCalledWith("session-1");
      expect(editMessageText).toHaveBeenCalledWith(
        777,
        88,
        t("stop.success_background_running", { count: 2 }),
      );
      expect(t("stop.success_background_running", { count: 2 })).toContain("2");
    });

    it("interrupts the subagent cards right after the success reply", async () => {
      mocked.abortMock.mockResolvedValue({ data: true, error: null });
      mocked.statusMock.mockResolvedValue({ data: { "session-1": { type: "idle" } }, error: null });
      const editMessageText = vi.fn().mockResolvedValue(undefined);
      const deps = createBackgroundDeps();

      await abortCommand(createCtx(editMessageText) as never, deps);

      expect(editMessageText).toHaveBeenCalledWith(777, 88, t("stop.success"));
      expect(deps.interruptSubagents).toHaveBeenCalledWith("abort_command");
      expect(defined(editMessageText.mock.invocationCallOrder[0])).toBeLessThan(
        defined(deps.interruptSubagents.mock.invocationCallOrder[0]),
      );
    });

    it("interrupts the subagent cards even when the success reply cannot be shown", async () => {
      mocked.abortMock.mockResolvedValue({ data: true, error: null });
      mocked.statusMock.mockResolvedValue({ data: { "session-1": { type: "idle" } }, error: null });
      const editMessageText = vi.fn().mockRejectedValue(new Error("Too Many Requests: 429"));
      const deps = createBackgroundDeps();

      await abortCommand(createCtx(editMessageText) as never, deps);

      expect(deps.interruptSubagents).toHaveBeenCalledWith("abort_command");
    });

    it("interrupts the subagent cards in the silent abort /start shares", async () => {
      mocked.abortMock.mockResolvedValue({ data: true, error: null });
      mocked.statusMock.mockResolvedValue({ data: { "session-1": { type: "idle" } }, error: null });
      const deps = createBackgroundDeps();

      await abortCurrentOperation(createCtx() as never, deps, { notifyUser: false });

      expect(deps.interruptSubagents).toHaveBeenCalledWith("abort_command");
      expect(deps.countBackgroundOperations).not.toHaveBeenCalled();
    });

    it.each([
      ["an API error", () => mocked.abortMock.mockResolvedValue({ data: null, error: new Error("x") })],
      ["an unconfirmed result", () => mocked.abortMock.mockResolvedValue({ data: false, error: null })],
      [
        "a session still busy",
        () => {
          mocked.abortMock.mockResolvedValue({ data: true, error: null });
          mocked.statusMock.mockResolvedValue({
            data: { "session-1": { type: "busy" } },
            error: null,
          });
        },
      ],
      ["a local failure", () => mocked.abortMock.mockRejectedValue(new Error("network failed"))],
    ])("neither interrupts cards nor counts operations on %s", async (_case, arrange) => {
      vi.useFakeTimers();
      try {
        arrange();
        const deps = createBackgroundDeps();

        const aborting = abortCommand(createCtx() as never, deps);
        await vi.advanceTimersByTimeAsync(6_000);
        await aborting;

        expect(deps.interruptSubagents).not.toHaveBeenCalled();
        expect(deps.countBackgroundOperations).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
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

    await abortCurrentOperation(ctx as never, createDeps(), { notifyUser: false });

    expect(mocked.abortMock).toHaveBeenCalled();
    expect(replyMock).not.toHaveBeenCalled();
    expect(editMessageTextMock).not.toHaveBeenCalled();

    expect(container.questionManager.isActive()).toBe(false);
    expect(container.permissionManager.isActive()).toBe(false);
    expect(container.renameManager.isWaitingForName()).toBe(false);
    expect(container.interactionManager.getSnapshot()).toBeNull();
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

    await abortCommand(ctx as never, createDeps());

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

    await abortCommand(ctx as never, createDeps());

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

    await abortCommand(ctx as never, createDeps());

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

    await abortCommand(ctx as never, createDeps());

    expect(editMessageTextMock).toHaveBeenCalledWith(777, 88, t("stop.warn_local_only"));
    expectAbortStateReleased("abort_error");
  });
});
