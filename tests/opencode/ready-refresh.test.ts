import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  healthMock: vi.fn(),
  warmupSessionDirectoryCacheMock: vi.fn(),
  reconcileStoredModelSelectionMock: vi.fn(),
  loggerDebugMock: vi.fn(),
  loggerWarnMock: vi.fn(),
}));

vi.mock("../../src/opencode/client.js", () => ({
  opencodeClient: {
    global: {
      health: mocked.healthMock,
    },
  },
}));

vi.mock("../../src/app/services/session-cache-service.js", () => ({
  __resetSessionDirectoryCacheForTests: vi.fn(),
  warmupSessionDirectoryCache: mocked.warmupSessionDirectoryCacheMock,
}));

vi.mock("../../src/app/services/model-selection-service.js", () => ({
  reconcileStoredModelSelection: mocked.reconcileStoredModelSelectionMock,
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    debug: mocked.loggerDebugMock,
    info: vi.fn(),
    warn: mocked.loggerWarnMock,
    error: vi.fn(),
  },
}));

import { OpencodeReadyLifecycle } from "../../src/opencode/ready-lifecycle.js";
import {
  refreshSessionCacheAfterOpencodeReady,
  refreshSessionCacheIfOpencodeReady,
  type ReadyRefreshDeps,
} from "../../src/opencode/ready-refresh.js";

let deps: ReadyRefreshDeps;

describe("opencode/ready-refresh", () => {
  beforeEach(() => {
    deps = { opencodeReadyLifecycle: new OpencodeReadyLifecycle() };
    mocked.healthMock.mockReset();
    mocked.warmupSessionDirectoryCacheMock.mockReset();
    mocked.reconcileStoredModelSelectionMock.mockReset();
    mocked.loggerDebugMock.mockReset();
    mocked.loggerWarnMock.mockReset();

    mocked.warmupSessionDirectoryCacheMock.mockResolvedValue(undefined);
    mocked.reconcileStoredModelSelectionMock.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("skips refresh with a short warning when OpenCode server is unavailable", async () => {
    mocked.healthMock.mockRejectedValueOnce(new Error("fetch failed"));

    const refreshed = await refreshSessionCacheIfOpencodeReady("startup", deps);

    expect(refreshed).toBe(false);
    expect(mocked.warmupSessionDirectoryCacheMock).not.toHaveBeenCalled();
    expect(mocked.reconcileStoredModelSelectionMock).not.toHaveBeenCalled();
    expect(mocked.loggerWarnMock).toHaveBeenCalledWith(
      "[OpenCodeReady] OpenCode server is not running; skipping session cache refresh: reason=startup",
    );
  });

  it("refreshes cache when OpenCode server is healthy", async () => {
    mocked.healthMock.mockResolvedValueOnce({ data: { healthy: true }, error: null });

    const refreshed = await refreshSessionCacheIfOpencodeReady("startup", deps);

    expect(refreshed).toBe(true);
    expect(mocked.warmupSessionDirectoryCacheMock).toHaveBeenCalledTimes(1);
    expect(mocked.reconcileStoredModelSelectionMock).toHaveBeenCalledWith({
      forceCatalogRefresh: true,
    });
  });

  it("logs refresh failures without throwing", async () => {
    mocked.warmupSessionDirectoryCacheMock.mockRejectedValueOnce(new Error("refresh failed"));

    await expect(
      refreshSessionCacheAfterOpencodeReady("opencode_start_success"),
    ).resolves.toBeUndefined();

    expect(mocked.loggerWarnMock).toHaveBeenCalledWith(
      "[OpenCodeReady] Failed to refresh session cache: reason=opencode_start_success",
      expect.any(Error),
    );
    expect(mocked.reconcileStoredModelSelectionMock).toHaveBeenCalledWith({
      forceCatalogRefresh: true,
    });
  });

  it("logs model refresh failures without throwing", async () => {
    mocked.reconcileStoredModelSelectionMock.mockRejectedValueOnce(new Error("model failed"));

    await expect(
      refreshSessionCacheAfterOpencodeReady("opencode_start_success"),
    ).resolves.toBeUndefined();

    expect(mocked.loggerWarnMock).toHaveBeenCalledWith(
      "[OpenCodeReady] Failed to refresh model catalog: reason=opencode_start_success",
      expect.any(Error),
    );
  });

  it("retries the model catalog refresh until a non-empty catalog is read", async () => {
    vi.useFakeTimers();
    mocked.reconcileStoredModelSelectionMock
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const refresh = refreshSessionCacheAfterOpencodeReady("opencode_start_success");
    await vi.advanceTimersByTimeAsync(1000);
    await refresh;

    expect(mocked.reconcileStoredModelSelectionMock).toHaveBeenCalledTimes(3);
    expect(mocked.reconcileStoredModelSelectionMock).toHaveBeenLastCalledWith({
      forceCatalogRefresh: true,
    });
    expect(mocked.loggerWarnMock).not.toHaveBeenCalled();
  });

  it("stops waiting for the model catalog after the time limit", async () => {
    vi.useFakeTimers();
    mocked.reconcileStoredModelSelectionMock.mockResolvedValue(false);

    let finished = false;
    const refresh = refreshSessionCacheAfterOpencodeReady("auto_restart_interval").then(() => {
      finished = true;
    });

    await vi.advanceTimersByTimeAsync(2500);
    expect(finished).toBe(false);

    await vi.advanceTimersByTimeAsync(1000);
    await refresh;

    expect(finished).toBe(true);
    expect(mocked.reconcileStoredModelSelectionMock).toHaveBeenCalledTimes(7);
    expect(mocked.loggerWarnMock).toHaveBeenCalledWith(
      "[OpenCodeReady] Model catalog still unavailable after 3000ms: reason=auto_restart_interval",
    );
  });

  it("runs ready handlers registered later only after the model catalog is available", async () => {
    vi.useFakeTimers();
    mocked.reconcileStoredModelSelectionMock.mockResolvedValueOnce(false).mockResolvedValue(true);
    const lifecycle = new OpencodeReadyLifecycle();
    const order: string[] = [];
    lifecycle.onReady(async (reason) => {
      await refreshSessionCacheAfterOpencodeReady(reason);
      order.push("refresh");
    });
    lifecycle.onReady(() => {
      order.push("restore");
    });

    const notify = lifecycle.notifyReady("opencode_start_success");
    await vi.advanceTimersByTimeAsync(500);
    await notify;

    expect(mocked.reconcileStoredModelSelectionMock).toHaveBeenCalledTimes(2);
    expect(order).toEqual(["refresh", "restore"]);
  });
});
