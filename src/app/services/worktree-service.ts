import path from "bun:path";
import type { GitWorktreeContext, GitWorktreeEntry } from "../types/worktree.js";

const GIT_HEADS_PREFIX = "refs/heads/";
const GIT_WORKTREES_MARKER = `${path.sep}.git${path.sep}worktrees${path.sep}`;

interface ParsedGitWorktreeEntry {
  path: string;
  branch: string | null;
}

function normalizePathKey(value: string): string {
  const normalized = path.resolve(value).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function normalizeBranchName(value: string): string {
  return value.startsWith(GIT_HEADS_PREFIX) ? value.slice(GIT_HEADS_PREFIX.length) : value;
}

function parseGitWorktreeList(stdout: string): ParsedGitWorktreeEntry[] {
  const entries: ParsedGitWorktreeEntry[] = [];
  let currentPath: string | null = null;
  let currentBranch: string | null = null;

  const pushCurrent = () => {
    if (!currentPath) {
      return;
    }

    entries.push({
      path: currentPath,
      branch: currentBranch,
    });

    currentPath = null;
    currentBranch = null;
  };

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line) {
      pushCurrent();
      continue;
    }

    if (line.startsWith("worktree ")) {
      pushCurrent();
      currentPath = line.slice("worktree ".length);
      continue;
    }

    if (line.startsWith("branch ")) {
      currentBranch = normalizeBranchName(line.slice("branch ".length));
      continue;
    }

    if (line === "detached") {
      currentBranch = null;
    }
  }

  pushCurrent();
  return entries;
}

async function runGitWorktreeList(worktree: string): Promise<ParsedGitWorktreeEntry[]> {
  const proc = Bun.spawn(["git", "worktree", "list", "--porcelain"], {
    cwd: worktree,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await proc.stderr.text();
    throw new Error(`git worktree list failed: ${stderr}`);
  }
  const stdout = await proc.stdout.text();
  return parseGitWorktreeList(stdout);
}

async function readHeadBranch(gitDir: string): Promise<string | null> {
  try {
    const headPath = path.join(gitDir, "HEAD");
    const headContent = (await Bun.file(headPath).text()).trim();
    const match = headContent.match(/^ref:\s+(.+)$/);
    const ref = match?.[1];
    return ref ? normalizeBranchName(ref) : null;
  } catch {
    return null;
  }
}

function deriveMainProjectPath(activeWorktreePath: string, gitDir: string): string {
  const normalizedGitDir = path.resolve(gitDir);

  if (path.basename(normalizedGitDir).toLowerCase() === ".git") {
    return path.resolve(activeWorktreePath);
  }

  if (normalizedGitDir.includes(GIT_WORKTREES_MARKER)) {
    return path.resolve(normalizedGitDir, "..", "..", "..");
  }

  return path.resolve(activeWorktreePath);
}

export async function resolveGitDir(worktree: string): Promise<string | null> {
  const gitPath = path.join(worktree, ".git");

  try {
    const gitStat = await Bun.file(gitPath).stat();

    if (gitStat.isDirectory()) {
      return gitPath;
    }

    if (!gitStat.isFile()) {
      return null;
    }

    const gitPointer = (await Bun.file(gitPath).text()).trim();
    const match = gitPointer.match(/^gitdir:\s*(.+)$/i);
    if (!match) {
      return null;
    }

    const gitDirPointer = match[1];
    if (!gitDirPointer) {
      return null;
    }
    return path.resolve(worktree, gitDirPointer.trim());
  } catch {
    return null;
  }
}

export async function getGitWorktreeContext(worktree: string): Promise<GitWorktreeContext | null> {
  const activeWorktreePath = path.resolve(worktree);
  const gitDir = await resolveGitDir(activeWorktreePath);
  if (!gitDir) {
    return null;
  }

  const mainProjectPath = deriveMainProjectPath(activeWorktreePath, gitDir);
  const activeWorktreeKey = normalizePathKey(activeWorktreePath);
  const mainProjectKey = normalizePathKey(mainProjectPath);

  const parsedEntries = await runGitWorktreeList(activeWorktreePath);
  const worktrees = parsedEntries.map((entry) => {
    const entryPath = path.resolve(entry.path);
    const entryKey = normalizePathKey(entryPath);

    return {
      path: entryPath,
      branch: entry.branch,
      isCurrent: entryKey === activeWorktreeKey,
      isMain: entryKey === mainProjectKey,
    } satisfies GitWorktreeEntry;
  });

  let currentEntry = worktrees.find((entry) => entry.isCurrent) ?? null;

  if (!currentEntry) {
    currentEntry = {
      path: activeWorktreePath,
      branch: await readHeadBranch(gitDir),
      isCurrent: true,
      isMain: activeWorktreeKey === mainProjectKey,
    };
    worktrees.push(currentEntry);
  } else if (!currentEntry.branch) {
    currentEntry.branch = await readHeadBranch(gitDir);
  }

  worktrees.sort((left, right) => {
    if (left.isMain !== right.isMain) {
      return left.isMain ? -1 : 1;
    }

    if (left.path === right.path) {
      return 0;
    }

    return left.path.localeCompare(right.path);
  });

  return {
    mainProjectPath,
    activeWorktreePath,
    branch: currentEntry.branch,
    isLinkedWorktree: activeWorktreeKey !== mainProjectKey,
    worktrees,
  };
}
