import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  statMock: vi.fn(),
  readFileMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: mocked.execFileMock,
}));

vi.mock("node:fs/promises", () => ({
  stat: mocked.statMock,
  readFile: mocked.readFileMock,
}));

import { getGitWorktreeContext, resolveGitDir } from "../../src/app/services/worktree-service.js";

describe("git/worktree", () => {
  beforeEach(() => {
    mocked.execFileMock.mockReset();
    mocked.statMock.mockReset();
    mocked.readFileMock.mockReset();
  });

  it("returns null when .git metadata is missing", async () => {
    mocked.statMock.mockRejectedValue(new Error("ENOENT"));

    await expect(resolveGitDir(path.resolve("D:/repo"))).resolves.toBeNull();
    await expect(getGitWorktreeContext(path.resolve("D:/repo"))).resolves.toBeNull();
  });

  it("resolves main worktree metadata from git worktree list", async () => {
    const repoPath = path.resolve("D:/repo");

    mocked.statMock.mockResolvedValue({
      isDirectory: () => true,
      isFile: () => false,
    });
    mocked.execFileMock.mockImplementation(
      (
        _file: string,
        _args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        callback(
          null,
          `worktree ${repoPath}\nHEAD 123\nbranch refs/heads/main\n\nworktree ${path.resolve("D:/repo-feature")}\nHEAD 456\nbranch refs/heads/feature/mobile\n`,
          "",
        );
      },
    );

    const context = await getGitWorktreeContext(repoPath);

    expect(context).toEqual({
      mainProjectPath: repoPath,
      activeWorktreePath: repoPath,
      branch: "main",
      isLinkedWorktree: false,
      worktrees: [
        { path: repoPath, branch: "main", isCurrent: true, isMain: true },
        {
          path: path.resolve("D:/repo-feature"),
          branch: "feature/mobile",
          isCurrent: false,
          isMain: false,
        },
      ],
    });
  });

  it("derives the main project path for linked worktrees", async () => {
    const mainWorktree = path.resolve("D:/repo");
    const linkedWorktree = path.resolve("D:/repo-feature");
    const linkedGitDir = path.join(mainWorktree, ".git", "worktrees", "feature");

    mocked.statMock.mockResolvedValue({
      isDirectory: () => false,
      isFile: () => true,
    });
    mocked.readFileMock.mockResolvedValue(`gitdir: ${linkedGitDir}`);
    mocked.execFileMock.mockImplementation(
      (
        _file: string,
        _args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        callback(
          null,
          `worktree ${mainWorktree}\nHEAD 123\nbranch refs/heads/main\n\nworktree ${linkedWorktree}\nHEAD 456\nbranch refs/heads/feature/worktree\n`,
          "",
        );
      },
    );

    const context = await getGitWorktreeContext(linkedWorktree);

    expect(context).toEqual({
      mainProjectPath: mainWorktree,
      activeWorktreePath: linkedWorktree,
      branch: "feature/worktree",
      isLinkedWorktree: true,
      worktrees: [
        { path: mainWorktree, branch: "main", isCurrent: false, isMain: true },
        {
          path: linkedWorktree,
          branch: "feature/worktree",
          isCurrent: true,
          isMain: false,
        },
      ],
    });
  });
});
