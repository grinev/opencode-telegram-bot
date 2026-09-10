import path from "bun:path";
import { opencodeClient } from "../../opencode/client.js";
import { config } from "../../config.js";
import { getCachedSessionProjects } from "./session-cache-service.js";
import { getVisibleProjects } from "../stores/settings-store.js";
import { logger } from "../../utils/logger.js";
import type { ProjectInfo } from "../types/project.js";

interface InternalProject extends ProjectInfo {
  lastUpdated: number;
}

async function getResolvedProjects(options?: {
  includeLinkedWorktrees?: boolean;
}): Promise<InternalProject[]> {
  const includeLinkedWorktrees = options?.includeLinkedWorktrees === true;
  const { data: projects, error } = await opencodeClient.project.list();

  if (error || !projects) {
    throw error || new Error("No data received from server");
  }

  const apiProjects: InternalProject[] = projects.map((project) => ({
    id: project.id,
    worktree: project.worktree,
    name: project.name || project.worktree,
    lastUpdated: project.time?.updated ?? 0,
  }));

  const cachedProjects = await getCachedSessionProjects();
  const mergedByWorktree = new Map<string, InternalProject>();

  for (const apiProject of apiProjects) {
    mergedByWorktree.set(worktreeKey(apiProject.worktree), apiProject);
  }

  for (const cachedProject of cachedProjects) {
    const key = worktreeKey(cachedProject.worktree);
    const existing = mergedByWorktree.get(key);

    if (existing) {
      if ((cachedProject.lastUpdated ?? 0) > existing.lastUpdated) {
        existing.lastUpdated = cachedProject.lastUpdated;
      }
      continue;
    }

    mergedByWorktree.set(key, {
      id: cachedProject.id,
      worktree: cachedProject.worktree,
      name: cachedProject.name,
      lastUpdated: cachedProject.lastUpdated ?? 0,
    });
  }

  const projectList = Array.from(mergedByWorktree.values()).sort(
    (left, right) => right.lastUpdated - left.lastUpdated,
  );

  if (includeLinkedWorktrees) {
    return projectList;
  }

  const linkedWorktreeFlags = await Promise.all(
    projectList.map((project) => isLinkedGitWorktree(project.worktree)),
  );

  let visibleProjects = projectList.filter((_, index) => !linkedWorktreeFlags[index]);
  const hiddenLinkedWorktrees = projectList.length - visibleProjects.length;

  // Apply whitelist filter if visibleProjects is configured (env var takes precedence)
  const envFilter = process.env.OPENCODE_TELEGRAM_VISIBLE_PROJECTS;
  const allowedPaths = envFilter
    ? envFilter.split(";").map((p) => p.trim()).filter(Boolean)
    : getVisibleProjects();
  if (allowedPaths.length > 0) {
    visibleProjects = visibleProjects.filter((project) => {
      const normalizedWorktree = project.worktree.replace(/[\\/]+$/g, "").toLowerCase();
      return allowedPaths.some(
        (allowed) => normalizedWorktree === allowed.replace(/[\\/]+$/g, "").toLowerCase(),
      );
    });
    logger.debug(
      `[ProjectManager] Whitelist filter applied: source=${envFilter ? "env" : "settings"}, allowed=${allowedPaths.length}, matching=${visibleProjects.length}`,
    );
  }

  const excludedPaths = config.bot.excludedProjectPaths;
  const excludedKeys = new Set(excludedPaths.map((excluded) => worktreeKey(excluded)));
  const filteredProjects =
    excludedKeys.size > 0
      ? visibleProjects.filter((project) => !excludedKeys.has(worktreeKey(project.worktree)))
      : visibleProjects;
  const hiddenExcluded = visibleProjects.length - filteredProjects.length;

  logger.debug(
    `[ProjectManager] Projects resolved: api=${projects.length}, cached=${cachedProjects.length}, hiddenLinkedWorktrees=${hiddenLinkedWorktrees}, hiddenExcluded=${hiddenExcluded}, total=${filteredProjects.length}`,
  );

  return filteredProjects;
}

async function isLinkedGitWorktree(worktree: string): Promise<boolean> {
  if (worktree === "/") {
    return false;
  }

  const gitPath = path.join(worktree, ".git");

  try {
    const gitStat = await Bun.file(gitPath).stat();

    if (!gitStat.isFile()) {
      return false;
    }

    const gitPointer = (await Bun.file(gitPath).text()).trim();
    const match = gitPointer.match(/^gitdir:\s*(.+)$/i);
    if (!match) {
      return false;
    }

    const gitDirPointer = match[1];
    if (!gitDirPointer) {
      return false;
    }
    const gitDir = path.resolve(worktree, gitDirPointer.trim()).replace(/\\/g, "/").toLowerCase();
    return gitDir.includes("/.git/worktrees/");
  } catch {
    return false;
  }
}

function worktreeKey(worktree: string): string {
  const pathModule = isWindowsWorktreePath(worktree) ? path.win32 : path.posix;
  const normalizedWorktree = pathModule.normalize(worktree);
  const root = pathModule.parse(normalizedWorktree).root;
  const trimmedWorktree =
    normalizedWorktree === root ? normalizedWorktree : normalizedWorktree.replace(/[\\/]+$/, "");

  if (pathModule === path.win32) {
    return trimmedWorktree.toLowerCase();
  }

  return trimmedWorktree;
}

function isWindowsWorktreePath(worktree: string): boolean {
  return process.platform === "win32" || /^[a-zA-Z]:[\\/]/.test(worktree) || /^\\\\/.test(worktree);
}

export async function getProjects(): Promise<ProjectInfo[]> {
  const projects = await getResolvedProjects();
  return projects.map(({ id, worktree, name }) => ({ id, worktree, name }));
}

export async function getProjectById(id: string): Promise<ProjectInfo> {
  const projects = await getProjects();
  const project = projects.find((p) => p.id === id);
  if (!project) {
    throw new Error(`Project with id ${id} not found`);
  }
  return project;
}

export async function getProjectByWorktree(worktree: string): Promise<ProjectInfo> {
  const projects = await getResolvedProjects({ includeLinkedWorktrees: true });
  const key = worktreeKey(worktree);
  const project = projects.find((p) => worktreeKey(p.worktree) === key);
  if (!project) {
    throw new Error(`Project with worktree ${worktree} not found`);
  }
  return { id: project.id, worktree: project.worktree, name: project.name };
}
