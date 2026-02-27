import { createHash } from "node:crypto";
import path from "node:path";
import Database from "better-sqlite3";
import { opencodeClient } from "../opencode/client.js";
import { getSessionDirectoryCache, setSessionDirectoryCache } from "../settings/manager.js";
import { logger } from "../utils/logger.js";

export interface CachedSessionDirectory {
  worktree: string;
  lastUpdated: number;
}

export interface SessionDirectoryProject {
  id: string;
  worktree: string;
  name: string;
  lastUpdated: number;
}

interface SessionDirectoryCacheData {
  version: 1;
  lastSyncedUpdatedAt: number;
  directories: CachedSessionDirectory[];
}

const CACHE_VERSION = 1;
const INITIAL_WARMUP_LIMIT = 1000;
const INCREMENTAL_SYNC_LIMIT = 1000;
const MAX_CACHED_DIRECTORIES = 10;
const SYNC_SAFETY_WINDOW_MS = 60_000;
const SYNC_COOLDOWN_MS = 60_000;
const STORAGE_FALLBACK_SCAN_LIMIT = 200;
const SQLITE_FALLBACK_QUERY_LIMIT = 200;
const SERVER_UNAVAILABLE_ERROR_MARKERS = [
  "fetch failed",
  "econnrefused",
  "connection refused",
  "connect refused",
];

const EMPTY_CACHE: SessionDirectoryCacheData = {
  version: CACHE_VERSION,
  lastSyncedUpdatedAt: 0,
  directories: [],
};

function createEmptyCacheData(): SessionDirectoryCacheData {
  return {
    version: EMPTY_CACHE.version,
    lastSyncedUpdatedAt: EMPTY_CACHE.lastSyncedUpdatedAt,
    directories: [],
  };
}

let cacheData: SessionDirectoryCacheData = createEmptyCacheData();
let cacheLoaded = false;
let syncInFlight: Promise<void> | null = null;
let lastSyncAttemptAt = 0;
let persistQueue: Promise<void> = Promise.resolve();

function worktreeKey(worktree: string): string {
  if (process.platform === "win32") {
    return worktree.toLowerCase();
  }

  return worktree;
}

function isValidWorktree(worktree: string): boolean {
  const trimmed = worktree.trim();
  return trimmed.length > 0 && trimmed !== "/";
}

function normalizeCacheData(raw: unknown): SessionDirectoryCacheData {
  if (!raw || typeof raw !== "object") {
    return createEmptyCacheData();
  }

  const value = raw as {
    version?: unknown;
    lastSyncedUpdatedAt?: unknown;
    directories?: unknown;
  };

  const lastSyncedUpdatedAt =
    typeof value.lastSyncedUpdatedAt === "number" && Number.isFinite(value.lastSyncedUpdatedAt)
      ? value.lastSyncedUpdatedAt
      : 0;

  const directories: CachedSessionDirectory[] = Array.isArray(value.directories)
    ? value.directories
        .filter(
          (item): item is { worktree: string; lastUpdated: number } =>
            Boolean(item) &&
            typeof item === "object" &&
            typeof (item as { worktree?: unknown }).worktree === "string" &&
            typeof (item as { lastUpdated?: unknown }).lastUpdated === "number",
        )
        .map((item) => ({
          worktree: item.worktree.trim(),
          lastUpdated: item.lastUpdated,
        }))
        .filter((item) => isValidWorktree(item.worktree))
    : [];

  const data: SessionDirectoryCacheData = {
    version: CACHE_VERSION,
    lastSyncedUpdatedAt,
    directories,
  };

  dedupeAndTrimDirectories(data);
  return data;
}

function dedupeAndTrimDirectories(data: SessionDirectoryCacheData): void {
  const unique = new Map<string, CachedSessionDirectory>();

  for (const item of data.directories) {
    const key = worktreeKey(item.worktree);
    const existing = unique.get(key);

    if (!existing || existing.lastUpdated < item.lastUpdated) {
      unique.set(key, item);
    }
  }

  data.directories = Array.from(unique.values())
    .sort((a, b) => b.lastUpdated - a.lastUpdated)
    .slice(0, MAX_CACHED_DIRECTORIES);
}

