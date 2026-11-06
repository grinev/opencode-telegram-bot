import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChildProcess } from "node:child_process";

const mocked = vi.hoisted(() => ({
  healthMock: vi.fn(),
  probeMock: vi.fn(),
  findRegisteredMock: vi.fn(),
  startLocalOpencodeServerMock: vi.fn(),
  readLocalVersionMock: vi.fn(),
  serverMode: "standalone" as "service" | "standalone",
  serverVersion: "v2" as "v1" | "v2",
}));

vi.mock("../../src/config.js", () => ({
  config: {
    opencode: {
      apiUrl: "http://127.0.0.1:4097",
      username: "opencode",
      password: "secret",
      autoRestartEnabled: true,
      monitorIntervalSec: 300,
      get serverMode() {
        return mocked.serverMode;
      },
      get serverVersion() {
        return mocked.serverVersion;
      },
    },
  },
}));

vi.mock("../../src/opencode/client.js", () => ({
  opencodeClient: {
    global: {
      health: mocked.healthMock,
    },
  },
  get opencodeServerVersion() {
    return mocked.serverVersion;
  },
  probeOpencodeServer: mocked.probeMock,
  findRegisteredOpencodeServer: mocked.findRegisteredMock,
}));

vi.mock("../../src/opencode/process.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/opencode/process.js")>()),
  resolveLocalOpencodeTarget: () => ({ host: "127.0.0.1", port: 4097 }),
  startLocalOpencodeServer: mocked.startLocalOpencodeServerMock,
  readLocalOpencodeVersion: mocked.readLocalVersionMock,
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { OpencodeAutoRestartService } from "../../src/opencode/auto-restart.js";
import type { OpencodeReadyLifecycle } from "../../src/opencode/ready-lifecycle.js";
import {
  __resetOpencodeServerTargetForTests,
  isOnConfiguredOpencodeServer,
} from "../../src/opencode/server-target.js";
import { __resetServerHealthStateForTests } from "../../src/opencode/server-health.js";

const REGISTERED = {
  url: "http://127.0.0.1:49374",
  username: "opencode",
  password: "secret",
};

function createChildProcess(): ChildProcess {
  return {
    pid: 4242,
    once: vi.fn(),
    unref: vi.fn(),
  } as unknown as ChildProcess;
}

describe("standalone auto-restart", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetOpencodeServerTargetForTests();
    __resetServerHealthStateForTests();
    mocked.serverMode = "standalone";
    mocked.serverVersion = "v2";
    mocked.healthMock.mockReset();
    mocked.probeMock.mockReset();
    mocked.findRegisteredMock.mockReset();
    mocked.findRegisteredMock.mockResolvedValue(REGISTERED);
    mocked.startLocalOpencodeServerMock.mockReset();
    mocked.startLocalOpencodeServerMock.mockReturnValue(createChildProcess());
    mocked.readLocalVersionMock.mockReset();
    mocked.readLocalVersionMock.mockResolvedValue("2.0.16");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("spawns on the configured port instead of connecting to a registered server", async () => {
    mocked.healthMock
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ data: { healthy: true, version: "2.0.16" }, error: null });
    mocked.probeMock.mockImplementation(async (version: string, server?: { url: string }) => {
      if (version === "v2" && server?.url === REGISTERED.url) {
        return { kind: "found", version: "v2", serverVersion: "2.1.3" };
      }
      return { kind: "none" };
    });
    const ready = { notifyReady: vi.fn(), notifyUnavailable: vi.fn() };
    const service = new OpencodeAutoRestartService(ready as unknown as OpencodeReadyLifecycle);

    const startPromise = service.start();
    await vi.advanceTimersByTimeAsync(0);
    await startPromise;

    expect(mocked.findRegisteredMock).not.toHaveBeenCalled();
    expect(mocked.startLocalOpencodeServerMock).toHaveBeenCalledWith(
      { host: "127.0.0.1", port: 4097 },
      "v2",
    );
    expect(isOnConfiguredOpencodeServer()).toBe(true);

    service.stop();
  });
});
