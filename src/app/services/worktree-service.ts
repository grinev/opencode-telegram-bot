import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { GitWorktreeContext, GitWorktreeEntry, ListedWorktree } from "../types/worktree.js";
import { isContainerRuntime } from "../../runtime/container.js";
import { logger } from "../../utils/logger.js";
import { checkFolderPresence, findMissingFolders } from "./folder-presence-service.js";
import { getProjects } from "./project-service.js";

const GIT_HEADS_PREFIX = "refs/heads/";
const GIT_WORKTREES_MARKER = `${path.sep}.git${path.sep}worktrees${path.sep}`;
const GIT_WORKTREE_LIST_MAX_BUFFER = 1024 * 1024;

interface ParsedGitWorktreeEntry {
  path: string;
  branch: string | null;
}

export function normalizePathKey(value: string): string {
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
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(
      "git",
      ["worktree", "list", "--porcelain"],
      {
        cwd: worktree,
        windowsHide: true,
        maxBuffer: GIT_WORKTREE_LIST_MAX_BUFFER,
      },
      (error, output) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(output);
      },
    );
  });

  return parseGitWorktreeList(stdout);
}

async function readHeadBranch(gitDir: string): Promise<string | null> {
  try {
    const headPath = path.join(gitDir, "HEAD");
    const headContent = (await readFile(headPath, "utf-8")).trim();
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
    const gitStat = await stat(gitPath);

    if (gitStat.isDirectory()) {
      return gitPath;
    }

    if (!gitStat.isFile()) {
      return null;
    }

    const gitPointer = (await readFile(gitPath, "utf-8")).trim();
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

/**
 * The worktrees to list: those whose folder the OpenCode server confirms is gone are left
 * out, while each row keeps its index in the full list, which is what a selection reads.
 */
export async function listPresentWorktrees(
  worktrees: GitWorktreeEntry[],
): Promise<ListedWorktree[]> {
  const missing = await findMissingFolders(worktrees.map((entry) => entry.path));
  return worktrees
    .map((entry, gitIndex) => ({ entry, gitIndex }))
    .filter(({ entry }) => !missing.has(entry.path));
}

/**
 * The main repository among the projects that still lists this gone folder as one of its
 * worktrees — git keeps such an entry until it is pruned. Null when none does, and in a
 * container, where the bot does not see the projects' folders.
 */
export async function findWorktreeOwner(folder: string): Promise<string | null> {
  if (isContainerRuntime()) {
    return null;
  }

  const folderKey = normalizePathKey(folder);
  try {
    const candidates = (await getProjects()).filter(
      (project) => project.worktree !== "/" && normalizePathKey(project.worktree) !== folderKey,
    );
    const contexts = await Promise.all(
      candidates.map((project) => getGitWorktreeContext(project.worktree).catch(() => null)),
    );
    const owner = contexts.find((context) =>
      context?.worktrees.some((entry) => !entry.isMain && normalizePathKey(entry.path) === folderKey),
    );
    return owner?.mainProjectPath ?? null;
  } catch (error) {
    logger.debug(`[Worktree] Could not look for the repository owning ${folder}:`, error);
    return null;
  }
}

/**
 * The worktree context of the current folder. When that folder is a worktree the OpenCode
 * server confirms is gone, it is the context of the repository that still lists it, with no
 * row marked current, so /worktree can lead away from it.
 */
export async function getCurrentFolderWorktreeContext(
  folder: string,
): Promise<GitWorktreeContext | null> {
  const context = await getGitWorktreeContext(folder);
  if (context || (await checkFolderPresence(folder)) !== "missing") {
    return context;
  }

  const owner = await findWorktreeOwner(folder);
  const ownerContext = owner ? await getGitWorktreeContext(owner) : null;
  if (!ownerContext) {
    return null;
  }
  return {
    ...ownerContext,
    worktrees: ownerContext.worktrees.map((entry) => ({ ...entry, isCurrent: false })),
  };
}
