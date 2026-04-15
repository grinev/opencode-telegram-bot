import { opencodeClient } from "../opencode/client.js";
import { ProjectInfo } from "../settings/manager.js";
import { getCachedSessionProjects } from "../session/cache-manager.js";
import { logger } from "../utils/logger.js";

interface InternalProject extends ProjectInfo {
  lastUpdated: number;
}

function worktreeKey(worktree: string): string {
  if (process.platform === "win32") {
    return worktree.toLowerCase();
  }

  return worktree;
}

export async function getProjects(): Promise<ProjectInfo[]> {
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

  // Include worktree paths from project sandboxes so git worktrees
  // appear as selectable projects with their own session histories.
  for (const apiProject of apiProjects) {
    const rawSandboxes = (apiProject as unknown as { sandboxes?: string[] }).sandboxes;
    if (Array.isArray(rawSandboxes)) {
      for (const sandbox of rawSandboxes) {
        if (typeof sandbox === "string" && sandbox.trim()) {
          const key = worktreeKey(sandbox);
          if (!mergedByWorktree.has(key)) {
            mergedByWorktree.set(key, {
              id: `${apiProject.id}_wt_${sandbox.split("/").pop()}`,
              worktree: sandbox,
              name: sandbox,
              lastUpdated: apiProject.lastUpdated,
            });
          }
        }
      }
    }
  }

  const projectList = Array.from(mergedByWorktree.values()).sort(
    (left, right) => right.lastUpdated - left.lastUpdated,
  );

  logger.debug(
    `[ProjectManager] Projects resolved: api=${projects.length}, cached=${cachedProjects.length}, total=${projectList.length}`,
  );

  return projectList.map(({ id, worktree, name }) => ({ id, worktree, name }));
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
  const projects = await getProjects();
  const key = worktreeKey(worktree);
  const project = projects.find((p) => worktreeKey(p.worktree) === key);
  if (!project) {
    throw new Error(`Project with worktree ${worktree} not found`);
  }
  return project;
}