async function ensureCacheLoaded(): Promise<void> {
  if (cacheLoaded) {
    return;
  }

  const storedCache = getSessionDirectoryCache();
  cacheData = normalizeCacheData(storedCache);
  cacheLoaded = true;
  logger.debug(
    `[SessionCache] Loaded ${cacheData.directories.length} directories from settings.sessionDirectoryCache`,
  );
}

function queuePersist(): Promise<void> {
  persistQueue = persistQueue
    .catch(() => {
      // Keep queue chain alive if previous write failed.
    })
    .then(async () => {
      try {
        await setSessionDirectoryCache(cacheData);
      } catch (error) {
        logger.error("[SessionCache] Failed to persist sessions cache", error);
      }
    });

  return persistQueue;
}

function upsertDirectory(worktree: string, lastUpdated: number): boolean {
  if (!isValidWorktree(worktree)) {
    return false;
  }

  const normalizedWorktree = worktree.trim();
  const key = worktreeKey(normalizedWorktree);
  const existingIndex = cacheData.directories.findIndex(
    (item) => worktreeKey(item.worktree) === key,
  );

  if (existingIndex >= 0) {
    const existing = cacheData.directories[existingIndex];
    if (existing.lastUpdated >= lastUpdated) {
      return false;
    }

    cacheData.directories[existingIndex] = {
      worktree: existing.worktree,
      lastUpdated,
    };
  } else {
    cacheData.directories.push({
      worktree: normalizedWorktree,
      lastUpdated,
    });
  }

  dedupeAndTrimDirectories(cacheData);
  return true;
}

function buildListParams(): { limit: number; start?: number } {
  const hasWatermark = cacheData.lastSyncedUpdatedAt > 0;

  if (!hasWatermark) {
    return { limit: INITIAL_WARMUP_LIMIT };
  }

  return {
    limit: INCREMENTAL_SYNC_LIMIT,
    start: Math.max(0, cacheData.lastSyncedUpdatedAt - SYNC_SAFETY_WINDOW_MS),
  };
}

function createVirtualProjectId(worktree: string): string {
  const hash = createHash("sha1").update(worktree).digest("hex").slice(0, 16);
  return `dir_${hash}`;
}

function hasServerUnavailableMarker(value: string): boolean {
  const lower = value.toLowerCase();
  return SERVER_UNAVAILABLE_ERROR_MARKERS.some((marker) => lower.includes(marker));
}

function isServerUnavailableError(error: unknown): boolean {
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.pop();

    if (!current || seen.has(current)) {
      continue;
    }

    seen.add(current);

    if (typeof current === "string") {
      if (hasServerUnavailableMarker(current)) {
        return true;
      }

      continue;
    }

    if (current instanceof Error) {
      if (hasServerUnavailableMarker(`${current.name}: ${current.message}`)) {
        return true;
      }

      const errorWithCause = current as Error & { cause?: unknown };
      if (errorWithCause.cause) {
        queue.push(errorWithCause.cause);
      }

      continue;
    }

    if (typeof current === "object") {
      const value = current as {
        code?: unknown;
        message?: unknown;
        cause?: unknown;
      };

      if (typeof value.code === "string" && hasServerUnavailableMarker(value.code)) {
        return true;
      }

      if (typeof value.message === "string" && hasServerUnavailableMarker(value.message)) {
        return true;
      }

      if (value.cause) {
        queue.push(value.cause);
      }
    }
  }

  return false;
}

async function runSync(): Promise<void> {
  await ensureCacheLoaded();

  const params = buildListParams();
  const { data: sessions, error } = await opencodeClient.session.list(params);

  if (error || !sessions) {
    throw error || new Error("No session list received from server");
  }

  let changed = false;
  let maxUpdated = cacheData.lastSyncedUpdatedAt;

  for (const session of sessions) {
    const updatedAt = session.time?.updated ?? Date.now();
    if (upsertDirectory(session.directory, updatedAt)) {
      changed = true;
    }

    if (updatedAt > maxUpdated) {
      maxUpdated = updatedAt;
    }
  }

  if (maxUpdated !== cacheData.lastSyncedUpdatedAt) {
    cacheData.lastSyncedUpdatedAt = maxUpdated;
    changed = true;
  }

  if (changed) {
    await queuePersist();
  }

  logger.debug(
    `[SessionCache] Synced sessions: fetched=${sessions.length}, directories=${cacheData.directories.length}, lastSyncedUpdatedAt=${cacheData.lastSyncedUpdatedAt}`,
  );
}

