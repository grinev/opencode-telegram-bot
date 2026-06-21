import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  statMock: vi.fn(),
  readFileMock: vi.fn(),
  fetchMock: vi.fn(),
  opencodeConfig: {
    apiUrl: "http://localhost:4096",
    username: "opencode",
    password: "",
    autoRestartEnabled: false,
    monitorIntervalSec: 300,
    model: { provider: "test", modelId: "test" },
  },
}));

vi.mock("node:child_process", () => ({
  execFile: mocked.execFileMock,
}));

vi.mock("node:fs/promises", () => ({
  stat: mocked.statMock,
  readFile: mocked.readFileMock,
}));

vi.mock("../../../src/config.js", () => ({
  config: {
    opencode: mocked.opencodeConfig,
    telegram: { token: "test", allowedUserId: 0, proxyUrl: "" },
    server: { logLevel: "error" },
    bot: {
      sessionsListLimit: 10,
      projectsListLimit: 10,
      locale: "en",
      hideThinkingMessages: false,
      hideToolCallMessages: false,
    },
    files: { maxFileSizeKb: 100 },
  },
}));

import {
  createGitWorktree,
  getGitWorktreeContext,
  resolveGitDir,
} from "../../../src/app/services/worktree-service.js";

describe("app/services/worktree-service", () => {
  beforeEach(() => {
    mocked.execFileMock.mockReset();
    mocked.statMock.mockReset();
    mocked.readFileMock.mockReset();
    mocked.fetchMock.mockReset();
    vi.stubGlobal("fetch", mocked.fetchMock);
    mocked.opencodeConfig.apiUrl = "http://localhost:4096";
    mocked.opencodeConfig.password = "";
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

  describe("createGitWorktree", () => {
    it("on success returns the path and apiBranch", async () => {
      mocked.fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          name: "my-feature",
          branch: "opencode/my-feature",
          directory: "/repo/my-feature",
        }),
        text: async () => "",
      });

      const result = await createGitWorktree("my-feature");
      expect(result).toEqual({
        path: "/repo/my-feature",
        apiBranch: "opencode/my-feature",
      });
    });

    it("on success returns the path when called without a name", async () => {
      mocked.fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          name: "auto-slug",
          branch: "opencode/auto-slug",
          directory: "/repo/auto-slug",
        }),
        text: async () => "",
      });

      const result = await createGitWorktree();
      expect(result).toEqual({
        path: "/repo/auto-slug",
        apiBranch: "opencode/auto-slug",
      });
    });

    it("uses correct URL without query string", async () => {
      mocked.fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          name: "my-feature",
          branch: "opencode/my-feature",
          directory: "/repo/my-feature",
        }),
        text: async () => "",
      });

      await createGitWorktree("my-feature");
      const callArgs = mocked.fetchMock.mock.calls[0];
      expect(callArgs[0]).toBe(`${mocked.opencodeConfig.apiUrl}/experimental/worktree`);
    });

    it("sends name in request body when provided", async () => {
      mocked.fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          name: "my-feature",
          branch: "opencode/my-feature",
          directory: "/repo/my-feature",
        }),
        text: async () => "",
      });

      await createGitWorktree("my-feature");
      const callArgs = mocked.fetchMock.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body).toEqual({ name: "my-feature" });
    });

    it("sends empty body when called without a name", async () => {
      mocked.fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          name: "auto-slug",
          branch: "opencode/auto-slug",
          directory: "/repo/auto-slug",
        }),
        text: async () => "",
      });

      await createGitWorktree();
      const callArgs = mocked.fetchMock.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body).toEqual({});
    });

    it("sends Basic auth header when password is set", async () => {
      mocked.opencodeConfig.password = "secret";
      mocked.fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          name: "my-feature",
          branch: "opencode/my-feature",
          directory: "/repo/my-feature",
        }),
        text: async () => "",
      });

      await createGitWorktree("my-feature");
      const callArgs = mocked.fetchMock.mock.calls[0];
      const expectedAuth = `Basic ${Buffer.from("opencode:secret").toString("base64")}`;
      expect(callArgs[1].headers["Authorization"]).toBe(expectedAuth);
    });

    it("omits Authorization header when password is empty", async () => {
      mocked.opencodeConfig.password = "";
      mocked.fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          name: "my-feature",
          branch: "opencode/my-feature",
          directory: "/repo/my-feature",
        }),
        text: async () => "",
      });

      await createGitWorktree("my-feature");
      const callArgs = mocked.fetchMock.mock.calls[0];
      expect(callArgs[1].headers["Authorization"]).toBeUndefined();
    });

    it("returns error when HTTP response is not ok", async () => {
      mocked.fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => "",
      });

      const result = await createGitWorktree("my-feature");
      expect(result.error).toContain("500");
    });

    it("returns error when API returns empty directory", async () => {
      mocked.fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({}),
        text: async () => "",
      });

      const result = await createGitWorktree("my-feature");
      expect(result.error).toBe("API returned an empty worktree path");
    });

    it("returns error on network failure", async () => {
      mocked.fetchMock.mockRejectedValue(new Error("fetch failed"));

      const result = await createGitWorktree("my-feature");
      expect(result.error).toBe("fetch failed");
    });
  });
});
