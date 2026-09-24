import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  sessionStatusMock: vi.fn(),
  markAttachedSessionBusyMock: vi.fn(),
  markAttachedSessionIdleMock: vi.fn(),
  clearRunMock: vi.fn(),
  clearPromptResponseModeMock: vi.fn(),
  flushDeferredDeliveriesMock: vi.fn(),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      status: mocked.sessionStatusMock,
    },
  },
}));

vi.mock("../../../src/app/services/attach-service.js", () => ({
  markAttachedSessionBusy: mocked.markAttachedSessionBusyMock,
  markAttachedSessionIdle: mocked.markAttachedSessionIdleMock,
}));

import {
  __resetBusyReconciliationForTests,
  reconcileBusyState,
  reconcileBusyStateNow,
  setPromptResponseModeClearerForReconciliation,
  setResponseStreamerForReconciliation,
} from "../../../src/app/services/busy-reconciliation-service.js";
import type { AppContainer } from "../../../src/app/bootstrap/app-container.js";
import { createTestAppContainer } from "../../helpers/app-container.js";

let deps: AppContainer;

function markForegroundBusyAt(
  sessionId: string,
  directory: string,
  markedAt: number = 10_000,
): void {
  deps.foregroundSessionState.markBusy(sessionId, directory);
  deps.foregroundSessionState.__setMarkedAtForTests(sessionId, markedAt);
}

beforeEach(() => {
  deps = createTestAppContainer({
    assistantRunState: {
      clearRun: mocked.clearRunMock,
    } as unknown as AppContainer["assistantRunState"],
    scheduledTaskRuntime: {
      flushDeferredDeliveries: mocked.flushDeferredDeliveriesMock,
    } as unknown as AppContainer["scheduledTaskRuntime"],
  });
});

