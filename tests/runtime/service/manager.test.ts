import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock, execMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  execMock: vi.fn(),
}));

const { getRuntimePathsMock, runtimePathsState } = vi.hoisted(() => {
  const runtimePathsState = {
    value: {
      mode: "installed",
      appHome: "D:/temp/opencode-telegram-test",
      envFilePath: "D:/temp/opencode-telegram-test/.env",
      settingsFilePath: "D:/temp/opencode-telegram-test/settings.json",
      logsDirPath: "D:/temp/opencode-telegram-test/logs",
      runDirPath: "D:/temp/opencode-telegram-test/run",
    },
  };

  return {
    getRuntimePathsMock: vi.fn(() => runtimePathsState.value),
    runtimePathsState,
  };
});

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
  exec: execMock,
}));

vi.mock("../../../src/runtime/paths.js", () => ({
  getRuntimePaths: getRuntimePathsMock,
}));

import {
  getBotServiceStatus,
  getServiceStateFilePath,
  startBotDaemon,
  stopBotDaemon,
} from "../../../src/runtime/service/manager.js";

function setPlatform(platform: NodeJS.Platform): () => void {
  const originalPlatform = process.platform;
  Object.defineProperty(process, "platform", { value: platform, configurable: true });

  return () => {
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  };
}

describe("runtime/service/manager", () => {
  let tempDirPath: string;
  let originalArgv1: string | undefined;

  beforeEach(async () => {
    tempDirPath = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-telegram-service-"));
    originalArgv1 = process.argv[1];
    process.argv[1] = path.join(tempDirPath, "dist", "cli.js");

    runtimePathsState.value = {
      mode: "installed",
      appHome: tempDirPath,
      envFilePath: path.join(tempDirPath, ".env"),
      settingsFilePath: path.join(tempDirPath, "settings.json"),
      logsDirPath: path.join(tempDirPath, "logs"),
      runDirPath: path.join(tempDirPath, "run"),
    };

    spawnMock.mockReset();
    execMock.mockReset();
    execMock.mockImplementation((_command: string, callback?: (...args: unknown[]) => void) => {
      if (callback) {
        callback(null, "", "");
      }

      return {};
    });
  });

  afterEach(async () => {
    if (originalArgv1 === undefined) {
      delete process.argv[1];
    } else {
      process.argv[1] = originalArgv1;
    }

    vi.restoreAllMocks();
    if (tempDirPath) {
      await fs.rm(tempDirPath, { recursive: true, force: true });
    }
  });

  it("starts daemon process and persists runtime state", async () => {
    spawnMock.mockReturnValue({
      pid: 4321,
      unref: vi.fn(),
    });

    const result = await startBotDaemon("installed");

    expect(result.success).toBe(true);
    expect(result.service).toEqual(
      expect.objectContaining({
        pid: 4321,
        mode: "daemon",
      }),
    );
    expect(spawnMock).toHaveBeenCalledWith(
      process.execPath,
      [path.resolve(process.argv[1]!), "start", "--mode", "installed"],
      expect.objectContaining({
        detached: true,
        windowsHide: true,
        env: expect.objectContaining({
          OPENCODE_TELEGRAM_SERVICE_CHILD: "1",
          OPENCODE_TELEGRAM_SERVICE_STATE_PATH: getServiceStateFilePath(),
        }),
      }),
    );

    const persistedState = JSON.parse(await fs.readFile(getServiceStateFilePath(), "utf-8")) as {
      pid: number;
      mode: string;
    };
    expect(persistedState).toEqual(
      expect.objectContaining({
        pid: 4321,
        mode: "daemon",
      }),
    );
  });

  it("cleans stale daemon state during status check", async () => {
    await fs.mkdir(path.dirname(getServiceStateFilePath()), { recursive: true });
    await fs.writeFile(
      getServiceStateFilePath(),
      JSON.stringify({
        pid: 9876,
        startedAt: new Date().toISOString(),
        logFilePath: path.join(tempDirPath, "logs", "bot-service.log"),
        mode: "daemon",
      }),
    );

    vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });

    const status = await getBotServiceStatus();

    expect(status).toEqual({
      status: "stopped",
      service: null,
      cleanupReason: "stale",
    });
    await expect(fs.access(getServiceStateFilePath())).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("stops daemon process and clears runtime state", async () => {
    const restorePlatform = setPlatform("linux");
    let isRunning = true;

    await fs.mkdir(path.dirname(getServiceStateFilePath()), { recursive: true });
    await fs.writeFile(
      getServiceStateFilePath(),
      JSON.stringify({
        pid: 2468,
        startedAt: new Date().toISOString(),
        logFilePath: path.join(tempDirPath, "logs", "bot-service.log"),
        mode: "daemon",
      }),
    );

    vi.spyOn(process, "kill").mockImplementation(
      (_pid: number, signal?: NodeJS.Signals | number) => {
        if (signal === 0 || signal === undefined) {
          if (isRunning) {
            return true;
          }

          throw new Error("ESRCH");
        }

        if (signal === "SIGTERM") {
          isRunning = false;
          return true;
        }

        return true;
      },
    );

    try {
      const result = await stopBotDaemon(50);

      expect(result).toEqual(
        expect.objectContaining({
          success: true,
          cleanupReason: null,
        }),
      );
      expect(result.service).toEqual(
        expect.objectContaining({
          pid: 2468,
          mode: "daemon",
        }),
      );
      await expect(fs.access(getServiceStateFilePath())).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      restorePlatform();
    }
  });
});
