import { afterEach, beforeEach, describe, expect, it, vi } from "#vitest";
import type { ChildProcess } from "node:child_process";
import { loadSut } from "#helpers/sut-loader.js";

// Capture real setTimeout at module level for accelerateTime()
const _$rt = globalThis.setTimeout;

function accelerateTime(): { restore: () => void } {
  const _origDn = Date.now;
  let _ft = _origDn();
  Date.now = () => _ft;
  globalThis.setTimeout = ((cb: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    if ((ms ?? 0) > 0) _ft += ms!;
    return _$rt(cb, 0, ...args);
  }) as typeof globalThis.setTimeout;
  return {
    restore() {
      globalThis.setTimeout = _$rt;
      Date.now = _origDn;
    },
  };
}

const mocked = vi.hoisted(() => ({
  healthMock: vi.fn(),
  resolveLocalOpencodeTargetMock: vi.fn(),
  startLocalOpencodeServerMock: vi.fn(),
  notifyReadyMock: vi.fn(),
  notifyUnavailableMock: vi.fn(),
  loggerDebugMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  config: {
    opencode: {
      apiUrl: "http://localhost:4096",
      autoRestartEnabled: false,
      monitorIntervalSec: 300,
    },
  },
}));

vi.mock("#src/config.ts", () => ({
  config: mocked.config,
}));

vi.mock("#src/opencode/client.ts", () => ({
  opencodeClient: {
    global: {
      health: mocked.healthMock,
    },
  },
}));

vi.mock("#src/opencode/process.ts", () => ({
  resolveLocalOpencodeTarget: mocked.resolveLocalOpencodeTargetMock,
  startLocalOpencodeServer: mocked.startLocalOpencodeServerMock,
}));

vi.mock("#src/opencode/ready-lifecycle.ts", () => ({
  opencodeReadyLifecycle: {
    notifyReady: mocked.notifyReadyMock,
    notifyUnavailable: mocked.notifyUnavailableMock,
  },
}));

vi.mock("#src/utils/logger.ts", () => ({
  logger: {
    debug: mocked.loggerDebugMock,
    info: mocked.loggerInfoMock,
    warn: mocked.loggerWarnMock,
    error: mocked.loggerErrorMock,
  },
}));

vi.mock("#src/runtime/container.ts", () => ({
  isContainerRuntime: () => false,
}));

const sut = await loadSut<typeof import("#src/opencode/auto-restart.js")>(
  "#src/opencode/auto-restart.ts",
  import.meta.url,
);

function createChildProcess(pid: number): ChildProcess {
  return {
    pid,
    once: vi.fn(),
    unref: vi.fn(),
  } as unknown as ChildProcess;
}

function healthyResponse() {
  return { data: { healthy: true, version: "1.2.3" }, error: null };
}

function unhealthyResponse() {
  return { data: null, error: new Error("offline") };
}

