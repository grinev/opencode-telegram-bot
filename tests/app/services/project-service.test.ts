import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "#vitest";

import { loadSut } from "#helpers/sut-loader.js";
const { projectListMock, cachedSessionProjectsMock, configMock } = vi.hoisted(() => ({
  projectListMock: vi.fn(),
  cachedSessionProjectsMock: vi.fn(),
  configMock: {
    bot: {
      excludedProjectPaths: [] as string[],
    },
  },
}));

vi.mock("#src/opencode/client.ts", () => ({
  opencodeClient: {
    project: {
      list: projectListMock,
    },
  },
}));

vi.mock("#src/config.ts", () => ({
  config: configMock,
}));

vi.mock("#src/app/services/session-cache-service.ts", () => ({
  getCachedSessionProjects: cachedSessionProjectsMock,
  __resetSessionDirectoryCacheForTests: vi.fn(),
  warmupSessionDirectoryCache: vi.fn().mockResolvedValue(undefined),
  syncSessionDirectoryCache: vi.fn().mockResolvedValue(undefined),
  getCachedSessionDirectories: vi.fn().mockResolvedValue([]),
  upsertSessionDirectory: vi.fn().mockResolvedValue(undefined),
  ingestSessionInfoForCache: vi.fn().mockResolvedValue(undefined),
}));

// settings-store is not mocked here — tests that need to control
// getVisibleProjects import it dynamically and use vi.mocked().mockReturnValue()

const { getProjects, getProjectByWorktree } = await loadSut<typeof import("#src/app/services/project-service.js")>(
  "#src/app/services/project-service.ts",
  import.meta.url,
);

