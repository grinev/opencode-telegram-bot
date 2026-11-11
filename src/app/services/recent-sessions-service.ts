import type { GlobalSession } from "@opencode-ai/sdk/v2";
import { opencodeClient } from "../../opencode/client.js";
import { getCurrentSession } from "../stores/settings-store.js";
import { logger } from "../../utils/logger.js";
import { checkFolderPresence, collectFromPresentFolders } from "./folder-presence-service.js";
import { loadUnreadReplySessionIds } from "./session-reply-read-service.js";

export type RecentStatus = "question" | "permission" | "running" | "unread" | "idle";
type RecentSessionInfo = Pick<GlobalSession, "id" | "directory" | "title" | "time">;
export type RecentSession = { session: RecentSessionInfo; status: RecentStatus };

async function loadGlobalSessions(limit: number): Promise<GlobalSession[]> {
  const { data, error } = await opencodeClient.experimental.session.list({ roots: true, limit });
  if (error || !data) throw error || new Error("No sessions received from OpenCode");
  return data;
}

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

/** The sessions /recent lists at this moment, newest first, without their statuses. */
async function loadRecentSessionInfos(limit: number): Promise<RecentSessionInfo[]> {
  // Sessions whose folder is gone are left out and do not take places within the limit.
  const sessions: RecentSessionInfo[] = (
    await collectFromPresentFolders(loadGlobalSessions, (session) => session.directory, limit)
  ).slice(0, limit);
  const attached = getCurrentSession();
  if (attached && !sessions.some((session) => session.id === attached.id) && sessions.length > 0) {
    const { data, error } = await opencodeClient.session.get({
      sessionID: attached.id,
      directory: attached.directory,
    });
    if (!error && data && !data.parentID && (await checkFolderPresence(data.directory)) !== "missing") {
      sessions.splice(limit - 1, 1, data);
    }
  }
  sessions.sort((a, b) => b.time.updated - a.time.updated);
  return sessions;
}

/** The folders /recent lists at this moment, for callers that only need its project names. */
export async function loadRecentSessionDirectories(limit: number): Promise<string[]> {
  const sessions = await loadRecentSessionInfos(limit);
  return [...new Set(sessions.map((session) => session.directory))];
}

export async function loadRecentSessions(limit: number): Promise<RecentSession[]> {
  const sessions = await loadRecentSessionInfos(limit);
  const byDirectory = new Map<string, RecentSessionInfo[]>();
  for (const session of sessions) {
    const group = byDirectory.get(session.directory) ?? [];
    group.push(session);
    byDirectory.set(session.directory, group);
  }

  const statuses = new Map<string, RecentStatus>();
  // Reply checks run alongside the per-folder lookups: one round trip either way.
  const unreadPass = loadUnreadReplySessionIds(
    sessions.map((session) => ({ id: session.id, directory: session.directory })),
  );
  await Promise.all([...byDirectory].map(async ([directory, group]) => {
    const [statusResult, questionResult, permissionResult] = await Promise.all([
      opencodeClient.session.status({ directory }),
      opencodeClient.question.list({ directory }),
      opencodeClient.permission.list({ directory }),
    ]);
    // A failed lookup counts as "nothing found" for its own part only, so one bad folder never fails the list.
    const warnFailed = (lookup: string, error: unknown) =>
      logger.warn(`[Recent] Failed to load ${lookup} for ${directory}; showing it without them:`, error);
    if (statusResult.error || !statusResult.data) warnFailed("run statuses", statusResult.error);
    if (questionResult.error || !questionResult.data) warnFailed("pending questions", questionResult.error);
    if (permissionResult.error || !permissionResult.data) warnFailed("pending permissions", permissionResult.error);

    const roots = new Set(group.map((session) => session.id));
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
    for (const session of group) {
      const run = statusResult.data?.[session.id]?.type;
      statuses.set(session.id, questions.has(session.id)
        ? "question"
        : permissions.has(session.id)
          ? "permission"
          : run === "busy" || run === "retry" ? "running" : "idle");
    }
  }));
  // A session that is busy, waiting on an answer or a permission keeps its own symbol; the unread
  // mark only takes the place of ordinary idle.
  const unread = await unreadPass;
  for (const sessionId of unread) {
    if (statuses.get(sessionId) === "idle") {
      statuses.set(sessionId, "unread");
    }
  }
  return sessions.map((session) => ({ session, status: statuses.get(session.id) ?? "idle" }));
}
