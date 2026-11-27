import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { opencodeClient } from "../../opencode/client.js";
import { config } from "../../config.js";
import { getCachedSessionProjects } from "./session-cache-service.js";
import { logger } from "../../utils/logger.js";
import { findMissingFolders } from "./folder-presence-service.js";
import { createProjectPathExclusionMatcher, projectPathKey } from "./project-path-exclusions.js";
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
    mergedByWorktree.set(projectPathKey(apiProject.worktree), apiProject);
  }

  for (const cachedProject of cachedProjects) {
    const key = projectPathKey(cachedProject.worktree);
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

  const visibleProjects = projectList.filter((_, index) => !linkedWorktreeFlags[index]);
  const hiddenLinkedWorktrees = projectList.length - visibleProjects.length;

  const isExcluded = createProjectPathExclusionMatcher(config.bot.excludedProjectPaths);
  const filteredProjects = isExcluded
    ? visibleProjects.filter((p) => !isExcluded(p.worktree))
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
    const gitStat = await stat(gitPath);

    if (!gitStat.isFile()) {
      return false;
    }

    const gitPointer = (await readFile(gitPath, "utf-8")).trim();
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

export async function getProjects(): Promise<ProjectInfo[]> {
  const projects = await getResolvedProjects();
  return projects.map(({ id, worktree, name }) => ({ id, worktree, name }));
}

/** The projects to list: those whose folder the OpenCode server confirms is gone are left out. */
export async function getListedProjects(): Promise<ProjectInfo[]> {
  const projects = await getProjects();
  const missing = await findMissingFolders(projects.map((project) => project.worktree));
  return projects.filter((project) => !missing.has(project.worktree));
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
  const key = projectPathKey(worktree);
  const project = projects.find((p) => projectPathKey(p.worktree) === key);
  if (!project) {
    throw new Error(`Project with worktree ${worktree} not found`);
  }
  return { id: project.id, worktree: project.worktree, name: project.name };
}
