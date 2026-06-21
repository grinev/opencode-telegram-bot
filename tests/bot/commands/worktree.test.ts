import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  currentProject: { id: "project-1", worktree: "/repo", name: "Repo" } as {
    id: string;
    worktree: string;
    name?: string;
  } | null,
  getGitWorktreeContextMock: vi.fn(),
  createGitWorktreeMock: vi.fn(),
  isForegroundBusyMock: vi.fn(() => false),
  replyBusyBlockedMock: vi.fn().mockResolvedValue(undefined),
  upsertSessionDirectoryMock: vi.fn().mockResolvedValue(undefined),
  getProjectByWorktreeMock: vi.fn(),
  switchToProjectMock: vi.fn().mockResolvedValue({ inline_keyboard: [] }),
}));

vi.mock("../../../src/app/stores/settings-store.js", () => ({
  getCurrentProject: vi.fn(() => mocked.currentProject),
}));

vi.mock("../../../src/app/services/worktree-service.js", () => ({
  getGitWorktreeContext: mocked.getGitWorktreeContextMock,
  createGitWorktree: mocked.createGitWorktreeMock,
}));

vi.mock("../../../src/app/services/run-control-service.js", () => ({
  isForegroundBusy: mocked.isForegroundBusyMock,
}));

vi.mock("../../../src/bot/messages/busy-blocked-renderer.js", () => ({
  replyBusyBlocked: mocked.replyBusyBlockedMock,
}));

vi.mock("../../../src/app/services/session-cache-service.js", () => ({
  upsertSessionDirectory: mocked.upsertSessionDirectoryMock,
  __resetSessionDirectoryCacheForTests: vi.fn(),
}));

vi.mock("../../../src/app/services/project-service.js", () => ({
  getProjectByWorktree: mocked.getProjectByWorktreeMock,
}));

vi.mock("../../../src/app/services/project-switch-service.js", () => ({
  switchToProject: mocked.switchToProjectMock,
}));

vi.mock("../../../src/bot/services/project-switch-presentation.js", () => ({
  createProjectSwitchPresentation: vi.fn(() => ({})),
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../../src/bot/menus/worktree-selection-menu.js", () => ({
  buildWorktreeMenuView: vi.fn(() => ({
    text: "Select a worktree:",
    keyboard: { inline_keyboard: [] },
  })),
}));

vi.mock("../../../src/bot/menus/inline-menu.js", () => ({
  replyWithInlineMenu: vi.fn().mockResolvedValue(100),
  appendInlineMenuCancelButton: vi.fn((k) => k),
  ensureActiveInlineMenu: vi.fn(),
}));

import { worktreeCommand } from "../../../src/bot/commands/worktree-command.js";

