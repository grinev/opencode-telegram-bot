import { opencodeClient } from "./client.js";

export type CompactionOutcome = "success" | "failure" | "interrupted" | "unknown";
export type V2CompactionState =
  Exclude<CompactionOutcome, "unknown"> | "pending" | "running" | "missing" | "unverified";
export interface CompactionSession {
  id: string;
  directory: string;
  title: string;
}

type History = NonNullable<Awaited<ReturnType<typeof opencodeClient.session.messages>>["data"]>;

function manualMarkers(history: History): string[] {
  return history
    .filter(({ parts }) => parts.some((part) => part.type === "compaction" && !part.auto))
    .map(({ info }) => info.id);
}

async function loadHistory(session: CompactionSession): Promise<History | null> {
  const { data } = await opencodeClient.session.messages(
    { sessionID: session.id, directory: session.directory, limit: 60 },
    { signal: AbortSignal.timeout(5_000) },
  );
  return data ?? null;
}

export async function captureLegacyCompactionBaseline(
  session: CompactionSession,
): Promise<ReadonlySet<string> | null> {
  const history = await loadHistory(session);
  return history && new Set(manualMarkers(history));
}

export async function verifyLegacyManualMarker(
  session: CompactionSession,
  messageID: string,
): Promise<boolean> {
  const { data, error } = await opencodeClient.session.message(
    { sessionID: session.id, directory: session.directory, messageID },
    { signal: AbortSignal.timeout(5_000) },
  );
  if (!data) throw error ?? new Error("OpenCode did not return the compaction parent");
  return data.parts.some((part) => part.type === "compaction" && part.auto === false);
}

export async function readLegacyCompaction(
  session: CompactionSession,
  before: ReadonlySet<string> | null,
): Promise<{ outcome?: CompactionOutcome; summaryId?: string; hasMarker: boolean; idle: boolean }> {
  const history = before && (await loadHistory(session));
  const markers = history && manualMarkers(history).filter((id) => !before.has(id));
  const marker = markers && markers.length === 1 ? markers[0] : undefined;

  if (marker && history) {
    for (const { info } of history) {
      if (info.role !== "assistant" || info.parentID !== marker || !info.summary) continue;
      if (info.error) {
        return {
          outcome: info.error.name === "MessageAbortedError" ? "interrupted" : "failure",
          summaryId: info.id,
          hasMarker: true,
          idle: false,
        };
      }
      if (info.finish) {
        return {
          outcome: info.finish === "error" ? "failure" : "success",
          summaryId: info.id,
          hasMarker: true,
          idle: false,
        };
      }
    }
  }

  const { data } = await opencodeClient.session.status(
    { directory: session.directory },
    { signal: AbortSignal.timeout(5_000) },
  );
  const status = data?.[session.id]?.type;
  return { hasMarker: Boolean(marker), idle: Boolean(data && (!status || status === "idle")) };
}