function getStorageRootCandidates(pathInfo: { home?: string; state?: string }): string[] {
  const candidates = new Set<string>();

  if (pathInfo.home) {
    candidates.add(path.join(pathInfo.home, ".local", "share", "opencode"));
  }

  if (pathInfo.state) {
    const normalizedState = pathInfo.state.replace(/[\\/]+$/, "");
    const lowerState = normalizedState.toLowerCase();
    const marker = `${path.sep}state${path.sep}opencode`;
    const lowerMarker = marker.toLowerCase();

    if (lowerState.endsWith(lowerMarker)) {
      const prefix = normalizedState.slice(0, normalizedState.length - marker.length);
      candidates.add(path.join(prefix, "share", "opencode"));
    }
  }

  return Array.from(candidates);
}

function getPathApi():
  | {
      get?: () => Promise<{
        data?: { home?: string; state?: string };
        error?: unknown;
      }>;
    }
  | undefined {
  return opencodeClient.path as
    | {
        get?: () => Promise<{
          data?: { home?: string; state?: string };
          error?: unknown;
        }>;
      }
    | undefined;
}

async function getStorageRootsFromApi(): Promise<string[]> {
  const pathApi = getPathApi();
  if (!pathApi?.get) {
    return [];
  }

  const { data: pathInfo, error } = await pathApi.get();
  if (error || !pathInfo) {
    return [];
  }

  return getStorageRootCandidates(pathInfo);
}

async function querySessionDirectoriesFromSqlite(
  dbPath: string,
): Promise<CachedSessionDirectory[] | null> {
  try {
    const db = new Database(dbPath, {
      readonly: true,
      fileMustExist: true,
    });

    try {
      const rows = db
        .prepare(
          `
            SELECT directory, MAX(time_updated) AS updated
            FROM session
            GROUP BY directory
            ORDER BY updated DESC
            LIMIT ?
          `,
        )
        .all(SQLITE_FALLBACK_QUERY_LIMIT) as Array<{ directory?: string; updated?: number | null }>;

      return rows
        .filter(
          (item): item is { directory: string; updated: number | null } =>
            Boolean(item) && typeof item.directory === "string",
        )
        .map((item) => ({
          worktree: item.directory,
          lastUpdated:
            typeof item.updated === "number" && Number.isFinite(item.updated) ? item.updated : 0,
        }));
    } finally {
      db.close();
    }
  } catch (error) {
    logger.debug(`[SessionCache] Failed to read sqlite fallback at ${dbPath}`, error);
  }

  return null;
}

async function ingestFromSqliteSessionDatabase(): Promise<void> {
  await ensureCacheLoaded();

  const fs = await import("node:fs/promises");
  const roots = await getStorageRootsFromApi();

  for (const root of roots) {
    const dbPath = path.join(root, "opencode.db");

    try {
      await fs.access(dbPath);
    } catch {
      continue;
    }

    const rows = await querySessionDirectoriesFromSqlite(dbPath);
    if (!rows || rows.length === 0) {
      continue;
    }

    let changed = false;
    let maxUpdated = cacheData.lastSyncedUpdatedAt;

    for (const row of rows) {
      if (upsertDirectory(row.worktree, row.lastUpdated)) {
        changed = true;
      }

      if (row.lastUpdated > maxUpdated) {
        maxUpdated = row.lastUpdated;
      }
    }

    if (maxUpdated !== cacheData.lastSyncedUpdatedAt) {
      cacheData.lastSyncedUpdatedAt = maxUpdated;
      changed = true;
    }

    if (changed) {
      await queuePersist();
    }

    logger.debug(
      `[SessionCache] SQLite fallback loaded: db=${dbPath}, rows=${rows.length}, directories=${cacheData.directories.length}`,
    );

    return;
  }
}

