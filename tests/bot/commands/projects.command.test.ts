import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { projectsCommand } from "../../../src/bot/commands/projects-command.js";
import { t } from "../../../src/i18n/index.js";
import { createTestAppContainer } from "../../helpers/app-container.js";
import type { AppContainer } from "../../../src/app/bootstrap/app-container.js";
import {
  buildProjectSearchView,
  filterProjectsForSearch,
} from "../../../src/bot/menus/project-selection-menu.js";

const mocked = vi.hoisted(() => ({
  currentProject: null as { id: string; worktree: string; name?: string } | null,
  syncSessionDirectoryCacheMock: vi.fn(),
  getProjectsMock: vi.fn(),
  getGitWorktreeContextMock: vi.fn(),
  replyWithInlineMenuMock: vi.fn(),
}));

vi.mock("../../../src/app/services/session-cache-service.js", () => ({
  syncSessionDirectoryCache: mocked.syncSessionDirectoryCacheMock,
  __resetSessionDirectoryCacheForTests: vi.fn(),
}));

vi.mock("../../../src/app/services/project-service.js", () => ({
  getProjects: mocked.getProjectsMock,
  getListedProjects: mocked.getProjectsMock,
}));

vi.mock("../../../src/app/services/worktree-service.js", () => ({
  getGitWorktreeContext: mocked.getGitWorktreeContextMock,
}));

vi.mock("../../../src/app/stores/settings-store.js", () => ({
  getCurrentProject: vi.fn(() => mocked.currentProject),
  setCurrentProject: vi.fn(),
}));

vi.mock("../../../src/app/services/session-service.js", () => ({
  clearSession: vi.fn(),
}));

vi.mock("../../../src/app/services/agent-selection-service.js", () => ({
  getStoredAgent: vi.fn(() => "build"),
}));

vi.mock("../../../src/app/services/model-selection-service.js", () => ({
  getStoredModel: vi.fn(() => ({ providerID: "openai", modelID: "gpt-5", variant: "default" })),
}));

vi.mock("../../../src/app/services/variant-selection-service.js", () => ({
  formatVariantForButton: vi.fn(() => "Default"),
}));

vi.mock("../../../src/bot/keyboards/main-reply-keyboard.js", () => ({
  createMainKeyboard: vi.fn(() => ({ keyboard: true })),
}));

vi.mock("../../../src/bot/menus/inline-menu.js", () => ({
  appendInlineMenuCancelButton: vi.fn(),
  ensureActiveInlineMenu: vi.fn(),
  replyWithInlineMenu: mocked.replyWithInlineMenuMock,
}));

function createContext(): Context {
  return {
    chat: { id: 321 },
    reply: vi.fn().mockResolvedValue({ message_id: 1 }),
  } as unknown as Context;
}

let container: AppContainer;

beforeEach(() => {
  container = createTestAppContainer();
});

describe("bot/commands/projects command", () => {
  beforeEach(() => {
    mocked.currentProject = null;
    mocked.syncSessionDirectoryCacheMock.mockReset();
    mocked.getProjectsMock.mockReset();
    mocked.getGitWorktreeContextMock.mockReset().mockResolvedValue(null);
    mocked.replyWithInlineMenuMock.mockReset();
  });

  it("blocks projects command while foreground session is busy", async () => {
    container.foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");

    const ctx = createContext();
    await projectsCommand(ctx as never, container);

    expect(mocked.syncSessionDirectoryCacheMock).not.toHaveBeenCalled();
    expect(mocked.getProjectsMock).not.toHaveBeenCalled();
    expect(mocked.replyWithInlineMenuMock).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(t("bot.session_busy"));
  });

  it("marks the main project as active when the current selection is a linked worktree", async () => {
    mocked.currentProject = {
      id: "linked-worktree",
      worktree: "C:\\worktrees\\repo-feature",
      name: "repo-feature",
    };
    mocked.getProjectsMock.mockResolvedValue([
      { id: "main-project", worktree: "C:\\repo", name: "Repo" },
      { id: "other-project", worktree: "C:\\other", name: "Other" },
    ]);
    mocked.getGitWorktreeContextMock.mockResolvedValue({
      mainProjectPath: "C:\\repo",
      activeWorktreePath: "C:\\worktrees\\repo-feature",
      branch: "feature/mobile",
      isLinkedWorktree: true,
      worktrees: [],
    });

    const ctx = createContext();
    await projectsCommand(ctx as never, container);

    const keyboard = mocked.replyWithInlineMenuMock.mock.calls[0]?.[1]?.keyboard as {
      inline_keyboard: Array<Array<{ text: string }>>;
    };

    expect(keyboard.inline_keyboard[0]?.[0]?.text).toBe(t("projects.search.button"));
    expect(keyboard.inline_keyboard[1]?.[0]?.text).toContain("✅");
    expect(keyboard.inline_keyboard[2]?.[0]?.text).not.toContain("✅");
  });

  it("searches folder names and the displayed current name, not paths or ids", async () => {
    mocked.currentProject = { id: "selected", worktree: "/repo/alpha", name: "Special Name" };
    const projects = [
      { id: "selected", worktree: "/repo/alpha", name: "Special Name" },
      { id: "hidden-id", worktree: "/secret/beta", name: "Other" },
    ];
    expect(await filterProjectsForSearch(projects, " ALP ")).toEqual([projects[0]]);
    expect(await filterProjectsForSearch(projects, "special")).toEqual([projects[0]]);
    expect(await filterProjectsForSearch(projects, "secret")).toEqual([]);
    expect(await filterProjectsForSearch(projects, "hidden-id")).toEqual([]);
    mocked.currentProject = { id: "selected", worktree: "/repo/alpha", name: "/repo/alpha" };
    expect(await filterProjectsForSearch(projects, "repo")).toEqual([]);
    mocked.currentProject = { id: "selected", worktree: "/repo/alpha", name: "frontend/web" };
    expect(await filterProjectsForSearch(projects, "frontend")).toEqual([projects[0]]);
  });

  it("renders a results heading, current marker and retry controls", async () => {
    mocked.currentProject = { id: "selected", worktree: "/repo/alpha", name: "alpha" };
    const view = await buildProjectSearchView(
      [{ id: "selected", worktree: "/repo/alpha" }],
      "  Alpha  ",
      0,
    );
    expect(view.text).toBe(t("projects.search.results", { query: "  Alpha  " }));
    expect(view.keyboard.inline_keyboard[0]?.[0]?.text).toContain("✅");
    expect(view.keyboard.inline_keyboard.at(-1)?.map((button) => button.text)).toEqual([
      t("projects.search.again"),
      t("projects.search.cancel"),
    ]);
  });
});
