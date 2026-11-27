import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { detachCommand } from "../../../src/bot/commands/detach-command.js";
import { t } from "../../../src/i18n/index.js";
import { defined } from "../../helpers/defined.js";
import { createTestAppContainer } from "../../helpers/app-container.js";

const mocked = vi.hoisted(() => ({
  currentProject: { id: "project-1", worktree: "D:/repo" } as { id: string; worktree: string } | null,
  currentSession: null as { id: string; title: string; directory: string } | null,
  clearSessionMock: vi.fn(),
  fetchSessionTitleMock: vi.fn(),
  detachAttachedSessionMock: vi.fn(),
  clearAllInteractionStateMock: vi.fn(),
  pinnedRefreshContextLimitMock: vi.fn().mockResolvedValue(undefined),
  pinnedGetContextLimitMock: vi.fn(() => 200000),
  keyboardInitializeMock: vi.fn(),
  keyboardUpdateContextMock: vi.fn(),
  keyboardGetKeyboardMock: vi.fn(() => ({ keyboard: true })),
  foregroundMarkIdleMock: vi.fn(),
  assistantClearRunMock: vi.fn(),
  clearPromptResponseModeMock: vi.fn(),
  handOverPromptQueueMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/app/stores/settings-store.js", () => ({
  getCurrentProject: vi.fn(() => mocked.currentProject),
}));

vi.mock("../../../src/app/services/session-service.js", () => ({
  getCurrentSession: vi.fn(() => mocked.currentSession),
  clearSession: mocked.clearSessionMock,
  fetchSessionTitle: mocked.fetchSessionTitleMock,
}));

vi.mock("../../../src/app/services/attach-service.js", () => ({
  detachAttachedSession: mocked.detachAttachedSessionMock,
}));

vi.mock("../../../src/bot/handlers/prompt.js", () => ({
  clearPromptResponseMode: mocked.clearPromptResponseModeMock,
}));

vi.mock("../../../src/bot/handlers/prompt-handover.js", () => ({
  handOverPromptQueue: mocked.handOverPromptQueueMock,
}));

function createDeps() {
  return createTestAppContainer({
    resetInteractions: mocked.clearAllInteractionStateMock,
    sessionMetricsManager: {
      refreshContextLimit: mocked.pinnedRefreshContextLimitMock,
      getContextLimit: mocked.pinnedGetContextLimitMock,
    } as never,
    keyboardManager: {
      initialize: mocked.keyboardInitializeMock,
      updateContext: mocked.keyboardUpdateContextMock,
      getKeyboard: mocked.keyboardGetKeyboardMock,
    } as never,
    foregroundSessionState: { markIdle: mocked.foregroundMarkIdleMock } as never,
    assistantRunState: { clearRun: mocked.assistantClearRunMock } as never,
  });
}

function createContext(): Context {
  return {
    chat: { id: 777 },
    api: {},
    reply: vi.fn().mockResolvedValue({ message_id: 1 }),
  } as unknown as Context;
}

