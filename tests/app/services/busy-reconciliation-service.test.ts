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

vi.mock("../../../src/app/managers/assistant-run-state-manager.js", () => ({
  assistantRunState: {
    clearRun: mocked.clearRunMock,
  },
}));

vi.mock("../../../src/app/services/scheduled-task-runtime-service.js", () => ({
  scheduledTaskRuntime: {
    flushDeferredDeliveries: mocked.flushDeferredDeliveriesMock,
  },
}));

import { attachManager } from "../../../src/app/managers/attach-manager.js";
import { foregroundSessionState } from "../../../src/app/managers/foreground-session-state-manager.js";
import {
  __resetBusyReconciliationForTests,
  reconcileBusyState,
  reconcileBusyStateNow,
  setPromptResponseModeClearerForReconciliation,
  setResponseStreamerForReconciliation,
} from "../../../src/app/services/busy-reconciliation-service.js";

function markForegroundBusyAt(
  sessionId: string,
  directory: string,
  markedAt: number = 10_000,
): void {
  foregroundSessionState.markBusy(sessionId, directory);
  foregroundSessionState.__setMarkedAtForTests(sessionId, markedAt);
}

describe("busy reconciliation", () => {
  beforeEach(() => {
    foregroundSessionState.__resetForTests();
    attachManager.__resetForTests();
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

    await reconcileBusyStateNow("D:/repo", 13_000);

    expect(foregroundSessionState.isBusy()).toBe(false);
    expect(mocked.markAttachedSessionIdleMock).toHaveBeenCalledWith("session-1");
    expect(mocked.clearRunMock).toHaveBeenCalledWith("session-1", "status_reconcile_idle");
    expect(mocked.clearPromptResponseModeMock).toHaveBeenCalledWith("session-1");
    expect(mocked.flushDeferredDeliveriesMock).toHaveBeenCalledTimes(1);
  });

  it("keeps newly marked foreground busy state during the grace period", async () => {
    markForegroundBusyAt("session-1", "D:/repo", 10_000);
    mocked.sessionStatusMock.mockResolvedValue({
      data: { "session-1": { type: "idle" } },
      error: null,
    });

    await reconcileBusyStateNow("D:/repo", 11_000);

    expect(foregroundSessionState.isBusy()).toBe(true);
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

    await reconcileBusyStateNow("D:/repo", 13_000);

    expect(foregroundSessionState.isBusy()).toBe(true);
    expect(mocked.markAttachedSessionIdleMock).not.toHaveBeenCalled();
    expect(mocked.clearRunMock).not.toHaveBeenCalled();
    expect(mocked.flushDeferredDeliveriesMock).not.toHaveBeenCalled();
  });

  it("marks the attached session busy when the server reports busy", async () => {
    attachManager.attach("session-1", "D:/repo");
    mocked.sessionStatusMock.mockResolvedValue({
      data: { "session-1": { type: "busy" } },
      error: null,
    });

    await reconcileBusyStateNow("D:/repo", 13_000);

    expect(mocked.markAttachedSessionBusyMock).toHaveBeenCalledWith("session-1");
    expect(mocked.markAttachedSessionIdleMock).not.toHaveBeenCalled();
  });

  it("marks the attached session idle when the server reports idle", async () => {
    attachManager.attach("session-1", "D:/repo");
    attachManager.markBusy("session-1");
    mocked.sessionStatusMock.mockResolvedValue({
      data: { "session-1": { type: "idle" } },
      error: null,
    });

    await reconcileBusyStateNow("D:/repo", 13_000);

    expect(mocked.markAttachedSessionIdleMock).toHaveBeenCalledWith("session-1");
    expect(mocked.markAttachedSessionBusyMock).not.toHaveBeenCalled();
  });

  it("does not mark attached idle twice when attached session is also foreground busy", async () => {
    attachManager.attach("session-1", "D:/repo");
    attachManager.markBusy("session-1");
    markForegroundBusyAt("session-1", "D:/repo");
    mocked.sessionStatusMock.mockResolvedValue({
      data: { "session-1": { type: "idle" } },
      error: null,
    });

    await reconcileBusyStateNow("D:/repo", 13_000);

    expect(mocked.markAttachedSessionIdleMock).toHaveBeenCalledTimes(1);
    expect(mocked.markAttachedSessionIdleMock).toHaveBeenCalledWith("session-1");
    expect(foregroundSessionState.isBusy()).toBe(false);
  });

  it("keeps attached busy during the foreground grace period for the same session", async () => {
    attachManager.attach("session-1", "D:/repo");
    attachManager.markBusy("session-1");
    markForegroundBusyAt("session-1", "D:/repo", 10_000);
    mocked.sessionStatusMock.mockResolvedValue({
      data: { "session-1": { type: "idle" } },
      error: null,
    });

    await reconcileBusyStateNow("D:/repo", 11_000);

    expect(mocked.markAttachedSessionIdleMock).not.toHaveBeenCalled();
    expect(foregroundSessionState.isBusy()).toBe(true);
  });

  it("does not restore detached sessions from server status", async () => {
    attachManager.attach("session-1", "D:/repo");
    attachManager.clear("test_detach");
    mocked.sessionStatusMock.mockResolvedValue({
      data: { "session-1": { type: "busy" } },
      error: null,
    });

    await reconcileBusyStateNow("D:/repo", 13_000);

    expect(mocked.sessionStatusMock).not.toHaveBeenCalled();
    expect(mocked.markAttachedSessionBusyMock).not.toHaveBeenCalled();
  });

  it("keeps local state when loading session status fails", async () => {
    markForegroundBusyAt("session-1", "D:/repo");
    mocked.sessionStatusMock.mockResolvedValue({
      data: null,
      error: new Error("server unavailable"),
    });

    await reconcileBusyStateNow("D:/repo", 13_000);

    expect(foregroundSessionState.isBusy()).toBe(true);
    expect(mocked.markAttachedSessionIdleMock).not.toHaveBeenCalled();
    expect(mocked.clearRunMock).not.toHaveBeenCalled();
  });

  it("does not spend throttle interval when there are no tracked sessions", async () => {
    await reconcileBusyState("D:/repo", 10_000);

    expect(mocked.sessionStatusMock).not.toHaveBeenCalled();

    foregroundSessionState.markBusy("session-1", "D:/repo");
    foregroundSessionState.__setMarkedAtForTests("session-1", 7_000);
    mocked.sessionStatusMock.mockResolvedValue({
      data: { "session-1": { type: "idle" } },
      error: null,
    });

    await reconcileBusyState("D:/repo", 10_001);

    expect(mocked.sessionStatusMock).toHaveBeenCalledTimes(1);
    expect(foregroundSessionState.isBusy()).toBe(false);
  });

  it("skips clear when responseStreamer has active stream for the session", async () => {
    markForegroundBusyAt("session-1", "D:/repo");
    mocked.sessionStatusMock.mockResolvedValue({
      data: { "session-1": { type: "idle" } },
      error: null,
    });

    const mockStreamer = {
      hasActiveStream: vi.fn().mockReturnValue(true),
    };
    setResponseStreamerForReconciliation(mockStreamer as any);

    await reconcileBusyStateNow("D:/repo", 13_000);

    expect(mockStreamer.hasActiveStream).toHaveBeenCalledWith("session-1");
    expect(foregroundSessionState.isBusy()).toBe(true);
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
      hasActiveStream: vi.fn().mockReturnValue(false),
    };
    setResponseStreamerForReconciliation(mockStreamer as any);

    await reconcileBusyStateNow("D:/repo", 13_000);

    expect(mockStreamer.hasActiveStream).toHaveBeenCalledWith("session-1");
    expect(foregroundSessionState.isBusy()).toBe(false);
    expect(mocked.markAttachedSessionIdleMock).toHaveBeenCalledWith("session-1");
    expect(mocked.clearRunMock).toHaveBeenCalledWith("session-1", "status_reconcile_idle");
    expect(mocked.clearPromptResponseModeMock).toHaveBeenCalledWith("session-1");
    expect(mocked.flushDeferredDeliveriesMock).toHaveBeenCalledTimes(1);
  });
});