describe("project/manager", () => {
  let tempRoot = "";

  beforeEach(() => {
    projectListMock.mockReset();
    cachedSessionProjectsMock.mockReset();
    delete process.env.OPENCODE_TELEGRAM_VISIBLE_PROJECTS;
    configMock.bot.excludedProjectPaths = [];
  });

  afterEach(async () => {
    if (!tempRoot) {
      return;
    }

    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = "";
  });

  it("merges API projects with cached session directories", async () => {
    projectListMock.mockResolvedValueOnce({
      data: [
        { id: "p1", worktree: "D:/repo-a", name: "Repo A" },
        { id: "p2", worktree: "D:/repo-b", name: "" },
      ],
      error: null,
    });
    cachedSessionProjectsMock.mockResolvedValueOnce([
      { id: "dir_1", worktree: "D:/repo-c", name: "D:/repo-c" },
      { id: "dir_2", worktree: "D:/repo-b", name: "D:/repo-b" },
    ]);

    const projects = await getProjects();

    expect(projects).toEqual([
      { id: "p1", worktree: "D:/repo-a", name: "Repo A" },
      { id: "p2", worktree: "D:/repo-b", name: "D:/repo-b" },
      { id: "dir_1", worktree: "D:/repo-c", name: "D:/repo-c" },
    ]);
  });

  it("throws when API returns error", async () => {
    projectListMock.mockResolvedValueOnce({
      data: null,
      error: new Error("boom"),
    });

    await expect(getProjects()).rejects.toThrow("boom");
  });

  it("hides linked git worktrees and keeps primary worktree", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "opencode-projects-"));

    const mainWorktree = path.join(tempRoot, "repo-main");
    const linkedWorktree = path.join(tempRoot, "repo-feature");

    await mkdir(path.join(mainWorktree, ".git"), { recursive: true });
    await mkdir(linkedWorktree, { recursive: true });
    await writeFile(
      path.join(linkedWorktree, ".git"),
      `gitdir: ${path.join(mainWorktree, ".git", "worktrees", "feature")}`,
      "utf-8",
    );

    projectListMock.mockResolvedValueOnce({
      data: [
        { id: "main", worktree: mainWorktree, name: "Main" },
        { id: "feature", worktree: linkedWorktree, name: "Feature" },
      ],
      error: null,
    });
    cachedSessionProjectsMock.mockResolvedValueOnce([]);

    const projects = await getProjects();

    expect(projects).toEqual([{ id: "main", worktree: mainWorktree, name: "Main" }]);
  });

  describe("whitelist filter", () => {
    beforeEach(async () => {
      delete process.env.OPENCODE_TELEGRAM_VISIBLE_PROJECTS;
      // Reset settings-store whitelist before each test
      const settings = await import("#src/app/stores/settings-store.js") as typeof import("#src/app/stores/settings-store.js");
      await settings.setVisibleProjects([]);
    });

    it("shows all projects when no filter is configured", async () => {
      projectListMock.mockResolvedValueOnce({
        data: [
          { id: "p1", worktree: "/home/user/a", name: "A" },
          { id: "p2", worktree: "/home/user/b", name: "B" },
        ],
        error: null,
      });
      cachedSessionProjectsMock.mockResolvedValueOnce([]);

      const projects = await getProjects();

      expect(projects).toHaveLength(2);
    });

    it("filters by env var (OPENCODE_TELEGRAM_VISIBLE_PROJECTS)", async () => {
      process.env.OPENCODE_TELEGRAM_VISIBLE_PROJECTS = "/home/user/a;/home/user/c";

      projectListMock.mockResolvedValueOnce({
        data: [
          { id: "p1", worktree: "/home/user/a", name: "A" },
          { id: "p2", worktree: "/home/user/b", name: "B" },
          { id: "p3", worktree: "/home/user/c", name: "C" },
        ],
        error: null,
      });
      cachedSessionProjectsMock.mockResolvedValueOnce([]);

      const projects = await getProjects();

      expect(projects).toHaveLength(2);
      expect(projects.map((p) => p.id)).toEqual(["p1", "p3"]);
    });

    it("env var takes precedence over settings whitelist", async () => {
      process.env.OPENCODE_TELEGRAM_VISIBLE_PROJECTS = "/home/user/a";
      const settings = await import("#src/app/stores/settings-store.js") as typeof import("#src/app/stores/settings-store.js");
      await settings.setVisibleProjects(["/home/user/b"]);

      projectListMock.mockResolvedValueOnce({
        data: [
          { id: "p1", worktree: "/home/user/a", name: "A" },
          { id: "p2", worktree: "/home/user/b", name: "B" },
        ],
        error: null,
      });
      cachedSessionProjectsMock.mockResolvedValueOnce([]);

      const projects = await getProjects();

      expect(projects).toHaveLength(1);
      expect(projects[0].id).toBe("p1");
    });

    it("filters by settings whitelist (visibleProjects)", async () => {
      const settings = await import("#src/app/stores/settings-store.js") as typeof import("#src/app/stores/settings-store.js");
      await settings.setVisibleProjects(["/home/user/repo-a"]);

      projectListMock.mockResolvedValueOnce({
        data: [
          { id: "p1", worktree: "/home/user/repo-a", name: "Repo A" },
          { id: "p2", worktree: "/home/user/repo-b", name: "Repo B" },
        ],
        error: null,
      });
      cachedSessionProjectsMock.mockResolvedValueOnce([]);

      const projects = await getProjects();

      expect(projects).toHaveLength(1);
      expect(projects[0].id).toBe("p1");
    });

    it("is case-insensitive on path matching", async () => {
      const settings = await import("#src/app/stores/settings-store.js") as typeof import("#src/app/stores/settings-store.js");
      await settings.setVisibleProjects(["/HOME/User/REPO-A"]);

      projectListMock.mockResolvedValueOnce({
        data: [
          { id: "p1", worktree: "/home/user/repo-a", name: "Repo A" },
          { id: "p2", worktree: "/home/user/repo-b", name: "Repo B" },
        ],
        error: null,
      });
      cachedSessionProjectsMock.mockResolvedValueOnce([]);

      const projects = await getProjects();

      expect(projects).toHaveLength(1);
      expect(projects[0].id).toBe("p1");
    });

    it("handles trailing slashes in paths", async () => {
      const settings = await import("#src/app/stores/settings-store.js") as typeof import("#src/app/stores/settings-store.js");
      await settings.setVisibleProjects(["/home/user/repo-a/"]);

      projectListMock.mockResolvedValueOnce({
        data: [
          { id: "p1", worktree: "/home/user/repo-a", name: "Repo A" },
        ],
        error: null,
      });
      cachedSessionProjectsMock.mockResolvedValueOnce([]);

      const projects = await getProjects();

      expect(projects).toHaveLength(1);
      expect(projects[0].id).toBe("p1");
    });

    it("returns empty list when no projects match the filter", async () => {
      const settings = await import("#src/app/stores/settings-store.js") as typeof import("#src/app/stores/settings-store.js");
      await settings.setVisibleProjects(["/home/user/other"]);

      projectListMock.mockResolvedValueOnce({
        data: [
          { id: "p1", worktree: "/home/user/repo-a", name: "Repo A" },
        ],
        error: null,
      });
      cachedSessionProjectsMock.mockResolvedValueOnce([]);

      const projects = await getProjects();

      expect(projects).toHaveLength(0);
    });

    it("filters after linked worktree filtering", async () => {
      tempRoot = await mkdtemp(path.join(os.tmpdir(), "opencode-whitelist-linked-"));

      const mainWorktree = path.join(tempRoot, "repo-main");
      const linkedWorktree = path.join(tempRoot, "repo-feature");

      await mkdir(path.join(mainWorktree, ".git"), { recursive: true });
      await mkdir(linkedWorktree, { recursive: true });
      await writeFile(
        path.join(linkedWorktree, ".git"),
        `gitdir: ${path.join(mainWorktree, ".git", "worktrees", "feature")}`,
        "utf-8",
      );

      process.env.OPENCODE_TELEGRAM_VISIBLE_PROJECTS = tempRoot + "/repo-feature";

      projectListMock.mockResolvedValueOnce({
        data: [
          { id: "main", worktree: mainWorktree, name: "Main" },
          { id: "feature", worktree: linkedWorktree, name: "Feature" },
        ],
        error: null,
      });
      cachedSessionProjectsMock.mockResolvedValueOnce([]);

      const projects = await getProjects();

      // repo-feature is a linked worktree, so it's already filtered out
      // by the linked-worktree filter. The whitelist sees it as empty.
      expect(projects).toHaveLength(0);
    });
  });

  it("keeps all projects when no excluded paths are configured", async () => {
    projectListMock.mockResolvedValueOnce({
      data: [
        { id: "p1", worktree: "/home/user/repo-a", name: "Repo A" },
        { id: "p2", worktree: "/home/user/repo-b", name: "Repo B" },
      ],
      error: null,
    });
    cachedSessionProjectsMock.mockResolvedValueOnce([]);

    const projects = await getProjects();

    expect(projects).toEqual([
      { id: "p1", worktree: "/home/user/repo-a", name: "Repo A" },
      { id: "p2", worktree: "/home/user/repo-b", name: "Repo B" },
    ]);
  });

  it("filters out projects whose worktree matches an excluded path", async () => {
    configMock.bot.excludedProjectPaths = ["/home/user/repo-b"];

    projectListMock.mockResolvedValueOnce({
      data: [
        { id: "p1", worktree: "/home/user/repo-a", name: "Repo A" },
        { id: "p2", worktree: "/home/user/repo-b", name: "Repo B" },
      ],
      error: null,
    });
    cachedSessionProjectsMock.mockResolvedValueOnce([]);

    const projects = await getProjects();

    expect(projects).toEqual([{ id: "p1", worktree: "/home/user/repo-a", name: "Repo A" }]);
  });

  it("filters out projects matching any of multiple excluded paths", async () => {
    configMock.bot.excludedProjectPaths = ["/home/user/repo-a", "/home/user/repo-b"];

    projectListMock.mockResolvedValueOnce({
      data: [
        { id: "p1", worktree: "/home/user/repo-a", name: "Repo A" },
        { id: "p2", worktree: "/home/user/repo-b", name: "Repo B" },
        { id: "p3", worktree: "/home/user/repo-c", name: "Repo C" },
      ],
      error: null,
    });
    cachedSessionProjectsMock.mockResolvedValueOnce([]);

    const projects = await getProjects();

    expect(projects).toEqual([{ id: "p3", worktree: "/home/user/repo-c", name: "Repo C" }]);
  });

  it("applies exclusion after hiding linked git worktrees", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "opencode-excluded-worktrees-"));

    const mainWorktree = path.join(tempRoot, "repo-main");
    const linkedWorktree = path.join(tempRoot, "repo-feature");
    const excludedWorktree = path.join(tempRoot, "repo-excluded");

    await mkdir(path.join(mainWorktree, ".git"), { recursive: true });
    await mkdir(linkedWorktree, { recursive: true });
    await mkdir(excludedWorktree, { recursive: true });
    await writeFile(
      path.join(linkedWorktree, ".git"),
      `gitdir: ${path.join(mainWorktree, ".git", "worktrees", "feature")}`,
      "utf-8",
    );

    configMock.bot.excludedProjectPaths = [excludedWorktree];

    projectListMock.mockResolvedValueOnce({
      data: [
        { id: "main", worktree: mainWorktree, name: "Main" },
        { id: "feature", worktree: linkedWorktree, name: "Feature" },
        { id: "excluded", worktree: excludedWorktree, name: "Excluded" },
      ],
      error: null,
    });
    cachedSessionProjectsMock.mockResolvedValueOnce([]);

    const projects = await getProjects();

    expect(projects).toEqual([{ id: "main", worktree: mainWorktree, name: "Main" }]);
  });

  it("filters out projects when excluded path has trailing separator", async () => {
    configMock.bot.excludedProjectPaths = ["/home/user/repo-b/"];

    projectListMock.mockResolvedValueOnce({
      data: [
        { id: "p1", worktree: "/home/user/repo-a", name: "Repo A" },
        { id: "p2", worktree: "/home/user/repo-b", name: "Repo B" },
      ],
      error: null,
    });
    cachedSessionProjectsMock.mockResolvedValueOnce([]);

    const projects = await getProjects();

    expect(projects).toEqual([{ id: "p1", worktree: "/home/user/repo-a", name: "Repo A" }]);
  });

  it("filters out projects when worktree has trailing separator but excluded does not", async () => {
    configMock.bot.excludedProjectPaths = ["/home/user/repo-b"];

    projectListMock.mockResolvedValueOnce({
      data: [
        { id: "p1", worktree: "/home/user/repo-a/", name: "Repo A" },
        { id: "p2", worktree: "/home/user/repo-b/", name: "Repo B" },
      ],
      error: null,
    });
    cachedSessionProjectsMock.mockResolvedValueOnce([]);

    const projects = await getProjects();

    expect(projects).toEqual([{ id: "p1", worktree: "/home/user/repo-a/", name: "Repo A" }]);
  });

  it("filters out projects with Windows casing differences", async () => {
    configMock.bot.excludedProjectPaths = ["c:\\users\\dev\\repo"];

    projectListMock.mockResolvedValueOnce({
      data: [
        { id: "p1", worktree: "C:\\Users\\Dev\\Repo", name: "Repo A" },
        { id: "p2", worktree: "C:\\Users\\Dev\\Other", name: "Other" },
      ],
      error: null,
    });
    cachedSessionProjectsMock.mockResolvedValueOnce([]);

    const projects = await getProjects();

    expect(projects).toEqual([{ id: "p2", worktree: "C:\\Users\\Dev\\Other", name: "Other" }]);
  });

  it("filters out projects with Windows mixed separators", async () => {
    configMock.bot.excludedProjectPaths = ["C:/Users/Dev/Repo"];

    projectListMock.mockResolvedValueOnce({
      data: [
        { id: "p1", worktree: "C:\\Users\\Dev\\Repo", name: "Repo A" },
        { id: "p2", worktree: "C:\\Users\\Dev\\Other", name: "Other" },
      ],
      error: null,
    });
    cachedSessionProjectsMock.mockResolvedValueOnce([]);

    const projects = await getProjects();

    expect(projects).toEqual([{ id: "p2", worktree: "C:\\Users\\Dev\\Other", name: "Other" }]);
  });

  it("filters out projects with Windows trailing separator and casing", async () => {
    configMock.bot.excludedProjectPaths = ["C:\\Users\\Dev\\Repo\\"];

    projectListMock.mockResolvedValueOnce({
      data: [
        { id: "p1", worktree: "c:/users/dev/repo", name: "Repo A" },
        { id: "p2", worktree: "C:/Users/Dev/Other/", name: "Other" },
      ],
      error: null,
    });
    cachedSessionProjectsMock.mockResolvedValueOnce([]);

    const projects = await getProjects();

    expect(projects).toEqual([{ id: "p2", worktree: "C:/Users/Dev/Other/", name: "Other" }]);
  });

  describe("getProjectByWorktree", () => {
    it("should find project by exact worktree path", async () => {
      projectListMock.mockResolvedValueOnce({
        data: [{ id: "p1", worktree: "/home/user/repo", name: "Repo" }],
        error: null,
      });
      cachedSessionProjectsMock.mockResolvedValueOnce([]);

      const project = await getProjectByWorktree("/home/user/repo");
      expect(project).toEqual({ id: "p1", worktree: "/home/user/repo", name: "Repo" });
    });

    it("should throw when worktree is not found", async () => {
      projectListMock.mockResolvedValueOnce({
        data: [{ id: "p1", worktree: "/home/user/repo", name: "Repo" }],
        error: null,
      });
      cachedSessionProjectsMock.mockResolvedValueOnce([]);

      await expect(getProjectByWorktree("/home/user/other")).rejects.toThrow(
        "Project with worktree /home/user/other not found",
      );
    });

    it("returns linked git worktrees even when they are hidden from /projects", async () => {
      tempRoot = await mkdtemp(path.join(os.tmpdir(), "opencode-project-by-worktree-"));

      const mainWorktree = path.join(tempRoot, "repo-main");
      const linkedWorktree = path.join(tempRoot, "repo-feature");

      await mkdir(path.join(mainWorktree, ".git"), { recursive: true });
      await mkdir(linkedWorktree, { recursive: true });
      await writeFile(
        path.join(linkedWorktree, ".git"),
        `gitdir: ${path.join(mainWorktree, ".git", "worktrees", "feature")}`,
        "utf-8",
      );

      projectListMock.mockResolvedValueOnce({
        data: [
          { id: "main", worktree: mainWorktree, name: "Main" },
          { id: "feature", worktree: linkedWorktree, name: "Feature" },
        ],
        error: null,
      });
      cachedSessionProjectsMock.mockResolvedValueOnce([]);

      const project = await getProjectByWorktree(linkedWorktree);

      expect(project).toEqual({ id: "feature", worktree: linkedWorktree, name: "Feature" });
    });

    it("should match case-insensitively on Windows", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "win32" });

      try {
        projectListMock.mockResolvedValueOnce({
          data: [{ id: "p1", worktree: "C:\\Users\\Dev\\Repo", name: "Repo" }],
          error: null,
        });
        cachedSessionProjectsMock.mockResolvedValueOnce([]);

        const project = await getProjectByWorktree("c:\\users\\dev\\repo");
        expect(project).toEqual({
          id: "p1",
          worktree: "C:\\Users\\Dev\\Repo",
          name: "Repo",
        });
      } finally {
        Object.defineProperty(process, "platform", { value: originalPlatform });
      }
    });

    it("should match Windows worktree paths with mixed separators", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "win32" });

      try {
        projectListMock.mockResolvedValueOnce({
          data: [{ id: "p1", worktree: "C:\\Users\\Dev\\Repo", name: "Repo" }],
          error: null,
        });
        cachedSessionProjectsMock.mockResolvedValueOnce([]);

        const project = await getProjectByWorktree("C:/Users/Dev/Repo/");
        expect(project).toEqual({
          id: "p1",
          worktree: "C:\\Users\\Dev\\Repo",
          name: "Repo",
        });
      } finally {
        Object.defineProperty(process, "platform", { value: originalPlatform });
      }
    });
  });
});
