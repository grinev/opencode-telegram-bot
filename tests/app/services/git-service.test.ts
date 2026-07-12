import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: mocked.execFileMock,
}));

import {
  commitAll,
  getChangedFiles,
  getFileDiff,
  getFullPatch,
  hasChanges,
} from "../../../src/app/services/git-service.js";

type ExecFileCallback = (error: Error | null, stdout: string) => void;

interface GitCall {
  args: string[];
}

function setupGitResponses(
  responder: (args: string[]) => { stdout?: string; error?: Error & { code?: number } },
): GitCall[] {
  const calls: GitCall[] = [];

  mocked.execFileMock.mockImplementation(
    (_command: string, args: string[], _options: unknown, callback: ExecFileCallback) => {
      calls.push({ args });
      const response = responder(args);
      callback(response.error ?? null, response.stdout ?? "");
    },
  );

  return calls;
}

describe("git-service", () => {
  beforeEach(() => {
    mocked.execFileMock.mockReset();
  });

  describe("getChangedFiles", () => {
    it("parses modified, untracked, renamed files and merges numstat counts", async () => {
      const statusOutput =
        " M src/app.ts\0" +
        "?? new file with spaces.txt\0" +
        "R  renamed-new.ts\0renamed-old.ts\0" +
        " M assets/logo.png\0";
      const numstatOutput =
        "10\t2\tsrc/app.ts\0" +
        "-\t-\tassets/logo.png\0" +
        "3\t1\t\0renamed-old.ts\0renamed-new.ts\0";

      setupGitResponses((args) => {
        if (args[0] === "status") {
          return { stdout: statusOutput };
        }
        if (args[0] === "diff" && args.includes("--numstat")) {
          return { stdout: numstatOutput };
        }
        throw new Error(`Unexpected git call: ${args.join(" ")}`);
      });

      const files = await getChangedFiles("/repo");

      expect(files).toHaveLength(4);

      const modified = files.find((file) => file.path === "src/app.ts");
      expect(modified).toMatchObject({
        status: "M",
        additions: 10,
        deletions: 2,
        binary: false,
        untracked: false,
      });

      const untracked = files.find((file) => file.path === "new file with spaces.txt");
      expect(untracked).toMatchObject({ untracked: true, additions: null, deletions: null });

      const renamed = files.find((file) => file.path === "renamed-new.ts");
      expect(renamed).toMatchObject({ status: "R", additions: 3, deletions: 1 });

      const binary = files.find((file) => file.path === "assets/logo.png");
      expect(binary).toMatchObject({ binary: true, additions: null, deletions: null });
    });

    it("keeps status entries when numstat fails (repo without HEAD)", async () => {
      setupGitResponses((args) => {
        if (args[0] === "status") {
          return { stdout: "?? first.txt\0" };
        }
        return { error: Object.assign(new Error("bad revision HEAD"), { code: 128 }) };
      });

      const files = await getChangedFiles("/repo");

      expect(files).toHaveLength(1);
      expect(files[0]).toMatchObject({ path: "first.txt", untracked: true, additions: null });
    });
  });

  describe("getFileDiff", () => {
    it("diffs tracked files against HEAD", async () => {
      const calls = setupGitResponses(() => ({ stdout: "diff --git ..." }));

      const diff = await getFileDiff("/repo", "src/app.ts");

      expect(diff).toBe("diff --git ...");
      expect(calls[0].args).toEqual(["diff", "HEAD", "--", "src/app.ts"]);
    });

    it("treats exit code 1 from --no-index as success for untracked files", async () => {
      const calls = setupGitResponses(() => ({
        stdout: "diff --git a/dev/null b/new.txt ...",
        error: Object.assign(new Error("exit 1"), { code: 1 }),
      }));

      const diff = await getFileDiff("/repo", "new.txt", { untracked: true });

      expect(diff).toBe("diff --git a/dev/null b/new.txt ...");
      expect(calls[0].args).toEqual(["diff", "--no-index", "--", "/dev/null", "new.txt"]);
    });

    it("rejects on real git failures", async () => {
      setupGitResponses(() => ({
        error: Object.assign(new Error("not a git repository"), { code: 128 }),
      }));

      await expect(getFileDiff("/repo", "src/app.ts")).rejects.toThrow("not a git repository");
    });
  });

  describe("getFullPatch", () => {
    it("appends untracked file diffs to the HEAD patch", async () => {
      setupGitResponses((args) => {
        if (args[0] === "diff" && args[1] === "HEAD" && args.length === 2) {
          return { stdout: "tracked patch\n" };
        }
        if (args[0] === "status") {
          return { stdout: " M tracked.ts\0?? new.txt\0" };
        }
        if (args.includes("--numstat")) {
          return { stdout: "1\t1\ttracked.ts\0" };
        }
        if (args.includes("--no-index")) {
          return {
            stdout: "untracked patch\n",
            error: Object.assign(new Error("exit 1"), { code: 1 }),
          };
        }
        throw new Error(`Unexpected git call: ${args.join(" ")}`);
      });

      const patch = await getFullPatch("/repo");

      expect(patch).toContain("tracked patch");
      expect(patch).toContain("untracked patch");
    });
  });

  describe("hasChanges", () => {
    it("returns true when status output is non-empty", async () => {
      setupGitResponses(() => ({ stdout: " M src/app.ts\0" }));
      await expect(hasChanges("/repo")).resolves.toBe(true);
    });

    it("returns false for a clean worktree", async () => {
      setupGitResponses(() => ({ stdout: "" }));
      await expect(hasChanges("/repo")).resolves.toBe(false);
    });
  });

  describe("commitAll", () => {
    it("stages, commits with the message as a single argv element, and returns the hash", async () => {
      const message = 'feat: add "quotes" && $(dangerous) `stuff`';
      const calls = setupGitResponses((args) => {
        if (args[0] === "rev-parse") {
          return { stdout: "abc1234\n" };
        }
        return { stdout: "" };
      });

      const result = await commitAll("/repo", message);

      expect(result.hash).toBe("abc1234");
      expect(calls.map((call) => call.args)).toEqual([
        ["add", "-A"],
        ["commit", "-m", message],
        ["rev-parse", "--short", "HEAD"],
      ]);
    });
  });
});
