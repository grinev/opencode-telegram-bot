import { opencodeClient } from "../../opencode/client.js";
import { logger } from "../../utils/logger.js";

export type SessionRunStatus = "question" | "permission" | "running" | "idle";

export async function resolveSessionParentChain(
  sessionId: string,
  directory: string,
  roots: Set<string>,
): Promise<{ root: string; links: Array<{ child: string; parent: string }> } | null> {
  const seen = new Set<string>();
  const links: Array<{ child: string; parent: string }> = [];
  let id = sessionId;
  while (!roots.has(id) && !seen.has(id)) {
    seen.add(id);
    const { data, error } = await opencodeClient.session.get({ sessionID: id, directory });
    if (error || !data?.parentID) return null;
    links.push({ child: id, parent: data.parentID });
    id = data.parentID;
  }
  return roots.has(id) ? { root: id, links } : null;
}

/**
 * Run statuses for the given root sessions of one project directory: a pending question or
 * permission request (including one a subagent waits on) wins over a running turn, which
 * wins over idle. A failed lookup counts as "nothing found" for its own part only, so one
 * bad endpoint never fails the list.
 */
export async function loadSessionStatuses(
  directory: string,
  rootIds: Iterable<string>,
): Promise<Map<string, SessionRunStatus>> {
  const roots = new Set(rootIds);
  const statuses = new Map<string, SessionRunStatus>();
  if (roots.size === 0) {
    return statuses;
  }

  const [statusResult, questionResult, permissionResult] = await Promise.all([
    opencodeClient.session.status({ directory }),
    opencodeClient.question.list({ directory }),
    opencodeClient.permission.list({ directory }),
  ]);
  const warnFailed = (lookup: string, error: unknown) =>
    logger.warn(
      `[SessionStatus] Failed to load ${lookup} for ${directory}; showing the list without it:`,
      error,
    );
  if (statusResult.error || !statusResult.data) warnFailed("run statuses", statusResult.error);
  if (questionResult.error || !questionResult.data) {
    warnFailed("pending questions", questionResult.error);
  }
  if (permissionResult.error || !permissionResult.data) {
    warnFailed("pending permissions", permissionResult.error);
  }

  // A subagent's pending request marks the root it runs under.
  const questions = new Set<string>();
  for (const request of questionResult.data ?? []) {
    const chain = await resolveSessionParentChain(request.sessionID, directory, roots);
    if (chain) questions.add(chain.root);
  }
  const permissions = new Set<string>();
  for (const request of permissionResult.data ?? []) {
    const chain = await resolveSessionParentChain(request.sessionID, directory, roots);
    if (chain) permissions.add(chain.root);
  }

  for (const id of roots) {
    const run = statusResult.data?.[id]?.type;
    statuses.set(
      id,
      questions.has(id)
        ? "question"
        : permissions.has(id)
          ? "permission"
          : run === "busy" || run === "retry"
            ? "running"
            : "idle",
    );
  }
  return statuses;
}