function createCommandContext(match: string = ""): Context {
  return {
    match,
    chat: { id: 123 },
    reply: vi.fn().mockResolvedValue({ message_id: 42 }),
    api: {
      editMessageText: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as Context;
}

describe("bot/commands/worktree", () => {
  beforeEach(() => {
    mocked.currentProject = { id: "project-1", worktree: "/repo", name: "Repo" };
    mocked.getGitWorktreeContextMock.mockReset();
    mocked.createGitWorktreeMock.mockReset();
    mocked.isForegroundBusyMock.mockReset().mockReturnValue(false);
    mocked.replyBusyBlockedMock.mockReset().mockResolvedValue(undefined);
    mocked.upsertSessionDirectoryMock.mockReset().mockResolvedValue(undefined);
    mocked.getProjectByWorktreeMock.mockReset().mockResolvedValue({
      id: "project-2",
      worktree: "/repo-feature",
      name: "/repo-feature",
    });
    mocked.switchToProjectMock.mockReset().mockResolvedValue({ inline_keyboard: [] });
  });

  describe("help subcommand", () => {
    it("shows help when no subcommand is given", async () => {
      const ctx = createCommandContext("");
      await worktreeCommand(ctx as never);

      const replyText = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(replyText).toContain("Worktree Manager");
      expect(replyText).toContain("/worktree add");
      expect(replyText).toContain("/worktree list");
      expect(replyText).toContain("/worktree switch");
    });

    it("shows help for help subcommand", async () => {
      const ctx = createCommandContext("help");
      await worktreeCommand(ctx as never);

      const replyText = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(replyText).toContain("Worktree Manager");
    });
  });

  describe("add subcommand", () => {
    it("creates a worktree and shows success", async () => {
      mocked.createGitWorktreeMock.mockResolvedValue({
        path: "/repo/new-worktree",
        apiBranch: "opencode/new-worktree",
      });

      const ctx = createCommandContext("add my-worktree");
      await worktreeCommand(ctx as never);

      expect(mocked.createGitWorktreeMock).toHaveBeenCalledWith("my-worktree");
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("Worktree created successfully"),
      );
      const replyText = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(replyText).toContain("/repo/new-worktree");
      expect(replyText).toContain("opencode/new-worktree");
    });

    it("shows error when creation fails", async () => {
      mocked.createGitWorktreeMock.mockResolvedValue({
        path: "",
        error: "API error",
      });

      const ctx = createCommandContext("add my-worktree");
      await worktreeCommand(ctx as never);

      expect(ctx.reply).toHaveBeenCalledWith(
        t("worktree_add.error", { error: "API error" }),
      );
    });
  });

  describe("list subcommand", () => {
    it("shows project_not_selected when no project", async () => {
      mocked.currentProject = null;

      const ctx = createCommandContext("list");
      await worktreeCommand(ctx as never);

      expect(ctx.reply).toHaveBeenCalledWith(t("worktree.project_not_selected"));
    });

    it("shows not_git_repo when context is missing", async () => {
      mocked.getGitWorktreeContextMock.mockResolvedValue(null);

      const ctx = createCommandContext("list");
      await worktreeCommand(ctx as never);

      expect(ctx.reply).toHaveBeenCalledWith(t("worktree.not_git_repo"));
    });

    it("shows empty message when no worktrees", async () => {
      mocked.getGitWorktreeContextMock.mockResolvedValue({
        mainProjectPath: "/repo",
        activeWorktreePath: "/repo",
        branch: "main",
        isLinkedWorktree: false,
        worktrees: [],
      });

      const ctx = createCommandContext("list");
      await worktreeCommand(ctx as never);

      expect(ctx.reply).toHaveBeenCalledWith(t("worktree.empty"));
    });

    it("lists worktrees with markers", async () => {
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

      const ctx = createCommandContext("list");
      await worktreeCommand(ctx as never);

      const replyText = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(replyText).toContain("/repo");
      expect(replyText).toContain("/repo-feature");
      expect(replyText).toContain("main");
      expect(replyText).toContain("feature/chat");
    });
  });

  describe("switch subcommand", () => {
    beforeEach(() => {
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
    });

    it("shows inline menu when no name provided", async () => {
      const { buildWorktreeMenuView } = await import(
        "../../../src/bot/menus/worktree-selection-menu.js"
      );
      const { replyWithInlineMenu } = await import(
        "../../../src/bot/menus/inline-menu.js"
      );

      const ctx = createCommandContext("switch");
      await worktreeCommand(ctx as never);

      expect(buildWorktreeMenuView).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ path: "/repo-feature" })]),
        0,
      );
      expect(replyWithInlineMenu).toHaveBeenCalledWith(ctx, {
        menuKind: "worktree",
        text: "Select a worktree:",
        keyboard: { inline_keyboard: [] },
      });
    });

    it("shows empty message when switch with no name and no worktrees", async () => {
      mocked.getGitWorktreeContextMock.mockResolvedValue({
        mainProjectPath: "/repo",
        activeWorktreePath: "/repo",
        branch: "main",
        isLinkedWorktree: false,
        worktrees: [],
      });

      const ctx = createCommandContext("switch");
      await worktreeCommand(ctx as never);

      expect(ctx.reply).toHaveBeenCalledWith(t("worktree.empty"));
    });

    it("switches to a worktree by path", async () => {
      const ctx = createCommandContext("switch /repo-feature");
      await worktreeCommand(ctx as never);

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
    });

    it("switches to a worktree by basename", async () => {
      const ctx = createCommandContext("switch repo-feature");
      await worktreeCommand(ctx as never);

      expect(mocked.upsertSessionDirectoryMock).toHaveBeenCalledWith(
        "/repo-feature",
        expect.any(Number),
      );
    });

    it("switches to a worktree by branch name", async () => {
      const ctx = createCommandContext("switch feature/chat");
      await worktreeCommand(ctx as never);

      expect(mocked.upsertSessionDirectoryMock).toHaveBeenCalledWith(
        "/repo-feature",
        expect.any(Number),
      );
    });

    it("reports when worktree is already current", async () => {
      const ctx = createCommandContext("switch /repo");
      await worktreeCommand(ctx as never);

      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Already on worktree"));
    });

    it("shows not_found when worktree does not match", async () => {
      const ctx = createCommandContext("switch nonexistent");
      await worktreeCommand(ctx as never);

      const replyText = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(replyText).toContain('Worktree "nonexistent" not found');
    });
  });

  describe("delete subcommand", () => {
    it("shows not implemented", async () => {
      const ctx = createCommandContext("delete");
      await worktreeCommand(ctx as never);

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("not implemented yet"),
      );
    });
  });

  describe("unknown subcommand", () => {
    it("shows error for unknown subcommand", async () => {
      const ctx = createCommandContext("unknown");
      await worktreeCommand(ctx as never);

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Unknown subcommand: "unknown"'),
      );
    });
  });

  describe("busy guard", () => {
    it("blocks when foreground is busy", async () => {
      mocked.isForegroundBusyMock.mockReturnValue(true);

      const ctx = createCommandContext("list");
      await worktreeCommand(ctx as never);

      expect(mocked.replyBusyBlockedMock).toHaveBeenCalled();
    });
  });
});
