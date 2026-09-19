import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "@opencode-ai/sdk/v2";
import type { EventEnvelope } from "../../../src/opencode/events.js";

const mocked = vi.hoisted(() => ({
  reconcileBusyState: vi.fn(),
  markAttachedSessionBusy: vi.fn(),
  ingestSessionInfoForCache: vi.fn(),
  getCurrentSession: vi.fn(),
}));

vi.mock("../../../src/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/config.js")>();
  return {
    ...actual,
    config: { ...actual.config, bot: { ...actual.config.bot, trackBackgroundSessions: true } },
  };
});

vi.mock("../../../src/app/services/busy-reconciliation-service.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../src/app/services/busy-reconciliation-service.js")
  >()),
  reconcileBusyState: mocked.reconcileBusyState,
}));

vi.mock("../../../src/app/services/attach-service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/app/services/attach-service.js")>()),
  markAttachedSessionBusy: mocked.markAttachedSessionBusy,
}));

vi.mock("../../../src/app/services/session-cache-service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/app/services/session-cache-service.js")>()),
  ingestSessionInfoForCache: mocked.ingestSessionInfoForCache,
}));

vi.mock("../../../src/app/services/session-service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/app/services/session-service.js")>()),
  getCurrentSession: mocked.getCurrentSession,
}));

import { createEventRouter, type EventRouterDeps } from "../../../src/app/services/event-router.js";

function createDeps() {
  const deps = {
    attachManager: { getSnapshot: vi.fn().mockReturnValue(null) },
    backgroundSessionTracker: { processEvent: vi.fn() },
    summaryAggregator: { processEvent: vi.fn() },
  };

  return { deps, routerDeps: deps as unknown as EventRouterDeps };
}

function envelope(event: Record<string, unknown>, directory = "d:/repo/"): EventEnvelope {
  return { directory, event: event as unknown as Event };
}

describe("app/services/event-router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reconciles busy state for the subscribed directory on a heartbeat", () => {
    const { routerDeps } = createDeps();
    const route = createEventRouter({
      directory: "D:/repo",
      deps: routerDeps,
      isForegroundSession: () => false,
    });

    route(envelope({ type: "server.heartbeat", properties: {} }));

    expect(mocked.reconcileBusyState).toHaveBeenCalledWith("D:/repo", routerDeps);
  });

  it("hands the session read from the event to the background tracker only when it is foreground", () => {
    const { deps, routerDeps } = createDeps();
    const isForegroundSession = vi.fn((sessionId: string) => sessionId === "session-1");
    const route = createEventRouter({
      directory: "D:/repo",
      deps: routerDeps,
      isForegroundSession,
    });
    const foregroundEvent = { type: "session.idle", properties: { sessionID: "session-1" } };
    const backgroundEvent = {
      type: "message.updated",
      properties: { info: { id: "m-2", sessionID: "session-2", role: "assistant" } },
    };

    route(envelope(foregroundEvent));
    route(envelope(backgroundEvent));

    expect(isForegroundSession).toHaveBeenCalledWith("session-1");
    expect(isForegroundSession).toHaveBeenCalledWith("session-2");
    expect(deps.backgroundSessionTracker.processEvent).toHaveBeenNthCalledWith(
      1,
      foregroundEvent,
      "session-1",
    );
    expect(deps.backgroundSessionTracker.processEvent).toHaveBeenNthCalledWith(
      2,
      backgroundEvent,
      null,
    );
    expect(deps.summaryAggregator.processEvent).toHaveBeenCalledTimes(2);
    expect(mocked.getCurrentSession).not.toHaveBeenCalled();
  });

  it("does only subscription-wide work for an event without a session", () => {
    const { deps, routerDeps } = createDeps();
    deps.attachManager.getSnapshot.mockReturnValue({ sessionId: "session-1" });
    const isForegroundSession = vi.fn().mockReturnValue(true);
    const route = createEventRouter({
      directory: "D:/repo",
      deps: routerDeps,
      isForegroundSession,
    });
    const event = { type: "server.connected", properties: {} };

    route(envelope(event));

    expect(isForegroundSession).not.toHaveBeenCalled();
    expect(mocked.markAttachedSessionBusy).not.toHaveBeenCalled();
    expect(deps.backgroundSessionTracker.processEvent).toHaveBeenCalledWith(event, null);
    expect(deps.summaryAggregator.processEvent).toHaveBeenCalledWith(event);
  });

  it("marks the attached session busy from its own progress events", () => {
    const { deps, routerDeps } = createDeps();
    deps.attachManager.getSnapshot.mockReturnValue({ sessionId: "session-1" });
    const route = createEventRouter({
      directory: "D:/repo",
      deps: routerDeps,
      isForegroundSession: () => false,
    });

    route(envelope({ type: "message.part.delta", properties: { sessionID: "session-2" } }));
    route(envelope({ type: "message.part.delta", properties: { sessionID: "session-1" } }));

    expect(mocked.markAttachedSessionBusy).toHaveBeenCalledTimes(1);
    expect(mocked.markAttachedSessionBusy).toHaveBeenCalledWith("session-1", routerDeps);
  });
});
