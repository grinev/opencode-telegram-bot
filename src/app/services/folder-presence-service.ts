import path from "node:path";
import { opencodeServerVersion, opencodeV2Client } from "../../opencode/client.js";
import { logger } from "../../utils/logger.js";

/**
 * Whether a folder still exists, as the OpenCode server sees it. "unknown" covers every
 * answer that is not a confirmed absence, and callers treat it as "present".
 */
export type FolderPresence = "present" | "missing" | "unknown";

/** The global project of non-git folders; it is never a folder that can vanish. */
const GLOBAL_PROJECT_FOLDER = "/";

// The folder's own listing failed with a 500, the server's answer for a folder it cannot resolve.
const SERVER_ERROR = "server_error";
const OTHER_FAILURE = "other_failure";

type FolderListing = string[] | typeof SERVER_ERROR | typeof OTHER_FAILURE;

// Server paths are read in the server's style, which may differ from the bot's (Docker).
function pathStyleOf(folder: string): typeof path.win32 | typeof path.posix {
  return /^[a-zA-Z]:[\\/]/.test(folder) || /^\\\\/.test(folder) ? path.win32 : path.posix;
}

function isServerError(error: unknown): boolean {
  if (!(error instanceof Error) || error.name !== "ClientError") {
    return false;
  }
  const { reason, cause } = error as Error & { reason?: unknown; cause?: unknown };
  return (
    reason === "UnexpectedStatus" && (cause as { status?: unknown } | undefined)?.status === 500
  );
}

async function listFolder(folder: string): Promise<FolderListing> {
  const { data, error } = await opencodeV2Client.file.list({ path: folder });
  if (data) {
    return data;
  }
  logger.debug(`[FolderPresence] Listing failed for ${folder}:`, error);
  return isServerError(error) ? SERVER_ERROR : OTHER_FAILURE;
}

function namesMatch(pathStyle: typeof path.win32 | typeof path.posix, left: string, right: string) {
  return pathStyle === path.win32 ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/**
 * Asks the server about one folder. It counts as missing only when its own listing fails
 * with a 500 and the nearest ancestor the server still lists has no entry on the way to it;
 * any other answer is "unknown", so a folder the server merely failed to answer for stays.
 */
export async function checkFolderPresence(folder: string): Promise<FolderPresence> {
  if (folder === GLOBAL_PROJECT_FOLDER) {
    return "present";
  }
  if (opencodeServerVersion !== "v2") {
    return "unknown";
  }

  const own = await listFolder(folder);
  if (Array.isArray(own)) {
    return "present";
  }
  if (own !== SERVER_ERROR) {
    return "unknown";
  }

  const pathStyle = pathStyleOf(folder);
  let child = folder;
  let parent = pathStyle.dirname(child);
  while (parent !== child) {
    const entries = await listFolder(parent);
    if (Array.isArray(entries)) {
      const name = pathStyle.basename(child);
      const listed = entries.some((entry) =>
        namesMatch(pathStyle, pathStyle.basename(entry.replace(/[\\/]+$/, "")), name),
      );
      if (listed) {
        return "unknown";
      }
      logger.info(`[FolderPresence] Folder no longer exists on the OpenCode server: ${folder}`);
      return "missing";
    }
    if (entries !== SERVER_ERROR) {
      return "unknown";
    }
    child = parent;
    parent = pathStyle.dirname(child);
  }
  return "unknown";
}

/** The folders among these that the server confirms are gone; each is asked about once. */
export async function findMissingFolders(folders: Iterable<string>): Promise<Set<string>> {
  const unique = [...new Set(folders)];
  const presences = await Promise.all(unique.map((folder) => checkFolderPresence(folder)));
  return new Set(unique.filter((_, index) => presences[index] === "missing"));
}

/**
 * Reads a list newest-first, leaving out items whose folder is excluded or gone, and asks
 * the source for more until at least `wanted` items remain or the source has no more.
 * Returns every remaining item read, in source order.
 */
export async function collectFromPresentFolders<T>(
  fetchItems: (limit: number) => Promise<T[]>,
  folderOf: (item: T) => string,
  wanted: number,
  isExcluded?: (folder: string) => boolean,
): Promise<T[]> {
  const missingByFolder = new Map<string, boolean>();
  let limit = Math.max(1, wanted);
  for (;;) {
    const items = await fetchItems(limit);
    const candidates = isExcluded ? items.filter((item) => !isExcluded(folderOf(item))) : items;
    const unchecked = [...new Set(candidates.map(folderOf))].filter(
      (folder) => !missingByFolder.has(folder),
    );
    const missing = await findMissingFolders(unchecked);
    for (const folder of unchecked) {
      missingByFolder.set(folder, missing.has(folder));
    }
    const visible = candidates.filter((item) => !missingByFolder.get(folderOf(item)));
    if (visible.length >= wanted || items.length < limit) {
      return visible;
    }
    limit *= 2;
  }
}