describe("opencode/auto-restart", () => {
  beforeEach(() => {
    mocked.healthMock.mockReset();
    mocked.resolveLocalOpencodeTargetMock.mockReset();
    mocked.startLocalOpencodeServerMock.mockReset();
    mocked.notifyReadyMock.mockReset();
    mocked.notifyUnavailableMock.mockReset();
    mocked.loggerDebugMock.mockReset();
    mocked.loggerInfoMock.mockReset();
    mocked.loggerWarnMock.mockReset();
    mocked.loggerErrorMock.mockReset();

    mocked.config.opencode.apiUrl = "http://localhost:4096";
    mocked.config.opencode.autoRestartEnabled = false;
    mocked.config.opencode.monitorIntervalSec = 300;
    mocked.resolveLocalOpencodeTargetMock.mockReturnValue({ host: "localhost", port: 4096 });
    mocked.startLocalOpencodeServerMock.mockReturnValue(createChildProcess(123));
    mocked.notifyReadyMock.mockResolvedValue(true);
  });

  afterEach(() => {
  });

  it("does nothing when auto-restart is disabled", async () => {
    const service = new sut.OpencodeAutoRestartService();

    await service.start();

    expect(mocked.resolveLocalOpencodeTargetMock).not.toHaveBeenCalled();
    expect(mocked.healthMock).not.toHaveBeenCalled();
    expect(mocked.startLocalOpencodeServerMock).not.toHaveBeenCalled();
  });

  it("does not start a process for remote OpenCode URLs", async () => {
    mocked.config.opencode.autoRestartEnabled = true;
    mocked.config.opencode.apiUrl = "https://example.com";
    mocked.resolveLocalOpencodeTargetMock.mockReturnValue(null);
    const service = new sut.OpencodeAutoRestartService();

    await service.start();

    expect(mocked.resolveLocalOpencodeTargetMock).toHaveBeenCalledWith("https://example.com");
    expect(mocked.healthMock).not.toHaveBeenCalled();
    expect(mocked.startLocalOpencodeServerMock).not.toHaveBeenCalled();
    expect(mocked.loggerWarnMock).toHaveBeenCalledWith(
      expect.stringContaining("OPENCODE_API_URL is not local"),
    );
  });

  it("does not start a process when the server is healthy", async () => {
    mocked.config.opencode.autoRestartEnabled = true;
    mocked.healthMock.mockResolvedValue(healthyResponse());
    const service = new sut.OpencodeAutoRestartService();

    await service.start();

    expect(mocked.healthMock).toHaveBeenCalledTimes(1);
    expect(mocked.startLocalOpencodeServerMock).not.toHaveBeenCalled();
    expect(mocked.notifyReadyMock).toHaveBeenCalledWith("auto_restart_startup");

    service.stop();
  });

  it("starts local server once when startup health-check fails", async () => {
    mocked.config.opencode.autoRestartEnabled = true;
    const childProcess = createChildProcess(321);
    mocked.startLocalOpencodeServerMock.mockReturnValue(childProcess);
    mocked.healthMock
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(healthyResponse());
    const service = new sut.OpencodeAutoRestartService();

    // accelerateTime: the startup path waits for the server with real timers
    // (waitForOpencodeServerReady polls every 500ms up to 10s). The accelerated
    // clock collapses those to near-instant, so the test is deterministic on
    // any runner (the 5s per-test timeout killed it once on CI).
    const { restore } = accelerateTime();
    try {
      await service.start();
    } finally {
      restore();
    }

    expect(mocked.startLocalOpencodeServerMock).toHaveBeenCalledTimes(1);
    expect(mocked.startLocalOpencodeServerMock).toHaveBeenCalledWith({
      host: "localhost",
      port: 4096,
    });
    expect(childProcess.unref).toHaveBeenCalledTimes(1);
    expect(mocked.notifyUnavailableMock).toHaveBeenCalledWith("auto_restart_startup");
    expect(mocked.notifyReadyMock).toHaveBeenCalledWith("auto_restart_startup");

    service.stop();
  });

  it("treats a stuck startup health-check as unavailable", async () => {
    mocked.config.opencode.autoRestartEnabled = true;
    const childProcess = createChildProcess(456);
    mocked.startLocalOpencodeServerMock.mockReturnValue(childProcess);
    mocked.healthMock
      .mockReturnValueOnce(new Promise(() => undefined))
      .mockResolvedValueOnce(healthyResponse());
    const service = new sut.OpencodeAutoRestartService();

    const { restore } = accelerateTime();
    try {
      const startPromise = service.start();
      // Yield once — accelerated setTimeout fires on the next macrotask
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      await startPromise;
    } finally {
      restore();
    }

    expect(mocked.loggerWarnMock).toHaveBeenCalledWith(
      "[OpenCodeAutoRestart] Health-check timed out after 3000ms",
    );
    expect(mocked.startLocalOpencodeServerMock).toHaveBeenCalledTimes(1);
    expect(mocked.notifyUnavailableMock).toHaveBeenCalledWith("auto_restart_startup");
    expect(mocked.notifyReadyMock).toHaveBeenCalledWith("auto_restart_startup");

    service.stop();
  });

  // TODO: bun's loadSut Proxy loads the SUT in beforeAll, so vi.useFakeTimers()
  // in beforeEach doesn't retroactively affect the SUT's setTimeout
  // references captured at module load. Re-enable once the SUT is refactored
  // to read setTimeout lazily or once we load the SUT per-test.
  it.skip("does not refresh cache on every healthy interval", async () => {
    mocked.config.opencode.autoRestartEnabled = true;
    mocked.config.opencode.monitorIntervalSec = 300;
    mocked.healthMock.mockResolvedValue(healthyResponse());
    const service = new sut.OpencodeAutoRestartService();

    await service.start();
    await vi.advanceTimersByTimeAsync(300_000);

    expect(mocked.healthMock).toHaveBeenCalledTimes(2);
    expect(mocked.notifyReadyMock).toHaveBeenCalledTimes(1);

    service.stop();
  });

  it("keeps auto-restart recovered when ready lifecycle handler fails", async () => {
    mocked.config.opencode.autoRestartEnabled = true;
    mocked.notifyReadyMock.mockRejectedValueOnce(new Error("ready failed"));
    mocked.healthMock
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(healthyResponse());
    const service = new sut.OpencodeAutoRestartService();

    await service.start();

    expect(mocked.startLocalOpencodeServerMock).toHaveBeenCalledTimes(1);
    expect(mocked.loggerErrorMock).toHaveBeenCalledWith(
      "[OpenCodeAutoRestart] Failed to check or restart OpenCode server",
      expect.any(Error),
    );

    service.stop();
  });

  it.skip("checks health again on the configured interval", async () => {
    mocked.config.opencode.autoRestartEnabled = true;
    mocked.config.opencode.monitorIntervalSec = 300;
    mocked.healthMock
      .mockResolvedValueOnce(healthyResponse())
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(healthyResponse());
    const service = new sut.OpencodeAutoRestartService();

    await service.start();
    await vi.advanceTimersByTimeAsync(300_000);

    expect(mocked.startLocalOpencodeServerMock).toHaveBeenCalledTimes(1);
    expect(mocked.notifyUnavailableMock).toHaveBeenCalledWith("auto_restart_interval");
    expect(mocked.notifyReadyMock).toHaveBeenCalledTimes(2);

    service.stop();
  });

  it.skip("does not run overlapping checks", async () => {
    mocked.config.opencode.autoRestartEnabled = true;
    mocked.config.opencode.monitorIntervalSec = 1;
    mocked.healthMock.mockResolvedValueOnce(healthyResponse());
    const service = new sut.OpencodeAutoRestartService();
    await service.start();

    let resolveHealth: (value: ReturnType<typeof unhealthyResponse>) => void = () => undefined;
    const pendingHealth = new Promise<ReturnType<typeof unhealthyResponse>>((resolve) => {
      resolveHealth = resolve;
    });
    mocked.healthMock.mockImplementationOnce(() => pendingHealth);

    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(mocked.healthMock).toHaveBeenCalledTimes(2);

    mocked.healthMock.mockResolvedValueOnce(healthyResponse());
    resolveHealth(unhealthyResponse());
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mocked.startLocalOpencodeServerMock).toHaveBeenCalledTimes(1);

    service.stop();
  });
});
