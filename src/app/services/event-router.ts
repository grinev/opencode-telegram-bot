import type { Event } from "@opencode-ai/sdk/v2";
import { config } from "../../config.js";
import type { AppContainer } from "../bootstrap/app-container.js";
import type { EventEnvelope } from "../../opencode/events.js";
import { safeBackgroundTask } from "../../utils/safe-background-task.js";
import { logger } from "../../utils/logger.js";
import { markAttachedSessionBusy } from "./attach-service.js";
import { reconcileBusyState } from "./busy-reconciliation-service.js";
import { ingestSessionInfoForCache } from "./session-cache-service.js";
import { updateSelectedSessionTitle } from "./session-service.js";
import type { SessionInfo } from "../types/session.js";

export type EventRouterDeps = Pick<
  AppContainer,
  | "assistantRunState"
  | "attachManager"
  | "backgroundSessionTracker"
  | "foregroundSessionState"
  | "goalService"
  | "scheduledTaskRuntime"
  | "summaryAggregator"
> & Partial<Pick<AppContainer, "manualCompaction" | "captureMinimalProgressEnd">>;

export interface EventRouterOptions {
  /** The directory the subscription was opened for. */
  directory: string;
  deps: EventRouterDeps;
  isForegroundSession: (sessionId: string) => boolean;
  onLiveToolActivity?: (sessionId: string, callId: string) => void;
  onSelectedTitleChanged?: (previous: SessionInfo, title: string) => void;
}

/** The session an event belongs to, read from the event itself. */
function getEventSessionId(event: Event): string | null {
  const properties = event.properties as {
    sessionID?: string;
    info?: { sessionID?: string };
    part?: { sessionID?: string };
  };

  return properties.sessionID || properties.info?.sessionID || properties.part?.sessionID || null;
}

function shouldMarkAttachedBusyFromEvent(event: Event): boolean {
  switch (event.type) {
    case "session.status":
      return (event.properties as { status?: { type?: string } }).status?.type === "busy";
    case "message.updated": {
      const info = (event.properties as { info?: { role?: string; time?: { completed?: number } } })
        .info;
      return info?.role === "assistant" && !info.time?.completed;
    }
    case "message.part.updated":
    case "message.part.delta":
    case "question.asked":
    case "permission.asked":
      return true;
    default:
      return false;
  }
}

/**
 * Routes events of one subscription. Session identity always comes from the
 * event; events without one only do subscription-wide work.
 */
export function createEventRouter({
  directory,
  deps,
  isForegroundSession,
  onLiveToolActivity,
  onSelectedTitleChanged,
}: EventRouterOptions): (envelope: EventEnvelope) => void {
  const backgroundTails = new Map<string, Promise<void>>();

  return ({ event }) => {
    // The SDK event union does not list the heartbeat the server sends.
    if ((event as { type: string }).type === "server.heartbeat") {
      // A heartbeat is a liveness signal of the subscription, so the check runs
      // for the directory the subscription was opened with.
      void reconcileBusyState(directory, deps);
      deps.manualCompaction?.reconcile(true);
    }

    const sessionId = getEventSessionId(event);
    if ((event.type as string) === "tool.live_activity") {
      const { callID } = event.properties as { callID?: string };
      if (sessionId && callID && isForegroundSession(sessionId)) {
        onLiveToolActivity?.(sessionId, callID);
      }
      return;
    }
    deps.manualCompaction?.onEvent(event, sessionId);
    if ((event.type as string) === "manual_compaction.changed") return;
    const attached = deps.attachManager.getSnapshot();
    if (attached && sessionId === attached.sessionId && shouldMarkAttachedBusyFromEvent(event)) {
      void markAttachedSessionBusy(attached.sessionId, deps);
    }

    if (event.type === "session.created" || event.type === "session.updated") {
      const info = event.properties.info;

      if (event.type === "session.updated" && info?.id && typeof info.title === "string") {
        const previous = updateSelectedSessionTitle(info.id, info.title);
        if (previous) onSelectedTitleChanged?.(previous, info.title);
      }

      if (info?.directory) {
        safeBackgroundTask({
          taskName: `session.cache.${event.type}`,
          task: () => ingestSessionInfoForCache(info),
        });
      }
    }

    if ((event as { type: string }).type === "goal.changed") {
      const properties = event.properties as { sessionID?: string; goal?: unknown };
      if (properties.sessionID) {
        void deps.goalService.applyChanged(properties.sessionID, properties.goal ?? null);
      }
      return;
    }

    if (config.bot.trackBackgroundSessions) {
      const foregroundSessionId = sessionId && isForegroundSession(sessionId) ? sessionId : null;
      const ignored = deps.manualCompaction?.isLegacyCompactionSummary(event) ?? false;
      const forward = (skip: boolean) => {
        if (!skip) deps.backgroundSessionTracker.processEvent(event, foregroundSessionId);
      };
      const previous = sessionId ? backgroundTails.get(sessionId) : undefined;
      if (sessionId && (previous || typeof ignored !== "boolean")) {
        const tail = (previous ?? Promise.resolve())
          .then(() => ignored)
          .then(forward)
          .catch((error: unknown) => {
            logger.warn(`[Events] Could not route background event for ${sessionId}`, error);
          })
          .finally(() => {
            if (backgroundTails.get(sessionId) === tail) backgroundTails.delete(sessionId);
          });
        backgroundTails.set(sessionId, tail);
      } else if (typeof ignored === "boolean") {
        forward(ignored);
      }
    }

    deps.summaryAggregator.processEvent(event);
  };
}
