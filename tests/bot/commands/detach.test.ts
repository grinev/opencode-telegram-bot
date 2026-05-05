import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { detachCommand } from "../../../src/bot/commands/detach.js";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  currentProject: { id: "project-1", worktree: "D:/repo" } as { id: string; worktree: string } | null,
  currentSession: null as { id: string; title: string; directory: string } | null,
  clearSessionMock: vi.fn(),
  detachAttachedSessionMock: vi.fn(),
  clearAllInteractionStateMock: vi.fn(),
  pinnedIsInitializedMock: vi.fn(() => true),
  pinnedClearMock: vi.fn().mockResolvedValue(undefined),
  pinnedRefreshContextLimitMock: vi.fn().mockResolvedValue(undefined),
  pinnedGetContextLimitMock: vi.fn(() => 200000),
  keyboardInitializeMock: vi.fn(),
  keyboardUpdateContextMock: vi.fn(),
  keyboardGetKeyboardMock: vi.fn(() => ({ keyboard: true })),
  foregroundMarkIdleMock: vi.fn(),
  assistantClearRunMock: vi.fn(),
  clearPromptResponseModeMock: vi.fn(),
}));

vi.mock("../../../src/settings/manager.js", () => ({
  getCurrentProject: vi.fn(() => mocked.currentProject),
}));

vi.mock("../../../src/session/manager.js", () => ({
  getCurrentSession: vi.fn(() => mocked.currentSession),
  clearSession: mocked.clearSessionMock,
}));

vi.mock("../../../src/attach/service.js", () => ({
  detachAttachedSession: mocked.detachAttachedSessionMock,
}));

vi.mock("../../../src/interaction/cleanup.js", () => ({
  clearAllInteractionState: mocked.clearAllInteractionStateMock,
}));

vi.mock("../../../src/pinned/manager.js", () => ({
  pinnedMessageManager: {
    isInitialized: mocked.pinnedIsInitializedMock,
    clear: mocked.pinnedClearMock,
    refreshContextLimit: mocked.pinnedRefreshContextLimitMock,
    getContextLimit: mocked.pinnedGetContextLimitMock,
  },
}));

vi.mock("../../../src/keyboard/manager.js", () => ({
  keyboardManager: {
    initialize: mocked.keyboardInitializeMock,
    updateContext: mocked.keyboardUpdateContextMock,
    getKeyboard: mocked.keyboardGetKeyboardMock,
  },
}));

vi.mock("../../../src/scheduled-task/foreground-state.js", () => ({
  foregroundSessionState: {
    markIdle: mocked.foregroundMarkIdleMock,
  },
}));

vi.mock("../../../src/bot/assistant-run-state.js", () => ({
  assistantRunState: {
    clearRun: mocked.assistantClearRunMock,
  },
}));

vi.mock("../../../src/bot/handlers/prompt.js", () => ({
  clearPromptResponseMode: mocked.clearPromptResponseModeMock,
}));

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
    mocked.detachAttachedSessionMock.mockClear();
    mocked.clearAllInteractionStateMock.mockClear();
    mocked.pinnedIsInitializedMock.mockClear();
    mocked.pinnedIsInitializedMock.mockReturnValue(true);
    mocked.pinnedClearMock.mockClear();
    mocked.pinnedClearMock.mockResolvedValue(undefined);
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
  });

  it("detaches selected session locally without stopping the OpenCode session", async () => {
    const ctx = createContext();

    await detachCommand(ctx as never);

    expect(mocked.detachAttachedSessionMock).toHaveBeenCalledWith("detach_command");
    expect(mocked.clearSessionMock).toHaveBeenCalledTimes(1);
    expect(mocked.clearAllInteractionStateMock).toHaveBeenCalledWith("detach_command");
    expect(mocked.foregroundMarkIdleMock).toHaveBeenCalledWith("session-1");
    expect(mocked.assistantClearRunMock).toHaveBeenCalledWith("session-1", "detach_command");
    expect(mocked.clearPromptResponseModeMock).toHaveBeenCalledWith("session-1");
    expect(mocked.pinnedClearMock).toHaveBeenCalledTimes(1);
    expect(mocked.pinnedRefreshContextLimitMock).toHaveBeenCalledTimes(1);
    expect(mocked.pinnedGetContextLimitMock).toHaveBeenCalledTimes(1);
    expect(mocked.keyboardUpdateContextMock).toHaveBeenCalledWith(0, 200000);
    expect(mocked.keyboardUpdateContextMock.mock.invocationCallOrder[0]).toBeLessThan(
      mocked.keyboardGetKeyboardMock.mock.invocationCallOrder[0],
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

    await detachCommand(ctx as never);

    expect(mocked.clearSessionMock).toHaveBeenCalledTimes(1);
    expect(mocked.foregroundMarkIdleMock).toHaveBeenCalledWith("session-idle");
    expect(mocked.assistantClearRunMock).toHaveBeenCalledWith("session-idle", "detach_command");
    expect(ctx.reply).toHaveBeenCalledWith(
      t("detach.success", { title: "Idle Session" }),
      expect.any(Object),
    );
  });

  it("returns a no-op message when no session is selected", async () => {
    mocked.currentSession = null;
    const ctx = createContext();

    await detachCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith(t("detach.no_active_session"));
    expect(mocked.detachAttachedSessionMock).not.toHaveBeenCalled();
    expect(mocked.clearSessionMock).not.toHaveBeenCalled();
  });

  it("asks to select a project when no project is selected", async () => {
    mocked.currentProject = null;
    const ctx = createContext();

    await detachCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith(t("detach.project_not_selected"));
    expect(mocked.detachAttachedSessionMock).not.toHaveBeenCalled();
    expect(mocked.clearSessionMock).not.toHaveBeenCalled();
  });
});