async function ingestFromGlobalSessionStorage(): Promise<void> {
  await ensureCacheLoaded();

  const fs = await import("node:fs/promises");
  const candidates = await getStorageRootsFromApi();

  for (const storageRoot of candidates) {
    const globalDir = path.join(storageRoot, "storage", "session", "global");

    try {
      const entries = await fs.readdir(globalDir, { withFileTypes: true });
      const sessionFiles = entries.filter(
        (entry) => entry.isFile() && entry.name.endsWith(".json"),
      );

      const withMtime = await Promise.all(
        sessionFiles.map(async (entry) => {
          const fullPath = path.join(globalDir, entry.name);
          const stat = await fs.stat(fullPath);
          return { fullPath, mtimeMs: stat.mtimeMs };
        }),
      );

      const sorted = withMtime
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .slice(0, STORAGE_FALLBACK_SCAN_LIMIT);

      let changed = false;
      let maxUpdated = cacheData.lastSyncedUpdatedAt;

      for (const file of sorted) {
        try {
          const raw = await fs.readFile(file.fullPath, "utf-8");
          const session = JSON.parse(raw) as {
            directory?: string;
            time?: { updated?: number };
          };

          if (!session.directory) {
            continue;
          }

          const updated = session.time?.updated ?? Math.trunc(file.mtimeMs);
          if (upsertDirectory(session.directory, updated)) {
            changed = true;
          }

          if (updated > maxUpdated) {
            maxUpdated = updated;
          }
        } catch {
          // Ignore malformed session files.
        }
      }

      if (maxUpdated !== cacheData.lastSyncedUpdatedAt) {
        cacheData.lastSyncedUpdatedAt = maxUpdated;
        changed = true;
      }

      if (changed) {
        await queuePersist();
      }

      logger.debug(
        `[SessionCache] Storage fallback loaded: root=${storageRoot}, scanned=${sorted.length}, directories=${cacheData.directories.length}`,
      );

      return;
    } catch {
      // Try next candidate path.
    }
  }
}

export async function warmupSessionDirectoryCache(): Promise<void> {
  await syncSessionDirectoryCache({ force: true });

  try {
    await ingestFromSqliteSessionDatabase();
  } catch (error) {
    logger.warn("[SessionCache] Failed sqlite fallback warmup", error);
  }

  try {
    await ingestFromGlobalSessionStorage();
  } catch (error) {
    logger.warn("[SessionCache] Failed storage fallback warmup", error);
  }
}

export async function syncSessionDirectoryCache(options?: { force?: boolean }): Promise<void> {
  await ensureCacheLoaded();

  if (!options?.force && Date.now() - lastSyncAttemptAt < SYNC_COOLDOWN_MS) {
    return;
  }

  if (syncInFlight) {
    return syncInFlight;
  }

  syncInFlight = runSync()
    .then(() => {
      lastSyncAttemptAt = Date.now();
    })
    .catch((error) => {
      if (isServerUnavailableError(error)) {
        logger.warn("[SessionCache] OpenCode server is not running. Start it with: opencode serve");
      } else {
        logger.warn("[SessionCache] Failed to sync sessions cache", error);
      }

      lastSyncAttemptAt = 0;
    })
    .finally(() => {
      syncInFlight = null;
    });

  return syncInFlight;
}

export async function getCachedSessionDirectories(): Promise<CachedSessionDirectory[]> {
  await ensureCacheLoaded();
  return cacheData.directories.map((item) => ({ ...item }));
}

export async function getCachedSessionProjects(): Promise<SessionDirectoryProject[]> {
  const directories = await getCachedSessionDirectories();

  return directories.map((item) => ({
    id: createVirtualProjectId(item.worktree),
    worktree: item.worktree,
    name: item.worktree,
    lastUpdated: item.lastUpdated,
  }));
}

export async function upsertSessionDirectory(
  worktree: string,
  lastUpdated: number = Date.now(),
): Promise<void> {
  await ensureCacheLoaded();

  if (!upsertDirectory(worktree, lastUpdated)) {
    return;
  }

  if (lastUpdated > cacheData.lastSyncedUpdatedAt) {
    cacheData.lastSyncedUpdatedAt = lastUpdated;
  }

  await queuePersist();
}

export async function ingestSessionInfoForCache(session: {
  directory?: string;
  time?: { updated?: number };
}): Promise<void> {
  const directory = session.directory;
  if (!directory) {
    return;
  }

  const updated = session.time?.updated ?? Date.now();
  await upsertSessionDirectory(directory, updated);
}

export function __resetSessionDirectoryCacheForTests(): void {
  cacheData = createEmptyCacheData();
  cacheLoaded = false;
  syncInFlight = null;
  lastSyncAttemptAt = 0;
  persistQueue = Promise.resolve();
}
