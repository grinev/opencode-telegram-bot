import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  reconcileBusyStateNowMock: vi.fn(),
  loggerWarnMock: vi.fn(),
}));

vi.mock("../../../src/app/services/busy-reconciliation-service.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../src/app/services/busy-reconciliation-service.js")
  >()),
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

import { reconcileForegroundBusyState } from "../../../src/app/services/run-control-service.js";
import { createTestAppContainer } from "../../helpers/app-container.js";
import type { AppContainer } from "../../../src/app/bootstrap/app-container.js";

let deps: AppContainer;

beforeEach(() => {
  deps = createTestAppContainer();
});

describe("app/services/run-control-service", () => {
  beforeEach(() => {
    mocked.reconcileBusyStateNowMock.mockReset();
    mocked.reconcileBusyStateNowMock.mockResolvedValue(undefined);
    mocked.loggerWarnMock.mockReset();
  });

  it("uses non-throttled reconciliation for foreground busy directories", async () => {
    deps.foregroundSessionState.markBusy("session-1", "D:/repo");

    await reconcileForegroundBusyState(deps);

    expect(mocked.reconcileBusyStateNowMock).toHaveBeenCalledWith("D:/repo", deps);
    expect(mocked.reconcileBusyStateNowMock).toHaveBeenCalledTimes(1);
  });

  it("continues checking other directories when one on-demand reconciliation fails", async () => {
    deps.foregroundSessionState.markBusy("session-1", "D:/repo-a");
    deps.foregroundSessionState.markBusy("session-2", "D:/repo-b");
    const error = new Error("status failed");
    mocked.reconcileBusyStateNowMock.mockRejectedValueOnce(error).mockResolvedValueOnce(undefined);

    await reconcileForegroundBusyState(deps);

    expect(mocked.reconcileBusyStateNowMock).toHaveBeenCalledWith("D:/repo-a", deps);
    expect(mocked.reconcileBusyStateNowMock).toHaveBeenCalledWith("D:/repo-b", deps);
    expect(mocked.loggerWarnMock).toHaveBeenCalledWith(
      "[BusyGuard] Failed to reconcile foreground busy state",
      error,
    );
  });
});
