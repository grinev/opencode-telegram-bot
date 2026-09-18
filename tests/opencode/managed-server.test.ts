import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChildProcess } from "node:child_process";

const isWindows = process.platform === "win32";

const mocked = vi.hoisted(() => {
  const spawnMock = vi.fn();
  const execMock = vi.fn();
  return { spawnMock, execMock };
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    exec: mocked.execMock,
    spawn: mocked.spawnMock,
  };
});

vi.mock("../../src/config.js", () => ({
  config: {
    opencode: {
      serverWorkdir: undefined,
    },
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  freeLocalOpencodePort,
  startLocalOpencodeServer,
  stopManagedServers,
} from "../../src/opencode/process.js";

function createChildProcess(pid: number): ChildProcess {
  return {
    pid,
    once: vi.fn(),
    unref: vi.fn(),
  } as unknown as ChildProcess;
}

/**
 * Shared "alive" flag overrides process.kill so the module under test sees a
 * fake pid as alive until a kill is attempted, without real OS processes.
 */
let alive = true;
let killSpy: ReturnType<typeof vi.spyOn> | null = null;

describe("opencode/managed-server", () => {
  beforeEach(() => {
    alive = true;
    mocked.spawnMock.mockReset();
    mocked.execMock.mockReset();
    killSpy = vi.spyOn(process, "kill").mockImplementation((_pid, signal) => {
      if (signal === 0) {
        if (!alive) {
          const error = new Error("ESRCH") as NodeJS.ErrnoException;
          error.code = "ESRCH";
          throw error;
        }
        return true;
      }
      alive = false;
      return true;
    });
  });

  afterEach(() => {
    killSpy?.mockRestore();
  });

  it("does nothing when no server was spawned", async () => {
    await stopManagedServers(500);

    if (isWindows) {
      const taskkillCalls = mocked.execMock.mock.calls.filter(([command]) =>
        String(command).includes("taskkill"),
      );
      expect(taskkillCalls).toHaveLength(0);
    } else {
      expect(killSpy).not.toHaveBeenCalledWith(expect.anything(), "SIGTERM");
    }
  });

  it("stops the server spawned by startLocalOpencodeServer", async () => {
    mocked.spawnMock.mockReturnValue(createChildProcess(4242));
    mocked.execMock.mockImplementation((command: string, callback) => {
      if (command.startsWith("taskkill")) {
        alive = false;
      }
      callback(null, { stdout: "", stderr: "" });
    });

    const childProcess = startLocalOpencodeServer({ host: "localhost", port: 4096 });

    expect(childProcess.pid).toBe(4242);
    expect(mocked.spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(["serve", "--port", "4096"]),
      expect.objectContaining({ detached: true, stdio: "ignore" }),
    );

    await stopManagedServers(500);

    if (isWindows) {
      expect(mocked.execMock).toHaveBeenCalledWith(
        expect.stringContaining("taskkill /PID 4242"),
        expect.any(Function),
      );
    } else {
      expect(killSpy).toHaveBeenCalledWith(4242, "SIGTERM");
    }
  });

  it("frees the port by stopping the process holding it", async () => {
    mocked.execMock.mockImplementation((command: string, callback) => {
      if (command.startsWith("netstat")) {
        callback(null, {
          stdout: "  TCP    127.0.0.1:4096    127.0.0.1:0    LISTENING    4242\n",
          stderr: "",
        });
        return;
      }
      if (command.startsWith("lsof")) {
        callback(null, { stdout: "4242\n", stderr: "" });
        return;
      }
      if (command.startsWith("taskkill")) {
        alive = false;
      }
      callback(null, { stdout: "", stderr: "" });
    });

    const freed = await freeLocalOpencodePort({ host: "localhost", port: 4096 });

    expect(freed).toBe(true);
    if (isWindows) {
      expect(mocked.execMock).toHaveBeenCalledWith(
        expect.stringContaining("taskkill /PID 4242"),
        expect.any(Function),
      );
    } else {
      expect(killSpy).toHaveBeenCalledWith(4242, "SIGTERM");
    }
  });

  it("returns true when the port is already free", async () => {
    mocked.execMock.mockImplementation((_command: string, callback) => {
      callback(null, { stdout: "", stderr: "" });
    });

    const freed = await freeLocalOpencodePort({ host: "localhost", port: 4096 });

    expect(freed).toBe(true);
    if (isWindows) {
      const taskkillCalls = mocked.execMock.mock.calls.filter(([command]) =>
        String(command).includes("taskkill"),
      );
      expect(taskkillCalls).toHaveLength(0);
    } else {
      expect(killSpy).not.toHaveBeenCalledWith(expect.anything(), "SIGTERM");
    }
  });
});