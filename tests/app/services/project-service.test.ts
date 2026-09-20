import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { projectListMock, cachedSessionProjectsMock, configMock } = vi.hoisted(() => ({
  projectListMock: vi.fn(),
  cachedSessionProjectsMock: vi.fn(),
  configMock: {
    bot: {
      excludedProjectPaths: [] as string[],
    },
  },
}));

vi.mock("../../../src/opencode/client.js", () => ({
  directApi: projectListMock,
}));

vi.mock("../../../src/config.js", () => ({
  config: configMock,
}));

vi.mock("../../../src/app/services/session-cache-service.js", () => ({
  getCachedSessionProjects: cachedSessionProjectsMock,
  __resetSessionDirectoryCacheForTests: vi.fn(),
}));

import { getProjects, getProjectByWorktree } from "../../../src/app/services/project-service.js";

// v2 GET /api/project returns [{id, canonical, time}] (no display name);
// project-service derives name from the canonical basename.
function v2Project(id: string, canonical: string) {
  return { id, canonical };
}

describe("project/manager", () => {
  let tempRoot = "";

  beforeEach(() => {
    projectListMock.mockReset();
    cachedSessionProjectsMock.mockReset();
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
      data: [v2Project("p1", "D:/repo-a"), v2Project("p2", "D:/repo-b")],
      error: null,
    });
    cachedSessionProjectsMock.mockResolvedValueOnce([
      { id: "dir_1", worktree: "D:/repo-c", name: "D:/repo-c" },
      { id: "dir_2", worktree: "D:/repo-b", name: "D:/repo-b" },
    ]);

    const projects = await getProjects();

    expect(projects).toEqual([
      { id: "p1", worktree: "D:/repo-a", name: "repo-a" },
      { id: "p2", worktree: "D:/repo-b", name: "repo-b" },
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
      data: [v2Project("main", mainWorktree), v2Project("feature", linkedWorktree)],
      error: null,
    });
    cachedSessionProjectsMock.mockResolvedValueOnce([]);

    const projects = await getProjects();

    expect(projects).toEqual([{ id: "main", worktree: mainWorktree, name: "repo-main" }]);
  });

  it("keeps all projects when no excluded paths are configured", async () => {
    projectListMock.mockResolvedValueOnce({
      data: [v2Project("p1", "/home/user/repo-a"), v2Project("p2", "/home/user/repo-b")],
      error: null,
    });
    cachedSessionProjectsMock.mockResolvedValueOnce([]);

    const projects = await getProjects();

    expect(projects).toEqual([
      { id: "p1", worktree: "/home/user/repo-a", name: "repo-a" },
      { id: "p2", worktree: "/home/user/repo-b", name: "repo-b" },
    ]);
  });

  it("filters out projects whose worktree matches an excluded path", async () => {
    configMock.bot.excludedProjectPaths = ["/home/user/repo-b"];

    projectListMock.mockResolvedValueOnce({
      data: [v2Project("p1", "/home/user/repo-a"), v2Project("p2", "/home/user/repo-b")],
      error: null,
    });
    cachedSessionProjectsMock.mockResolvedValueOnce([]);

    const projects = await getProjects();

    expect(projects).toEqual([{ id: "p1", worktree: "/home/user/repo-a", name: "repo-a" }]);
  });

  it("filters out projects matching any of multiple excluded paths", async () => {
    configMock.bot.excludedProjectPaths = ["/home/user/repo-a", "/home/user/repo-b"];

    projectListMock.mockResolvedValueOnce({
      data: [
        v2Project("p1", "/home/user/repo-a"),
        v2Project("p2", "/home/user/repo-b"),
        v2Project("p3", "/home/user/repo-c"),
      ],
      error: null,
    });
    cachedSessionProjectsMock.mockResolvedValueOnce([]);

    const projects = await getProjects();

    expect(projects).toEqual([{ id: "p3", worktree: "/home/user/repo-c", name: "repo-c" }]);
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
        v2Project("main", mainWorktree),
        v2Project("feature", linkedWorktree),
        v2Project("excluded", excludedWorktree),
      ],
      error: null,
    });
    cachedSessionProjectsMock.mockResolvedValueOnce([]);

    const projects = await getProjects();

    expect(projects).toEqual([{ id: "main", worktree: mainWorktree, name: "repo-main" }]);
  });

  it("filters out projects when excluded path has trailing separator", async () => {
    configMock.bot.excludedProjectPaths = ["/home/user/repo-b/"];

    projectListMock.mockResolvedValueOnce({
      data: [v2Project("p1", "/home/user/repo-a"), v2Project("p2", "/home/user/repo-b")],
      error: null,
    });
    cachedSessionProjectsMock.mockResolvedValueOnce([]);

    const projects = await getProjects();

    expect(projects).toEqual([{ id: "p1", worktree: "/home/user/repo-a", name: "repo-a" }]);
  });

  it("filters out projects when worktree has trailing separator but excluded does not", async () => {
    configMock.bot.excludedProjectPaths = ["/home/user/repo-b"];

    projectListMock.mockResolvedValueOnce({
      data: [v2Project("p1", "/home/user/repo-a/"), v2Project("p2", "/home/user/repo-b/")],
      error: null,
    });
    cachedSessionProjectsMock.mockResolvedValueOnce([]);

    const projects = await getProjects();

    expect(projects).toEqual([{ id: "p1", worktree: "/home/user/repo-a/", name: "repo-a" }]);
  });

  it("filters out projects with Windows casing differences", async () => {
    configMock.bot.excludedProjectPaths = ["c:\\users\\dev\\repo"];

    projectListMock.mockResolvedValueOnce({
      data: [v2Project("p1", "C:\\Users\\Dev\\Repo"), v2Project("p2", "C:\\Users\\Dev\\Other")],
      error: null,
    });
    cachedSessionProjectsMock.mockResolvedValueOnce([]);

    const projects = await getProjects();

    expect(projects).toEqual([{ id: "p2", worktree: "C:\\Users\\Dev\\Other", name: "Other" }]);
  });

  it("filters out projects with Windows mixed separators", async () => {
    configMock.bot.excludedProjectPaths = ["C:/Users/Dev/Repo"];

    projectListMock.mockResolvedValueOnce({
      data: [v2Project("p1", "C:\\Users\\Dev\\Repo"), v2Project("p2", "C:\\Users\\Dev\\Other")],
      error: null,
    });
    cachedSessionProjectsMock.mockResolvedValueOnce([]);

    const projects = await getProjects();

    expect(projects).toEqual([{ id: "p2", worktree: "C:\\Users\\Dev\\Other", name: "Other" }]);
  });

  it("filters out projects with Windows trailing separator and casing", async () => {
    configMock.bot.excludedProjectPaths = ["C:\\Users\\Dev\\Repo\\"];

    projectListMock.mockResolvedValueOnce({
      data: [v2Project("p1", "c:/users/dev/repo"), v2Project("p2", "C:/Users/Dev/Other/")],
      error: null,
    });
    cachedSessionProjectsMock.mockResolvedValueOnce([]);

    const projects = await getProjects();

    expect(projects).toEqual([{ id: "p2", worktree: "C:/Users/Dev/Other/", name: "Other" }]);
  });

  describe("getProjectByWorktree", () => {
    it("should find project by exact worktree path", async () => {
      projectListMock.mockResolvedValueOnce({
        data: [v2Project("p1", "/home/user/repo")],
        error: null,
      });
      cachedSessionProjectsMock.mockResolvedValueOnce([]);

      const project = await getProjectByWorktree("/home/user/repo");
      expect(project).toEqual({ id: "p1", worktree: "/home/user/repo", name: "repo" });
    });

    it("should throw when worktree is not found", async () => {
      projectListMock.mockResolvedValueOnce({
        data: [v2Project("p1", "/home/user/repo")],
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
        data: [v2Project("main", mainWorktree), v2Project("feature", linkedWorktree)],
        error: null,
      });
      cachedSessionProjectsMock.mockResolvedValueOnce([]);

      const project = await getProjectByWorktree(linkedWorktree);

      expect(project).toEqual({ id: "feature", worktree: linkedWorktree, name: "repo-feature" });
    });

    it("should match case-insensitively on Windows", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "win32" });

      try {
        projectListMock.mockResolvedValueOnce({
          data: [v2Project("p1", "C:\\Users\\Dev\\Repo")],
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
          data: [v2Project("p1", "C:\\Users\\Dev\\Repo")],
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
