import { beforeEach, describe, expect, it, vi } from "#vitest";
import type { Context } from "grammy";
import { defined } from "#helpers/defined.js";

import { loadSut } from "#helpers/sut-loader.js";
const mocked = {
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
};

vi.mock("#src/app/stores/settings-store.ts", () => {
  const fns = [
    "getCurrentProject",
    "setCurrentProject",
    "clearProject",
    "getCurrentSession",
    "setCurrentSession",
    "clearSession",
    "getTtsMode",
    "setTtsMode",
    "getCurrentAgent",
    "setCurrentAgent",
    "clearCurrentAgent",
    "getCurrentModel",
    "setCurrentModel",
    "clearCurrentModel",
    "getPinnedMessageId",
    "setPinnedMessageId",
    "clearPinnedMessageId",
    "getSessionDirectoryCache",
    "setSessionDirectoryCache",
    "clearSessionDirectoryCache",
    "getScheduledTasks",
    "setScheduledTasks",
    "getScheduledTaskSessionIgnores",
    "setScheduledTaskSessionIgnores",
    "getVisibleProjects",
    "setVisibleProjects",
    "flushSettings",
    "getPromptQueueEnabled",
    "setPromptQueueEnabled",
    "__resetSettingsForTests",
    "loadSettings",
  ];
  const obj: Record<string, unknown> = {};
  for (const name of fns) obj[name] = vi.fn();
  obj.getCurrentProject = vi.fn(() => mocked.currentProject);
  obj.getCurrentSession = vi.fn(() => mocked.currentSession);
  obj.clearSession = mocked.clearSessionMock;
  return obj;
});

vi.mock("#src/app/services/attach-service.ts", () => ({
  detachAttachedSession: mocked.detachAttachedSessionMock,
  configureAttachPresentation: vi.fn(),
  attachToSession: vi.fn().mockResolvedValue(undefined),
  restoreAttachedCurrentSession: vi.fn().mockResolvedValue(undefined),
  markAttachedSessionBusy: vi.fn().mockResolvedValue(undefined),
  markAttachedSessionIdle: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("#src/app/managers/interaction-manager.ts", () => ({
  interactionManager: { clear: vi.fn() },
  clearAllInteractionState: mocked.clearAllInteractionStateMock,
  questionManager: { clear: vi.fn(), startQuestions: vi.fn(), isActive: vi.fn(() => false) },
  permissionManager: { clear: vi.fn(), startPermission: vi.fn(), isActive: vi.fn(() => false) },
  renameManager: { clear: vi.fn(), startWaiting: vi.fn(), isWaitingForName: vi.fn(() => false) },
  getSnapshot: vi.fn(),
}));

vi.mock("#src/bot/pinned/pinned-message-manager.ts", () => ({
  pinnedMessageManager: {
    isInitialized: mocked.pinnedIsInitializedMock,
    clear: mocked.pinnedClearMock,
    refreshContextLimit: mocked.pinnedRefreshContextLimitMock,
    getContextLimit: mocked.pinnedGetContextLimitMock,
  },
}));

vi.mock("#src/bot/keyboards/keyboard-manager.ts", () => ({
  keyboardManager: {
    initialize: mocked.keyboardInitializeMock,
    updateContext: mocked.keyboardUpdateContextMock,
    getKeyboard: mocked.keyboardGetKeyboardMock,
  },
}));

vi.mock("#src/app/managers/foreground-session-state-manager.ts", () => ({
  foregroundSessionState: {
    markIdle: mocked.foregroundMarkIdleMock,
    isBusy: vi.fn(() => false),
    markBusy: vi.fn(),
    __resetForTests: vi.fn(),
  },
}));

vi.mock("#src/app/managers/assistant-run-state-manager.ts", () => ({
  assistantRunState: {
    clearRun: mocked.assistantClearRunMock,
  },
}));

vi.mock("#src/bot/handlers/prompt.ts", () => ({
  clearPromptResponseMode: mocked.clearPromptResponseModeMock,
  getPromptBotInstance: vi.fn(),
  getPromptChatId: vi.fn(),
  setPromptResponseMode: vi.fn(),
  consumePromptResponseMode: vi.fn(),
  processUserPrompt: vi.fn().mockResolvedValue(undefined),
}));

const sut = await loadSut<typeof import("#src/bot/commands/detach-command.js")>(
  "#src/bot/commands/detach-command.ts",
  import.meta.url,
);

const { t } = await loadSut<typeof import("#src/i18n/index.js")>(
  "#src/i18n/index.ts",
  import.meta.url,
);

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
    mocked.currentSession = null;
    mocked.clearSessionMock.mockReset();
    mocked.detachAttachedSessionMock.mockReset();
    mocked.clearAllInteractionStateMock.mockReset();
    mocked.pinnedIsInitializedMock.mockReset();
    mocked.pinnedIsInitializedMock.mockReturnValue(true);
    mocked.pinnedClearMock.mockReset();
    mocked.pinnedClearMock.mockResolvedValue(undefined);
    mocked.pinnedRefreshContextLimitMock.mockReset();
    mocked.pinnedRefreshContextLimitMock.mockResolvedValue(undefined);
    mocked.pinnedGetContextLimitMock.mockReset();
    mocked.pinnedGetContextLimitMock.mockReturnValue(200000);
    mocked.keyboardInitializeMock.mockReset();
    mocked.keyboardUpdateContextMock.mockReset();
    mocked.keyboardGetKeyboardMock.mockReset();
    mocked.keyboardGetKeyboardMock.mockReturnValue({ keyboard: true });
    mocked.foregroundMarkIdleMock.mockReset();
    mocked.assistantClearRunMock.mockReset();
    mocked.clearPromptResponseModeMock.mockReset();
  });

  it("detaches the active session and clears UI state", async () => {
    mocked.currentSession = { id: "session-1", title: "Long Run", directory: "D:/repo" };

    const ctx = createContext();
    await sut.detachCommand(ctx as never);

    expect(mocked.detachAttachedSessionMock).toHaveBeenCalledWith("detach_command");
    expect(mocked.clearSessionMock).toHaveBeenCalledWith();
    expect(mocked.foregroundMarkIdleMock).toHaveBeenCalledWith("session-1");
    expect(mocked.assistantClearRunMock).toHaveBeenCalledWith("session-1", "detach_command");
    expect(mocked.clearPromptResponseModeMock).toHaveBeenCalledWith("session-1");
    expect(mocked.clearAllInteractionStateMock).toHaveBeenCalledWith("detach_command");
    expect(mocked.pinnedClearMock).toHaveBeenCalled();
    expect(mocked.keyboardUpdateContextMock).toHaveBeenCalledWith(0, 200000);
    expect(defined(mocked.keyboardUpdateContextMock.mock.invocationCallOrder[0])).toBeLessThan(
      defined(mocked.keyboardGetKeyboardMock.mock.invocationCallOrder[0]),
    );
    expect(ctx.reply).toHaveBeenCalledWith(
      t("detach.success", { title: "Long Run" }),
      expect.objectContaining({ reply_markup: { keyboard: true } }),
    );
  });

  it("replies with a not-attached message when no session is active", async () => {
    const ctx = createContext();
    await sut.detachCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith(t("detach.no_active_session"));
    expect(mocked.detachAttachedSessionMock).not.toHaveBeenCalled();
  });
});
