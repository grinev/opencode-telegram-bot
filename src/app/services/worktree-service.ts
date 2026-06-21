import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { config } from "../../config.js";
import { logger } from "../../utils/logger.js";
import type { GitWorktreeContext, GitWorktreeEntry } from "../types/worktree.js";

const GIT_HEADS_PREFIX = "refs/heads/";
const GIT_WORKTREES_MARKER = `${path.sep}.git${path.sep}worktrees${path.sep}`;
const GIT_WORKTREE_LIST_MAX_BUFFER = 1024 * 1024;

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
    return match ? normalizeBranchName(match[1]) : null;
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

    return path.resolve(worktree, match[1].trim());
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

export interface CreateWorktreeResult {
  path: string;
  apiBranch?: string;
  error?: string;
}

interface OpenCodeWorktreeResponse {
  name: string;
  branch?: string;
  directory: string;
}

/**
 * Create a new git worktree using the OpenCode API.
 * Calls POST /experimental/worktree with { name } in the body.
 * The server creates the worktree directory and branch (opencode/<name>).
 */
export async function createGitWorktree(name?: string): Promise<CreateWorktreeResult> {
  const url = `${config.opencode.apiUrl}/experimental/worktree`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (config.opencode.password) {
    const credentials = `${config.opencode.username}:${config.opencode.password}`;
    headers["Authorization"] = `Basic ${Buffer.from(credentials).toString("base64")}`;
  }

  const body: Record<string, string> = {};
  if (name !== undefined) {
    body.name = name;
  }

  logger.debug(`[WorktreeService] Creating worktree via API: ${url}`, { name });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      const errorMessage = errorBody || `HTTP ${response.status} ${response.statusText}`;
      logger.error(`[WorktreeService] API error creating worktree: ${errorMessage}`);
      return { path: "", error: errorMessage };
    }

    const raw = (await response.json()) as OpenCodeWorktreeResponse;

    const worktreePath = raw.directory || "";

    if (!worktreePath) {
      logger.error(`[WorktreeService] API returned empty directory (response keys: ${Object.keys(raw).join(", ")})`);
      return { path: "", error: "API returned an empty worktree path" };
    }

    logger.info(`[WorktreeService] Worktree created successfully: ${worktreePath} (branch: ${raw.branch ?? "none"})`);
    return { path: worktreePath, apiBranch: raw.branch };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error(`[WorktreeService] Failed to create worktree: ${errorMessage}`);
    return { path: "", error: errorMessage };
  }
}
