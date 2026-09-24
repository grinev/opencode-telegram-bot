import type { GlobalSession } from "@opencode-ai/sdk/v2";
import { opencodeClient } from "../../opencode/client.js";
import { getCurrentSession } from "../stores/settings-store.js";

export type RecentStatus = "question" | "permission" | "running" | "idle";
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

export async function loadRecentSessions(limit: number): Promise<RecentSession[]> {
  const sessions: RecentSessionInfo[] = await loadGlobalSessions(limit);
  const attached = getCurrentSession();
  if (attached && !sessions.some((session) => session.id === attached.id) && sessions.length > 0) {
    const { data, error } = await opencodeClient.session.get({
      sessionID: attached.id,
      directory: attached.directory,
    });
    if (!error && data && !data.parentID) {
      sessions.splice(limit - 1, 1, data);
    }
  }
  sessions.sort((a, b) => b.time.updated - a.time.updated);
  const byDirectory = new Map<string, RecentSessionInfo[]>();
  for (const session of sessions) {
    const group = byDirectory.get(session.directory) ?? [];
    group.push(session);
    byDirectory.set(session.directory, group);
  }

  const statuses = new Map<string, RecentStatus>();
  await Promise.all([...byDirectory].map(async ([directory, group]) => {
    const [statusResult, questionResult, permissionResult] = await Promise.all([
      opencodeClient.session.status({ directory }),
      opencodeClient.question.list({ directory }),
      opencodeClient.permission.list({ directory }),
    ]);
    if (statusResult.error || !statusResult.data) throw statusResult.error || new Error("No status received");
    if (questionResult.error || !questionResult.data) throw questionResult.error || new Error("No questions received");
    if (permissionResult.error || !permissionResult.data) throw permissionResult.error || new Error("No permissions received");

    const roots = new Set(group.map((session) => session.id));
    const questions = new Set(questionResult.data.map((request) => request.sessionID));
    const permissions = new Set<string>();
    for (const request of permissionResult.data) {
      const chain = await resolveSessionParentChain(request.sessionID, directory, roots);
      if (chain) permissions.add(chain.root);
    }
    for (const session of group) {
      const run = statusResult.data[session.id]?.type;
      statuses.set(session.id, questions.has(session.id)
        ? "question"
        : permissions.has(session.id)
          ? "permission"
          : run === "busy" || run === "retry" ? "running" : "idle");
    }
  }));
  return sessions.map((session) => ({ session, status: statuses.get(session.id) ?? "idle" }));
}
