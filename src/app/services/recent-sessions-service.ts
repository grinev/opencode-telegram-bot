import type { GlobalSession } from "@opencode-ai/sdk/v2";
import { opencodeClient } from "../../opencode/client.js";
import { getCurrentSession } from "../stores/settings-store.js";
import { checkFolderPresence, collectFromPresentFolders } from "./folder-presence-service.js";
import { loadSessionStatuses, type SessionRunStatus } from "./session-status-service.js";

type RecentSessionInfo = Pick<GlobalSession, "id" | "directory" | "title" | "time">;
export type RecentSession = { session: RecentSessionInfo; status: SessionRunStatus };

async function loadGlobalSessions(limit: number): Promise<GlobalSession[]> {
  const { data, error } = await opencodeClient.experimental.session.list({ roots: true, limit });
  if (error || !data) throw error || new Error("No sessions received from OpenCode");
  return data;
}

export async function loadRecentSessions(limit: number): Promise<RecentSession[]> {
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
  const byDirectory = new Map<string, RecentSessionInfo[]>();
  for (const session of sessions) {
    const group = byDirectory.get(session.directory) ?? [];
    group.push(session);
    byDirectory.set(session.directory, group);
  }

  const statuses = new Map<string, SessionRunStatus>();
  await Promise.all(
    [...byDirectory].map(async ([directory, group]) => {
      const directoryStatuses = await loadSessionStatuses(
        directory,
        group.map((session) => session.id),
      );
      for (const [id, status] of directoryStatuses) {
        statuses.set(id, status);
      }
    }),
  );
  return sessions.map((session) => ({ session, status: statuses.get(session.id) ?? "idle" }));
}