describe("busy reconciliation", () => {
  beforeEach(() => {
    __resetBusyReconciliationForTests();

    mocked.sessionStatusMock.mockReset();
    mocked.markAttachedSessionBusyMock.mockReset();
    mocked.markAttachedSessionBusyMock.mockResolvedValue(undefined);
    mocked.markAttachedSessionIdleMock.mockReset();
    mocked.markAttachedSessionIdleMock.mockResolvedValue(undefined);
    mocked.clearRunMock.mockReset();
    mocked.clearPromptResponseModeMock.mockReset();
    setPromptResponseModeClearerForReconciliation(mocked.clearPromptResponseModeMock);
    mocked.flushDeferredDeliveriesMock.mockReset();
    mocked.flushDeferredDeliveriesMock.mockResolvedValue(undefined);
  });

  it("clears stale foreground busy state when the server reports idle", async () => {
    markForegroundBusyAt("session-1", "D:/repo");
    mocked.sessionStatusMock.mockResolvedValue({
      data: { "session-1": { type: "idle" } },
      error: null,
    });

    await reconcileBusyStateNow("D:/repo", deps, 13_000);

    expect(deps.foregroundSessionState.isBusy()).toBe(false);
    expect(mocked.markAttachedSessionIdleMock).toHaveBeenCalledWith("session-1", deps);
    expect(mocked.clearRunMock).not.toHaveBeenCalled();
    expect(mocked.clearPromptResponseModeMock).toHaveBeenCalledWith("session-1");
    expect(mocked.flushDeferredDeliveriesMock).toHaveBeenCalledTimes(1);
  });

  it("releases stale foreground busy state when the server has no status for the session", async () => {
    markForegroundBusyAt("session-1", "D:/repo");
    mocked.sessionStatusMock.mockResolvedValue({
      data: {},
      error: null,
    });

    await reconcileBusyStateNow("D:/repo", deps, 13_000);

    expect(deps.foregroundSessionState.isBusy()).toBe(false);
    expect(mocked.clearRunMock).not.toHaveBeenCalled();
    expect(mocked.clearPromptResponseModeMock).toHaveBeenCalledWith("session-1");
    expect(mocked.flushDeferredDeliveriesMock).toHaveBeenCalledTimes(1);
  });

  it("keeps newly marked foreground busy state during the grace period", async () => {
    markForegroundBusyAt("session-1", "D:/repo", 10_000);
    mocked.sessionStatusMock.mockResolvedValue({
      data: { "session-1": { type: "idle" } },
      error: null,
    });

    await reconcileBusyStateNow("D:/repo", deps, 11_000);

    expect(deps.foregroundSessionState.isBusy()).toBe(true);
    expect(mocked.markAttachedSessionIdleMock).not.toHaveBeenCalled();
    expect(mocked.clearRunMock).not.toHaveBeenCalled();
    expect(mocked.clearPromptResponseModeMock).not.toHaveBeenCalled();
    expect(mocked.flushDeferredDeliveriesMock).not.toHaveBeenCalled();
  });

  it("keeps foreground busy state when the server still reports busy", async () => {
    markForegroundBusyAt("session-1", "D:/repo");
    mocked.sessionStatusMock.mockResolvedValue({
      data: { "session-1": { type: "busy" } },
      error: null,
    });

    await reconcileBusyStateNow("D:/repo", deps, 13_000);

    expect(deps.foregroundSessionState.isBusy()).toBe(true);
    expect(mocked.markAttachedSessionIdleMock).not.toHaveBeenCalled();
    expect(mocked.clearRunMock).not.toHaveBeenCalled();
    expect(mocked.flushDeferredDeliveriesMock).not.toHaveBeenCalled();
  });

  it("marks the attached session busy when the server reports busy", async () => {
    deps.attachManager.attach("session-1", "D:/repo");
    mocked.sessionStatusMock.mockResolvedValue({
      data: { "session-1": { type: "busy" } },
      error: null,
    });

    await reconcileBusyStateNow("D:/repo", deps, 13_000);

    expect(mocked.markAttachedSessionBusyMock).toHaveBeenCalledWith("session-1", deps);
    expect(mocked.markAttachedSessionIdleMock).not.toHaveBeenCalled();
  });

  it("marks the attached session idle when the server reports idle", async () => {
    deps.attachManager.attach("session-1", "D:/repo");
    deps.attachManager.markBusy("session-1");
    mocked.sessionStatusMock.mockResolvedValue({
      data: { "session-1": { type: "idle" } },
      error: null,
    });

    await reconcileBusyStateNow("D:/repo", deps, 13_000);

    expect(mocked.markAttachedSessionIdleMock).toHaveBeenCalledWith("session-1", deps);
    expect(mocked.markAttachedSessionBusyMock).not.toHaveBeenCalled();
  });

  it("does not mark attached idle twice when attached session is also foreground busy", async () => {
    deps.attachManager.attach("session-1", "D:/repo");
    deps.attachManager.markBusy("session-1");
    markForegroundBusyAt("session-1", "D:/repo");
    mocked.sessionStatusMock.mockResolvedValue({
      data: { "session-1": { type: "idle" } },
      error: null,
    });

    await reconcileBusyStateNow("D:/repo", deps, 13_000);

    expect(mocked.markAttachedSessionIdleMock).toHaveBeenCalledTimes(1);
    expect(mocked.markAttachedSessionIdleMock).toHaveBeenCalledWith("session-1", deps);
    expect(deps.foregroundSessionState.isBusy()).toBe(false);
  });

  it("keeps attached busy during the foreground grace period for the same session", async () => {
    deps.attachManager.attach("session-1", "D:/repo");
    deps.attachManager.markBusy("session-1");
    markForegroundBusyAt("session-1", "D:/repo", 10_000);
    mocked.sessionStatusMock.mockResolvedValue({
      data: { "session-1": { type: "idle" } },
      error: null,
    });

    await reconcileBusyStateNow("D:/repo", deps, 11_000);

    expect(mocked.markAttachedSessionIdleMock).not.toHaveBeenCalled();
    expect(deps.foregroundSessionState.isBusy()).toBe(true);
  });

  it("does not restore detached sessions from server status", async () => {
    deps.attachManager.attach("session-1", "D:/repo");
    deps.attachManager.clear("test_detach");
    mocked.sessionStatusMock.mockResolvedValue({
      data: { "session-1": { type: "busy" } },
      error: null,
    });

    await reconcileBusyStateNow("D:/repo", deps, 13_000);

    expect(mocked.sessionStatusMock).not.toHaveBeenCalled();
    expect(mocked.markAttachedSessionBusyMock).not.toHaveBeenCalled();
  });

  it("keeps local state when loading session status fails", async () => {
    markForegroundBusyAt("session-1", "D:/repo");
    mocked.sessionStatusMock.mockResolvedValue({
      data: null,
      error: new Error("server unavailable"),
    });

    await reconcileBusyStateNow("D:/repo", deps, 13_000);

    expect(deps.foregroundSessionState.isBusy()).toBe(true);
    expect(mocked.markAttachedSessionIdleMock).not.toHaveBeenCalled();
    expect(mocked.clearRunMock).not.toHaveBeenCalled();
  });

  it("does not spend throttle interval when there are no tracked sessions", async () => {
    await reconcileBusyState("D:/repo", deps, 10_000);

    expect(mocked.sessionStatusMock).not.toHaveBeenCalled();

    deps.foregroundSessionState.markBusy("session-1", "D:/repo");
    deps.foregroundSessionState.__setMarkedAtForTests("session-1", 7_000);
    mocked.sessionStatusMock.mockResolvedValue({
      data: { "session-1": { type: "idle" } },
      error: null,
    });

    await reconcileBusyState("D:/repo", deps, 10_001);

    expect(mocked.sessionStatusMock).toHaveBeenCalledTimes(1);
    expect(deps.foregroundSessionState.isBusy()).toBe(false);
  });

  it("skips clear when responseStreamer has active stream for the session", async () => {
    markForegroundBusyAt("session-1", "D:/repo");
    mocked.sessionStatusMock.mockResolvedValue({
      data: { "session-1": { type: "idle" } },
      error: null,
    });

    const mockStreamer = {
      hasActiveStream: vi.fn((_sessionId: string) => true),
    };
    setResponseStreamerForReconciliation(mockStreamer);

    await reconcileBusyStateNow("D:/repo", deps, 13_000);

    expect(mockStreamer.hasActiveStream).toHaveBeenCalledWith("session-1");
    expect(deps.foregroundSessionState.isBusy()).toBe(true);
    expect(mocked.markAttachedSessionIdleMock).not.toHaveBeenCalled();
    expect(mocked.clearRunMock).not.toHaveBeenCalled();
    expect(mocked.clearPromptResponseModeMock).not.toHaveBeenCalled();
    expect(mocked.flushDeferredDeliveriesMock).not.toHaveBeenCalled();
  });

  it("clears busy state when responseStreamer has no active stream", async () => {
    markForegroundBusyAt("session-1", "D:/repo");
    mocked.sessionStatusMock.mockResolvedValue({
      data: { "session-1": { type: "idle" } },
      error: null,
    });

    const mockStreamer = {
      hasActiveStream: vi.fn((_sessionId: string) => false),
    };
    setResponseStreamerForReconciliation(mockStreamer);

    await reconcileBusyStateNow("D:/repo", deps, 13_000);

    expect(mockStreamer.hasActiveStream).toHaveBeenCalledWith("session-1");
    expect(deps.foregroundSessionState.isBusy()).toBe(false);
    expect(mocked.markAttachedSessionIdleMock).toHaveBeenCalledWith("session-1", deps);
    expect(mocked.clearRunMock).not.toHaveBeenCalled();
    expect(mocked.clearPromptResponseModeMock).toHaveBeenCalledWith("session-1");
    expect(mocked.flushDeferredDeliveriesMock).toHaveBeenCalledTimes(1);
  });
});
