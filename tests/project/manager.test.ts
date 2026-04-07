import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { projectListMock, cachedSessionProjectsMock } = vi.hoisted(() => ({
  projectListMock: vi.fn(),
  cachedSessionProjectsMock: vi.fn(),
}));

vi.mock("../../src/opencode/client.js", () => ({
  opencodeClient: {
    project: {
      list: projectListMock,
    },
  },
}));

vi.mock("../../src/session/cache-manager.js", () => ({
  getCachedSessionProjects: cachedSessionProjectsMock,
  __resetSessionDirectoryCacheForTests: vi.fn(),
}));

import { getProjects, getProjectByWorktree } from "../../src/project/manager.js";

describe("project/manager", () => {
  let tempRoot = "";

  beforeEach(() => {
    projectListMock.mockReset();
    cachedSessionProjectsMock.mockReset();
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
  });
});
