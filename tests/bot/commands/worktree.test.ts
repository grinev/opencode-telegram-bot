import { afterEach, beforeEach, describe, expect, it, vi } from "#vitest";
import type { Context } from "grammy";
import { loadSut } from "#helpers/sut-loader.js";
import { createSettingsStoreMock } from "#helpers/settings-store-mock.js";
const { t } = await loadSut<typeof import("#src/i18n/index.js")>(
  "#src/i18n/index.ts",
  import.meta.url,
);

const mocked = vi.hoisted(() => ({
  currentProject: { id: "project-1", worktree: "/repo", name: "Repo" } as {
    id: string;
    worktree: string;
    name?: string;
  } | null,
  getGitWorktreeContextMock: vi.fn(),
  replyWithInlineMenuMock: vi.fn(),
  ensureActiveInlineMenuMock: vi.fn().mockResolvedValue(true),
  isForegroundBusyMock: vi.fn(() => false),
  replyBusyBlockedMock: vi.fn().mockResolvedValue(undefined),
  upsertSessionDirectoryMock: vi.fn().mockResolvedValue(undefined),
  getProjectByWorktreeMock: vi.fn(),
  switchToProjectMock: vi.fn().mockResolvedValue({ inline_keyboard: [] }),
  clearAllInteractionStateMock: vi.fn(),
}));

const settingsStoreMock = createSettingsStoreMock();
settingsStoreMock.getCurrentProject = vi.fn(() => mocked.currentProject);
vi.mock("#src/app/stores/settings-store.ts", () => settingsStoreMock);

vi.mock("#src/app/services/worktree-service.ts", () => ({
  getGitWorktreeContext: mocked.getGitWorktreeContextMock,
}));

vi.mock("#src/bot/menus/inline-menu.ts", () => ({
  appendInlineMenuCancelButton: vi.fn((keyboard: unknown) => keyboard),
  ensureActiveInlineMenu: mocked.ensureActiveInlineMenuMock,
  replyWithInlineMenu: mocked.replyWithInlineMenuMock,
}));

vi.mock("#src/app/services/run-control-service.ts", () => ({
  isForegroundBusy: mocked.isForegroundBusyMock,
}));

vi.mock("#src/bot/messages/busy-blocked-renderer.ts", () => ({
  replyBusyBlocked: mocked.replyBusyBlockedMock,
}));

