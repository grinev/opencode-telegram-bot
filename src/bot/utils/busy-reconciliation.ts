import { opencodeClient } from "../../opencode/client.js";
import {
  foregroundSessionState,
  type ForegroundBusySession,
} from "../../scheduled-task/foreground-state.js";
import { scheduledTaskRuntime } from "../../scheduled-task/runtime.js";
import { attachManager } from "../../attach/manager.js";
import { markAttachedSessionBusy, markAttachedSessionIdle } from "../../attach/service.js";
import { assistantRunState } from "../assistant-run-state.js";
import { clearPromptResponseMode } from "../handlers/prompt.js";
import { logger } from "../../utils/logger.js";

const RECONCILE_MIN_INTERVAL_MS = 10_000;
const FOREGROUND_BUSY_RECONCILE_GRACE_MS = 2_000;

type SessionStatus = {
  type?: string;
};

const inFlightDirectories = new Set<string>();
const lastReconcileAtByDirectory = new Map<string, number>();

function getReconciliationTargets(directory: string): {
  foregroundBusySessions: ForegroundBusySession[];
  attachedSessionForDirectory: ReturnType<typeof attachManager.getSnapshot>;
} {
  const foregroundBusySessions = foregroundSessionState
    .getBusySessions()
    .filter((session) => session.directory === directory);
  const attachedSession = attachManager.getSnapshot();
  const attachedSessionForDirectory =
    attachedSession?.directory === directory ? attachedSession : null;

  return { foregroundBusySessions, attachedSessionForDirectory };
}

function getSessionStatus(statuses: unknown, sessionId: string): SessionStatus | null {
  if (!statuses || typeof statuses !== "object") {
    return null;
  }

  const status = (statuses as Record<string, SessionStatus | undefined>)[sessionId];
  return status ?? null;
}

function isTerminalStatus(status: SessionStatus | null): boolean {
  return !status || status.type === "idle" || status.type === "error";
}

function isWithinForegroundBusyGracePeriod(
  session: ForegroundBusySession,
  now: number,
): boolean {
  return now - session.markedAt < FOREGROUND_BUSY_RECONCILE_GRACE_MS;
}

async function clearForegroundBusySession(sessionId: string, reason: string): Promise<void> {
  foregroundSessionState.markIdle(sessionId);
  assistantRunState.clearRun(sessionId, reason);
  clearPromptResponseMode(sessionId);
}

export async function reconcileBusyStateNow(directory: string): Promise<void> {
  if (!directory) {
    return;
  }

  const { foregroundBusySessions, attachedSessionForDirectory } =
    getReconciliationTargets(directory);

  if (foregroundBusySessions.length === 0 && !attachedSessionForDirectory) {
    return;
  }

  const { data: statuses, error } = await opencodeClient.session.status({ directory });
  if (error || !statuses) {
    logger.warn("[BusyReconciliation] Failed to load session status", error);
    return;
  }

  const now = Date.now();
  const freshForegroundSessionIds = new Set(
    foregroundBusySessions
      .filter((session) => isWithinForegroundBusyGracePeriod(session, now))
      .map((session) => session.sessionId),
  );

  if (attachedSessionForDirectory) {
    const attachedStatus = getSessionStatus(statuses, attachedSessionForDirectory.sessionId);

    if (attachedStatus?.type === "busy") {
      await markAttachedSessionBusy(attachedSessionForDirectory.sessionId);
    } else if (
      isTerminalStatus(attachedStatus) &&
      !freshForegroundSessionIds.has(attachedSessionForDirectory.sessionId)
    ) {
      await markAttachedSessionIdle(attachedSessionForDirectory.sessionId);
    }
  }

  let clearedForegroundSession = false;
  for (const session of foregroundBusySessions) {
    const status = getSessionStatus(statuses, session.sessionId);
    if (!isTerminalStatus(status)) {
      continue;
    }

    if (freshForegroundSessionIds.has(session.sessionId)) {
      logger.debug(
        `[BusyReconciliation] Skipping fresh foreground busy state: session=${session.sessionId}, directory=${session.directory}, status=${status?.type ?? "not-found"}`,
      );
      continue;
    }

    logger.info(
      `[BusyReconciliation] Clearing stale foreground busy state: session=${session.sessionId}, directory=${session.directory}, status=${status?.type ?? "not-found"}`,
    );
    if (attachedSessionForDirectory?.sessionId !== session.sessionId) {
      await markAttachedSessionIdle(session.sessionId);
    }
    await clearForegroundBusySession(session.sessionId, "status_reconcile_idle");
    clearedForegroundSession = true;
  }

  if (clearedForegroundSession) {
    await scheduledTaskRuntime.flushDeferredDeliveries();
  }
}

export async function reconcileBusyState(directory: string): Promise<void> {
  if (!directory || inFlightDirectories.has(directory)) {
    return;
  }

  const { foregroundBusySessions, attachedSessionForDirectory } =
    getReconciliationTargets(directory);
  if (foregroundBusySessions.length === 0 && !attachedSessionForDirectory) {
    return;
  }

  const now = Date.now();
  const lastReconcileAt = lastReconcileAtByDirectory.get(directory);
  if (lastReconcileAt !== undefined && now - lastReconcileAt < RECONCILE_MIN_INTERVAL_MS) {
    return;
  }

  lastReconcileAtByDirectory.set(directory, now);
  inFlightDirectories.add(directory);

  try {
    await reconcileBusyStateNow(directory);
  } catch (error) {
    logger.warn("[BusyReconciliation] Failed to reconcile busy state", error);
  } finally {
    inFlightDirectories.delete(directory);
  }
}

export function __resetBusyReconciliationForTests(): void {
  inFlightDirectories.clear();
  lastReconcileAtByDirectory.clear();
}
