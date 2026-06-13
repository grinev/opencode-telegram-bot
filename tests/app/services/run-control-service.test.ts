import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  reconcileBusyStateNowMock: vi.fn(),
  loggerWarnMock: vi.fn(),
}));

vi.mock("../../../src/app/services/busy-reconciliation-service.js", () => ({
  reconcileBusyStateNow: mocked.reconcileBusyStateNowMock,
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: mocked.loggerWarnMock,
    error: vi.fn(),
  },
}));

import { attachManager } from "../../../src/app/managers/attach-manager.js";
import { foregroundSessionState } from "../../../src/app/managers/foreground-session-state-manager.js";
import { reconcileForegroundBusyState } from "../../../src/app/services/run-control-service.js";

describe("app/services/run-control-service", () => {
  beforeEach(() => {
    foregroundSessionState.__resetForTests();
    attachManager.__resetForTests();
    mocked.reconcileBusyStateNowMock.mockReset();
    mocked.reconcileBusyStateNowMock.mockResolvedValue(undefined);
    mocked.loggerWarnMock.mockReset();
  });

  it("uses non-throttled reconciliation for foreground busy directories", async () => {
    foregroundSessionState.markBusy("session-1", "D:/repo");

    await reconcileForegroundBusyState();

    expect(mocked.reconcileBusyStateNowMock).toHaveBeenCalledWith("D:/repo");
    expect(mocked.reconcileBusyStateNowMock).toHaveBeenCalledTimes(1);
  });

  it("continues checking other directories when one on-demand reconciliation fails", async () => {
    foregroundSessionState.markBusy("session-1", "D:/repo-a");
    foregroundSessionState.markBusy("session-2", "D:/repo-b");
    const error = new Error("status failed");
    mocked.reconcileBusyStateNowMock.mockRejectedValueOnce(error).mockResolvedValueOnce(undefined);

    await reconcileForegroundBusyState();

    expect(mocked.reconcileBusyStateNowMock).toHaveBeenCalledWith("D:/repo-a");
    expect(mocked.reconcileBusyStateNowMock).toHaveBeenCalledWith("D:/repo-b");
    expect(mocked.loggerWarnMock).toHaveBeenCalledWith(
      "[BusyGuard] Failed to reconcile foreground busy state",
      error,
    );
  });
});