vi.mock("#src/app/services/session-cache-service.ts", () => ({
  upsertSessionDirectory: mocked.upsertSessionDirectoryMock,
  __resetSessionDirectoryCacheForTests: vi.fn(),
  warmupSessionDirectoryCache: vi.fn().mockResolvedValue(undefined),
  syncSessionDirectoryCache: vi.fn().mockResolvedValue(undefined),
  getCachedSessionDirectories: vi.fn().mockResolvedValue([]),
  getCachedSessionProjects: vi.fn().mockResolvedValue([]),
  ingestSessionInfoForCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("#src/app/services/project-service.ts", () => ({
  getProjectByWorktree: mocked.getProjectByWorktreeMock,
  getProjects: vi.fn().mockResolvedValue([]),
  getProjectById: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("#src/app/services/project-switch-service.ts", () => ({
  switchToProject: mocked.switchToProjectMock,
}));

vi.mock("#src/app/managers/interaction-manager.ts", () => ({
  interactionManager: { clear: vi.fn() },
  clearAllInteractionState: mocked.clearAllInteractionStateMock,
}));

vi.mock("#src/utils/logger.ts", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { worktreeCommand } = await loadSut<typeof import("#src/bot/commands/worktree-command.js")>(
  "#src/bot/commands/worktree-command.ts",
  import.meta.url,
);
const { handleWorktreeCallback } = await loadSut<typeof import("#src/bot/callbacks/worktree-callback-handler.js")>(
  "#src/bot/callbacks/worktree-callback-handler.ts",
  import.meta.url,
);

function createCommandContext(): Context {
  return {
    chat: { id: 123 },
    reply: vi.fn().mockResolvedValue({ message_id: 42 }),
  } as unknown as Context;
}

function createCallbackContext(data: string, messageId: number = 42): Context {
  return {
    chat: { id: 123 },
    callbackQuery: {
      data,
      message: { message_id: messageId },
    } as Context["callbackQuery"],
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    api: {},
  } as unknown as Context;
}

describe("bot/commands/worktree", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    mocked.currentProject = { id: "project-1", worktree: "/repo", name: "Repo" };
    mocked.getGitWorktreeContextMock.mockReset();
    mocked.replyWithInlineMenuMock.mockReset();
    mocked.ensureActiveInlineMenuMock.mockReset().mockResolvedValue(true);
    mocked.isForegroundBusyMock.mockReset().mockReturnValue(false);
    mocked.replyBusyBlockedMock.mockReset().mockResolvedValue(undefined);
    mocked.upsertSessionDirectoryMock.mockReset().mockResolvedValue(undefined);
    mocked.getProjectByWorktreeMock.mockReset().mockResolvedValue({
      id: "project-2",
      worktree: "/repo-feature",
      name: "/repo-feature",
    });
    mocked.switchToProjectMock.mockReset().mockResolvedValue({ inline_keyboard: [] });
    mocked.clearAllInteractionStateMock.mockReset();
  });

  it("warns instead of loading git worktrees when running in a container", async () => {
    vi.stubEnv("OPENCODE_TELEGRAM_CONTAINER", "1");
    const ctx = createCommandContext();
    await worktreeCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith(t("runtime.container.command_unavailable"));
    expect(mocked.getGitWorktreeContextMock).not.toHaveBeenCalled();
  });

  it("asks to select a project first when no project is active", async () => {
    mocked.currentProject = null;

    const ctx = createCommandContext();
    await worktreeCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith(t("worktree.project_not_selected"));
    expect(mocked.replyWithInlineMenuMock).not.toHaveBeenCalled();
  });

  it("shows an inline worktree menu for the current repository", async () => {
    mocked.getGitWorktreeContextMock.mockResolvedValue({
      mainProjectPath: "/repo",
      activeWorktreePath: "/repo",
      branch: "main",
      isLinkedWorktree: false,
      worktrees: [
        { path: "/repo", branch: "main", isCurrent: true, isMain: true },
        { path: "/repo-feature", branch: "feature/chat", isCurrent: false, isMain: false },
      ],
    });

    const ctx = createCommandContext();
    await worktreeCommand(ctx as never);

    expect(mocked.replyWithInlineMenuMock).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        menuKind: "worktree",
        text: t("worktree.select_with_current"),
      }),
    );

    const keyboard = mocked.replyWithInlineMenuMock.mock.calls[0]?.[1]?.keyboard as {
      inline_keyboard: Array<Array<{ text: string }>>;
    };
    expect(keyboard.inline_keyboard[0]?.[0]?.text).toContain("1. repo [/repo]");
    expect(keyboard.inline_keyboard[1]?.[0]?.text).toContain("2. repo-feature [/repo-feature]");
  });

  it("switches to a selected linked worktree and resets the session", async () => {
    mocked.getGitWorktreeContextMock.mockResolvedValue({
      mainProjectPath: "/repo",
      activeWorktreePath: "/repo",
      branch: "main",
      isLinkedWorktree: false,
      worktrees: [
        { path: "/repo", branch: "main", isCurrent: true, isMain: true },
        { path: "/repo-feature", branch: "feature/chat", isCurrent: false, isMain: false },
      ],
    });

    const ctx = createCallbackContext("worktree:1");
    const handled = await handleWorktreeCallback(ctx);

    expect(handled).toBe(true);
    expect(mocked.upsertSessionDirectoryMock).toHaveBeenCalledWith(
      "/repo-feature",
      expect.any(Number),
    );
    expect(mocked.getProjectByWorktreeMock).toHaveBeenCalledWith("/repo-feature");
    expect(mocked.switchToProjectMock).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ worktree: "/repo-feature" }),
      "worktree_switched",
      expect.objectContaining({ presentation: expect.any(Object) }),
    );
    expect(ctx.reply).toHaveBeenCalledWith(t("worktree.selected", { worktree: "/repo-feature" }), {
      reply_markup: { inline_keyboard: [] },
    });
    expect(ctx.deleteMessage).toHaveBeenCalled();
  });

  it("acknowledges when the selected worktree is already active", async () => {
    mocked.getGitWorktreeContextMock.mockResolvedValue({
      mainProjectPath: "/repo",
      activeWorktreePath: "/repo",
      branch: "main",
      isLinkedWorktree: false,
      worktrees: [
        { path: "/repo", branch: "main", isCurrent: true, isMain: true },
        { path: "/repo-feature", branch: "feature/chat", isCurrent: false, isMain: false },
      ],
    });

    const ctx = createCallbackContext("worktree:0");
    const handled = await handleWorktreeCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("worktree.already_selected_callback"),
      show_alert: true,
    });
    expect(mocked.switchToProjectMock).not.toHaveBeenCalled();
  });
});
