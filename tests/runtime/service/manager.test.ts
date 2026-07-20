import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock, execMock } = vi.hoisted(() => {
  const spawnMock = vi.fn();
  const execMock = vi.fn() as ReturnType<typeof vi.fn> & {
    [key: symbol]: (command: string) => Promise<{ stdout: string; stderr: string }>;
  };

  const customPromisifySymbol = Symbol.for("nodejs.util.promisify.custom");
  execMock[customPromisifySymbol] = function (this: unknown, command: string) {
    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      execMock(command, (error: Error | null, stdout: string, stderr: string) => {
        if (error) {
          reject(Object.assign(error, { stdout, stderr }));
        } else {
          resolve({ stdout, stderr });
        }
      });
    });
  };

  return { spawnMock, execMock };
});

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

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
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

  it("detects recycled PID via process creation time", async () => {
    const restorePlatform = setPlatform("win32");

    const daemonStartedAt = new Date("2026-07-18T20:56:06.413Z");
    const stolenPid = 11236;

    await fs.mkdir(path.dirname(getServiceStateFilePath()), { recursive: true });
    await fs.writeFile(
      getServiceStateFilePath(),
      JSON.stringify({
        pid: stolenPid,
        startedAt: daemonStartedAt.toISOString(),
        logFilePath: path.join(tempDirPath, "logs", "bot-service.log"),
        mode: "daemon",
      }),
    );

    vi.spyOn(process, "kill").mockImplementation(() => true);

    execMock.mockImplementation(
      (
        command: string,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        if (command.includes("powershell") && command.includes(String(stolenPid))) {
          callback(null, "20260719095542.123456+180\n", "");
        } else {
          callback(null, "", "");
        }
        return {};
      },
    );

    try {
      const status = await getBotServiceStatus();

      expect(status).toEqual({
        status: "stopped",
        service: null,
        cleanupReason: "stale",
      });
      await expect(fs.access(getServiceStateFilePath())).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      restorePlatform();
    }
  });

  it("returns running when PID exists and creation time matches", async () => {
    const restorePlatform = setPlatform("win32");

    const daemonStartedAt = new Date("2026-07-18T20:56:06.413Z");
    const pid = 11236;

    await fs.mkdir(path.dirname(getServiceStateFilePath()), { recursive: true });
    await fs.writeFile(
      getServiceStateFilePath(),
      JSON.stringify({
        pid,
        startedAt: daemonStartedAt.toISOString(),
        logFilePath: path.join(tempDirPath, "logs", "bot-service.log"),
        mode: "daemon",
      }),
    );

    vi.spyOn(process, "kill").mockImplementation(() => true);

    execMock.mockImplementation(
      (
        command: string,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        if (command.includes("powershell") && command.includes(String(pid))) {
          const creationDateStr =
            daemonStartedAt.getFullYear().toString() +
            String(daemonStartedAt.getMonth() + 1).padStart(2, "0") +
            String(daemonStartedAt.getDate()).padStart(2, "0") +
            String(daemonStartedAt.getHours()).padStart(2, "0") +
            String(daemonStartedAt.getMinutes()).padStart(2, "0") +
            String(daemonStartedAt.getSeconds()).padStart(2, "0") +
            ".000000+180";
          callback(null, `${creationDateStr}\n`, "");
        } else {
          callback(null, "", "");
        }
        return {};
      },
    );

    try {
      const status = await getBotServiceStatus();

      expect(status).toEqual({
        status: "running",
        service: expect.objectContaining({ pid, mode: "daemon" }),
        cleanupReason: null,
      });
      await expect(fs.access(getServiceStateFilePath())).resolves.toBeUndefined();
    } finally {
      restorePlatform();
    }
  });

  it("falls back to PID-only check when creation time cannot be determined", async () => {
    const restorePlatform = setPlatform("win32");

    await fs.mkdir(path.dirname(getServiceStateFilePath()), { recursive: true });
    await fs.writeFile(
      getServiceStateFilePath(),
      JSON.stringify({
        pid: 9999,
        startedAt: new Date().toISOString(),
        logFilePath: path.join(tempDirPath, "logs", "bot-service.log"),
        mode: "daemon",
      }),
    );

    vi.spyOn(process, "kill").mockImplementation(() => true);

    execMock.mockImplementation(
      (
        command: string,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        if (command.includes("powershell")) {
          callback(new Error("PowerShell failed"), "", "");
        } else {
          callback(null, "", "");
        }
        return {};
      },
    );

    try {
      const status = await getBotServiceStatus();

      expect(status).toEqual({
        status: "running",
        service: expect.objectContaining({ pid: 9999, mode: "daemon" }),
        cleanupReason: null,
      });
    } finally {
      restorePlatform();
    }
  });
});
