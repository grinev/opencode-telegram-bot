import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { setRuntimeMode } from "../../src/runtime/mode.js";
import { loadSettings } from "../../src/settings/manager.js";
import {
  __resetSessionDirectoryCacheForTests,
  getCachedSessionDirectories,
  syncSessionDirectoryCache,
  upsertSessionDirectory,
  warmupSessionDirectoryCache,
} from "../../src/session/cache-manager.js";

const { sessionListMock, loggerWarnMock, loggerDebugMock, loggerInfoMock, loggerErrorMock } =
  vi.hoisted(() => ({
    sessionListMock: vi.fn(),
    loggerWarnMock: vi.fn(),
    loggerDebugMock: vi.fn(),
    loggerInfoMock: vi.fn(),
    loggerErrorMock: vi.fn(),
  }));

vi.mock("../../src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      list: sessionListMock,
    },
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    debug: loggerDebugMock,
    info: loggerInfoMock,
    warn: loggerWarnMock,
    error: loggerErrorMock,
  },
}));

function createSession(directory: string, updated: number) {
  return {
    id: `ses_${updated}`,
    slug: `slug_${updated}`,
    projectID: "global",
    directory,
    title: "session",
    version: "1.0.0",
    time: {
      created: updated - 1000,
      updated,
    },
  };
}

describe("session/cache-manager", () => {
  let tempHome: string;

  beforeEach(async () => {
    tempHome = await mkdtemp(path.join(os.tmpdir(), "opencode-telegram-cache-"));
    process.env.OPENCODE_TELEGRAM_HOME = tempHome;
    setRuntimeMode("installed");
    await loadSettings();
    sessionListMock.mockReset();
    loggerWarnMock.mockReset();
    __resetSessionDirectoryCacheForTests();
  });

  afterEach(async () => {
    delete process.env.OPENCODE_TELEGRAM_HOME;
    await rm(tempHome, { recursive: true, force: true });
  });

  it("warms up cache from latest sessions with initial limit", async () => {
    sessionListMock.mockResolvedValueOnce({
      data: [
        createSession("D:/repo-b", 1_700_000_000_200),
        createSession("D:/repo-a", 1_700_000_000_100),
      ],
      error: null,
    });

    await warmupSessionDirectoryCache();

    expect(sessionListMock).toHaveBeenCalledWith({ limit: 1000 });

    const directories = await getCachedSessionDirectories();
    expect(directories).toEqual([
      { worktree: "D:/repo-b", lastUpdated: 1_700_000_000_200 },
      { worktree: "D:/repo-a", lastUpdated: 1_700_000_000_100 },
    ]);

    const settingsPath = path.join(tempHome, "settings.json");
    const settingsFile = JSON.parse(await readFile(settingsPath, "utf-8")) as {
      sessionDirectoryCache: {
        version: number;
        lastSyncedUpdatedAt: number;
        directories: Array<{ worktree: string }>;
      };
    };
    const cacheFile = settingsFile.sessionDirectoryCache;

    expect(cacheFile).toBeDefined();
    expect(cacheFile.version).toBe(1);
    expect(cacheFile.lastSyncedUpdatedAt).toBe(1_700_000_000_200);
    expect(cacheFile.directories.map((entry) => entry.worktree)).toEqual([
      "D:/repo-b",
      "D:/repo-a",
    ]);
  });

  it("runs incremental sync using start watermark", async () => {
    sessionListMock
      .mockResolvedValueOnce({
        data: [createSession("D:/repo-a", 1_700_000_000_500)],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [createSession("D:/repo-c", 1_700_000_005_000)],
        error: null,
      });

    await warmupSessionDirectoryCache();
    await syncSessionDirectoryCache({ force: true });

    expect(sessionListMock).toHaveBeenNthCalledWith(1, { limit: 1000 });
    expect(sessionListMock).toHaveBeenNthCalledWith(2, {
      limit: 1000,
      start: 1_700_000_000_500 - 60_000,
    });

    const directories = await getCachedSessionDirectories();
    expect(directories.map((item) => item.worktree)).toEqual(["D:/repo-c", "D:/repo-a"]);
  });

  it("logs friendly message when server is not running during warmup sync", async () => {
    sessionListMock.mockResolvedValueOnce({
      data: null,
      error: new TypeError("fetch failed"),
    });

    await warmupSessionDirectoryCache();

    expect(loggerWarnMock).toHaveBeenCalledTimes(1);
    expect(loggerWarnMock).toHaveBeenCalledWith(
      "[SessionCache] OpenCode server is not running. Start it with: opencode serve",
    );
  });

  it("updates existing directory with newer timestamp", async () => {
    await upsertSessionDirectory("D:/repo-a", 1_700_000_000_100);
    await upsertSessionDirectory("D:/repo-a", 1_700_000_000_900);

    const directories = await getCachedSessionDirectories();
    expect(directories).toEqual([{ worktree: "D:/repo-a", lastUpdated: 1_700_000_000_900 }]);
  });
});
