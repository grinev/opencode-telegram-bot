import type { Event } from "@opencode-ai/sdk/v2";
import { config } from "../../config.js";
import type { AppContainer } from "../bootstrap/app-container.js";
import type { EventEnvelope } from "../../opencode/events.js";
import { safeBackgroundTask } from "../../utils/safe-background-task.js";
import { markAttachedSessionBusy } from "./attach-service.js";
import { reconcileBusyState } from "./busy-reconciliation-service.js";
import { ingestSessionInfoForCache } from "./session-cache-service.js";

export type EventRouterDeps = Pick<
  AppContainer,
  | "assistantRunState"
  | "attachManager"
  | "backgroundSessionTracker"
  | "foregroundSessionState"
  | "scheduledTaskRuntime"
  | "summaryAggregator"
>;

export interface EventRouterOptions {
  /** The directory the subscription was opened for. */
  directory: string;
  deps: EventRouterDeps;
  isForegroundSession: (sessionId: string) => boolean;
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
}: EventRouterOptions): (envelope: EventEnvelope) => void {
  return ({ event }) => {
    // The SDK event union does not list the heartbeat the server sends.
    if ((event as { type: string }).type === "server.heartbeat") {
      // A heartbeat is a liveness signal of the subscription, so the check runs
      // for the directory the subscription was opened with.
      void reconcileBusyState(directory, deps);
    }

    const sessionId = getEventSessionId(event);
    const attached = deps.attachManager.getSnapshot();
    if (attached && sessionId === attached.sessionId && shouldMarkAttachedBusyFromEvent(event)) {
      void markAttachedSessionBusy(attached.sessionId, deps);
    }

    if (event.type === "session.created" || event.type === "session.updated") {
      const info = event.properties.info;

      if (info?.directory) {
        safeBackgroundTask({
          taskName: `session.cache.${event.type}`,
          task: () => ingestSessionInfoForCache(info),
        });
      }
    }

    if (config.bot.trackBackgroundSessions) {
      const foregroundSessionId = sessionId && isForegroundSession(sessionId) ? sessionId : null;
      deps.backgroundSessionTracker.processEvent(event, foregroundSessionId);
    }

    deps.summaryAggregator.processEvent(event);
  };
}