describe("bot/commands/detach", () => {
  beforeEach(() => {
    mocked.currentProject = { id: "project-1", worktree: "D:/repo" };
    mocked.currentSession = {
      id: "session-1",
      title: "Long Run",
      directory: "D:/repo",
    };

    mocked.clearSessionMock.mockClear();
    mocked.fetchSessionTitleMock.mockReset();
    mocked.fetchSessionTitleMock.mockImplementation(async (session: { title: string }) => session.title);
    mocked.detachAttachedSessionMock.mockClear();
    mocked.clearAllInteractionStateMock.mockClear();
    mocked.pinnedRefreshContextLimitMock.mockClear();
    mocked.pinnedRefreshContextLimitMock.mockResolvedValue(undefined);
    mocked.pinnedGetContextLimitMock.mockClear();
    mocked.pinnedGetContextLimitMock.mockReturnValue(200000);
    mocked.keyboardInitializeMock.mockClear();
    mocked.keyboardUpdateContextMock.mockClear();
    mocked.keyboardGetKeyboardMock.mockClear();
    mocked.keyboardGetKeyboardMock.mockReturnValue({ keyboard: true });
    mocked.foregroundMarkIdleMock.mockClear();
    mocked.assistantClearRunMock.mockClear();
    mocked.clearPromptResponseModeMock.mockClear();
    mocked.handOverPromptQueueMock.mockClear();
  });

  it("hands waiting messages over to the session before clearing it, so none is withdrawn", async () => {
    await detachCommand(createContext() as never, createDeps());

    expect(mocked.handOverPromptQueueMock).toHaveBeenCalledWith({
      id: "session-1",
      title: "Long Run",
      directory: "D:/repo",
    });
    expect(defined(mocked.handOverPromptQueueMock.mock.invocationCallOrder[0])).toBeLessThan(
      defined(mocked.clearSessionMock.mock.invocationCallOrder[0]),
    );
  });

  it("detaches selected session locally without stopping the OpenCode session", async () => {
    const ctx = createContext();

    await detachCommand(ctx as never, createDeps());

    expect(mocked.detachAttachedSessionMock).toHaveBeenCalledWith("detach_command", expect.anything());
    expect(mocked.clearSessionMock).toHaveBeenCalledTimes(1);
    expect(mocked.clearAllInteractionStateMock).toHaveBeenCalledWith("detach_command");
    expect(mocked.foregroundMarkIdleMock).toHaveBeenCalledWith("session-1");
    expect(mocked.assistantClearRunMock).toHaveBeenCalledWith("session-1", "detach_command");
    expect(mocked.clearPromptResponseModeMock).toHaveBeenCalledWith("session-1");
    expect(mocked.pinnedRefreshContextLimitMock).toHaveBeenCalledTimes(1);
    expect(mocked.pinnedGetContextLimitMock).toHaveBeenCalledTimes(1);
    expect(mocked.keyboardUpdateContextMock).toHaveBeenCalledWith(0, 200000);
    expect(defined(mocked.keyboardUpdateContextMock.mock.invocationCallOrder[0])).toBeLessThan(
      defined(mocked.keyboardGetKeyboardMock.mock.invocationCallOrder[0]),
    );
    expect(ctx.reply).toHaveBeenCalledWith(
      t("detach.success", { title: "Long Run" }),
      expect.objectContaining({ reply_markup: { keyboard: true } }),
    );
  });

  it("uses the same detach behavior for an idle selected session", async () => {
    mocked.currentSession = {
      id: "session-idle",
      title: "Idle Session",
      directory: "D:/repo",
    };
    const ctx = createContext();

    await detachCommand(ctx as never, createDeps());

    expect(mocked.clearSessionMock).toHaveBeenCalledTimes(1);
    expect(mocked.foregroundMarkIdleMock).toHaveBeenCalledWith("session-idle");
    expect(mocked.assistantClearRunMock).toHaveBeenCalledWith("session-idle", "detach_command");
    expect(ctx.reply).toHaveBeenCalledWith(
      t("detach.success", { title: "Idle Session" }),
      expect.any(Object),
    );
  });

  it("names the session with the title OpenCode has for it before detaching", async () => {
    mocked.currentSession = { id: "session-1", title: "", directory: "D:/repo" };
    mocked.fetchSessionTitleMock.mockResolvedValue("Generated title");
    const ctx = createContext();

    await detachCommand(ctx as never, createDeps());

    expect(mocked.fetchSessionTitleMock).toHaveBeenCalledWith({
      id: "session-1",
      title: "",
      directory: "D:/repo",
    });
    expect(defined(mocked.fetchSessionTitleMock.mock.invocationCallOrder[0])).toBeLessThan(
      defined(mocked.clearSessionMock.mock.invocationCallOrder[0]),
    );
    expect(ctx.reply).toHaveBeenCalledWith(
      t("detach.success", { title: "Generated title" }),
      expect.any(Object),
    );
  });

  it("names a session OpenCode has not named yet as a new session", async () => {
    mocked.fetchSessionTitleMock.mockResolvedValue("");
    const ctx = createContext();

    await detachCommand(ctx as never, createDeps());

    expect(ctx.reply).toHaveBeenCalledWith(
      t("detach.success", { title: t("pinned.default_session_title") }),
      expect.any(Object),
    );
  });

  it("returns a no-op message when no session is selected", async () => {
    mocked.currentSession = null;
    const ctx = createContext();

    await detachCommand(ctx as never, createDeps());

    expect(ctx.reply).toHaveBeenCalledWith(t("detach.no_active_session"));
    expect(mocked.handOverPromptQueueMock).not.toHaveBeenCalled();
    expect(mocked.detachAttachedSessionMock).not.toHaveBeenCalled();
    expect(mocked.clearSessionMock).not.toHaveBeenCalled();
  });

  it("asks to select a project when no project is selected", async () => {
    mocked.currentProject = null;
    const ctx = createContext();

    await detachCommand(ctx as never, createDeps());

    expect(ctx.reply).toHaveBeenCalledWith(t("detach.project_not_selected"));
    expect(mocked.detachAttachedSessionMock).not.toHaveBeenCalled();
    expect(mocked.clearSessionMock).not.toHaveBeenCalled();
  });
});
