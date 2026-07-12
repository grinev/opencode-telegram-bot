import { execFile } from "node:child_process";

const GIT_MAX_BUFFER = 10 * 1024 * 1024;

export interface GitChangedFile {
  path: string;
  status: string;
  additions: number | null;
  deletions: number | null;
  binary: boolean;
  untracked: boolean;
}

export interface GitCommitResult {
  hash: string;
}

export interface GitRepoStatus {
  branch: string;
  detached: boolean;
  hasUpstream: boolean;
  ahead: number;
  behind: number;
  changedCount: number;
  conflictCount: number;
}

function runGit(
  dir: string,
  args: string[],
  options?: { allowExitCode1?: boolean },
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd: dir,
        windowsHide: true,
        maxBuffer: GIT_MAX_BUFFER,
      },
      (error, stdout) => {
        if (error) {
          // Some git commands (diff --no-index) exit with code 1 when
          // differences exist; that is a successful result for our purposes.
          const exitCode = (error as { code?: number | string }).code;
          if (options?.allowExitCode1 && exitCode === 1) {
            resolve(stdout);
            return;
          }

          reject(error);
          return;
        }

        resolve(stdout);
      },
    );
  });
}

interface StatusEntry {
  path: string;
  status: string;
  untracked: boolean;
}

function parseStatusPorcelainZ(stdout: string): StatusEntry[] {
  const tokens = stdout.split("\0").filter((token) => token.length > 0);
  const entries: StatusEntry[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.length < 4) {
      continue;
    }

    const status = token.slice(0, 2);
    const filePath = token.slice(3);

    // Renames/copies are followed by the original path as a separate token.
    if (status[0] === "R" || status[0] === "C") {
      i++;
    }

    entries.push({
      path: filePath,
      status: status.trim(),
      untracked: status === "??",
    });
  }

  return entries;
}

interface NumstatEntry {
  additions: number | null;
  deletions: number | null;
  binary: boolean;
}

function parseCount(value: string): number | null {
  return value === "-" ? null : Number.parseInt(value, 10);
}

function parseNumstatZ(stdout: string): Map<string, NumstatEntry> {
  const tokens = stdout.split("\0");
  const byPath = new Map<string, NumstatEntry>();

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) {
      continue;
    }

    const match = token.match(/^([\d-]+)\t([\d-]+)\t(.*)$/s);
    if (!match) {
      continue;
    }

    const additions = parseCount(match[1]);
    const deletions = parseCount(match[2]);
    let filePath = match[3];

    // Renames: the path fields follow as two separate NUL-terminated tokens
    // (source, then destination).
    if (filePath === "") {
      i += 2;
      filePath = tokens[i] ?? "";
    }

    if (!filePath) {
      continue;
    }

    byPath.set(filePath, {
      additions,
      deletions,
      binary: additions === null && deletions === null,
    });
  }

  return byPath;
}

/**
 * List files changed in the worktree relative to HEAD, including untracked files.
 */
export async function getChangedFiles(dir: string): Promise<GitChangedFile[]> {
  const statusOutput = await runGit(dir, ["status", "--porcelain=v1", "-z"]);
  const statusEntries = parseStatusPorcelainZ(statusOutput);

  let numstatByPath = new Map<string, NumstatEntry>();
  try {
    const numstatOutput = await runGit(dir, ["diff", "HEAD", "--numstat", "-z"]);
    numstatByPath = parseNumstatZ(numstatOutput);
  } catch {
    // No HEAD yet (fresh repo without commits) — counts stay unknown.
  }

  return statusEntries.map((entry) => {
    const numstat = numstatByPath.get(entry.path);

    return {
      path: entry.path,
      status: entry.status,
      additions: numstat?.additions ?? null,
      deletions: numstat?.deletions ?? null,
      binary: numstat?.binary ?? false,
      untracked: entry.untracked,
    };
  });
}

/**
 * Unified diff of a single file against HEAD; untracked files are diffed
 * against /dev/null so their full content shows as additions.
 */
export async function getFileDiff(
  dir: string,
  file: string,
  options?: { untracked?: boolean },
): Promise<string> {
  if (options?.untracked) {
    return runGit(dir, ["diff", "--no-index", "--", "/dev/null", file], { allowExitCode1: true });
  }

  return runGit(dir, ["diff", "HEAD", "--", file]);
}

/**
 * Full unified patch of the worktree against HEAD, with untracked files appended.
 */
export async function getFullPatch(dir: string): Promise<string> {
  let patch = "";
  try {
    patch = await runGit(dir, ["diff", "HEAD"]);
  } catch {
    // No HEAD yet — fall through to untracked files only.
  }

  const changedFiles = await getChangedFiles(dir);
  for (const file of changedFiles) {
    if (!file.untracked) {
      continue;
    }

    try {
      const untrackedDiff = await getFileDiff(dir, file.path, { untracked: true });
      if (untrackedDiff) {
        patch += (patch && !patch.endsWith("\n") ? "\n" : "") + untrackedDiff;
      }
    } catch {
      // Skip unreadable untracked files (e.g. sockets, permission errors).
    }
  }

  return patch;
}

/**
 * Branch, upstream sync, and change-count summary from a single
 * `git status --porcelain=v2 --branch` call.
 */
export async function getRepoStatus(dir: string): Promise<GitRepoStatus> {
  const stdout = await runGit(dir, ["status", "--porcelain=v2", "--branch", "-z"]);
  const tokens = stdout.split("\0").filter((token) => token.length > 0);

  const status: GitRepoStatus = {
    branch: "",
    detached: false,
    hasUpstream: false,
    ahead: 0,
    behind: 0,
    changedCount: 0,
    conflictCount: 0,
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token.startsWith("# branch.head ")) {
      const head = token.slice("# branch.head ".length);
      status.detached = head === "(detached)";
      status.branch = head;
      continue;
    }

    if (token.startsWith("# branch.ab ")) {
      const match = token.match(/^# branch\.ab \+(\d+) -(\d+)$/);
      if (match) {
        status.hasUpstream = true;
        status.ahead = Number.parseInt(match[1], 10);
        status.behind = Number.parseInt(match[2], 10);
      }
      continue;
    }

    if (token.startsWith("# ")) {
      continue;
    }

    if (token.startsWith("1 ") || token.startsWith("? ")) {
      status.changedCount++;
    } else if (token.startsWith("2 ")) {
      status.changedCount++;
      // Rename/copy entries are followed by the original path as its own token.
      i++;
    } else if (token.startsWith("u ")) {
      status.changedCount++;
      status.conflictCount++;
    }
  }

  return status;
}

export async function hasChanges(dir: string): Promise<boolean> {
  const statusOutput = await runGit(dir, ["status", "--porcelain=v1", "-z"]);
  return statusOutput.trim().length > 0;
}

/**
 * Stage all changes and commit them with the given message.
 * The message is passed as a single argv element — never through a shell.
 */
export async function commitAll(dir: string, message: string): Promise<GitCommitResult> {
  await runGit(dir, ["add", "-A"]);
  await runGit(dir, ["commit", "-m", message]);
  const hash = (await runGit(dir, ["rev-parse", "--short", "HEAD"])).trim();

  return { hash };
}

/**
 * Short diff stat summary used as LLM context for commit-message generation.
 */
export async function getDiffStat(dir: string): Promise<string> {
  try {
    return await runGit(dir, ["diff", "HEAD", "--stat"]);
  } catch {
    return "";
  }
}
