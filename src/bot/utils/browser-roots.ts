import path from "node:path";
import { realpath } from "node:fs/promises";
import os from "node:os";
import { logger } from "../../utils/logger.js";

/**
 * Allowed root directories for the `/open` command.
 *
 * Configured via `OPEN_BROWSER_ROOTS` env var (comma-separated absolute paths).
 * Defaults to `[os.homedir()]` when the variable is not set.
 *
 * All navigation in the directory browser is restricted to stay within one
 * of the configured roots. This prevents the bot from browsing arbitrary
 * locations on the filesystem.
 */
let resolvedRoots: string[] | null = null;

function isWindows(): boolean {
  return process.platform === "win32";
}

/**
 * Normalize a path for comparison: resolve, then lowercase on Windows.
 */
function normalizePath(p: string): string {
  const resolved = path.resolve(p);
  return isWindows() ? resolved.toLowerCase() : resolved;
}

/**
 * Initialize (or re-initialize) the allowed browser roots from the raw
 * env string. Each entry is resolved to an absolute path via `path.resolve`.
 *
 * Entries that cannot be resolved are logged and skipped.
 */
export function initBrowserRoots(raw?: string): void {
  if (!raw || raw.trim() === "") {
    resolvedRoots = [normalizePath(os.homedir())];
    logger.debug(
      `[BrowserRoots] No OPEN_BROWSER_ROOTS configured, defaulting to home: ${resolvedRoots[0]}`,
    );
    return;
  }

  const entries = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const roots: string[] = [];
  for (const entry of entries) {
    const normalized = normalizePath(entry);
    roots.push(normalized);
  }

  if (roots.length === 0) {
    resolvedRoots = [normalizePath(os.homedir())];
    logger.warn("[BrowserRoots] All configured roots were invalid, falling back to home directory");
  } else {
    resolvedRoots = roots;
    logger.info(`[BrowserRoots] Configured roots: ${roots.join(", ")}`);
  }
}

/**
 * Return the configured browser roots. Lazily initializes from env if
 * `initBrowserRoots` was never called.
 */
export function getBrowserRoots(): string[] {
  if (resolvedRoots === null) {
    initBrowserRoots(process.env.OPEN_BROWSER_ROOTS);
  }
  return resolvedRoots!;
}

/**
 * Return the original (non-normalized) root paths for display/navigation.
 * On Windows the display roots are lowercased because `normalizePath` is
 * used during init — this is acceptable for button labels.
 */
export function getBrowserRootPaths(): string[] {
  return getBrowserRoots();
}

/**
 * Check whether a target path is inside one of the allowed roots.
 *
 * Uses `path.resolve` on the target for consistent comparison, then
 * checks that the target equals a root or is a descendant (starts with
 * root + separator).
 *
 * For full symlink-proof validation, callers can optionally resolve the
 * target with `fs.realpath` before calling this function.
 */
export function isWithinAllowedRoot(targetPath: string): boolean {
  const normalizedTarget = normalizePath(targetPath);
  const roots = getBrowserRoots();

  for (const root of roots) {
    if (normalizedTarget === root) {
      return true;
    }
    // Check both separators — `path.sep` is always `/` on Unix but a
    // lowercased Windows path may contain either `\` or `/`.
    if (normalizedTarget.startsWith(root + "/") || normalizedTarget.startsWith(root + "\\")) {
      return true;
    }
  }

  return false;
}

/**
 * Like `isWithinAllowedRoot` but resolves symlinks first using `realpath`.
 * Falls back to the plain path if `realpath` fails (e.g. ENOENT).
 */
export async function isWithinAllowedRootSafe(targetPath: string): Promise<boolean> {
  let resolved = targetPath;
  try {
    resolved = await realpath(targetPath);
  } catch {
    // Path doesn't exist yet or can't be resolved — use as-is
  }
  return isWithinAllowedRoot(resolved);
}

/**
 * Check whether a path is exactly one of the allowed roots (not a descendant).
 */
export function isAllowedRoot(targetPath: string): boolean {
  const normalizedTarget = normalizePath(targetPath);
  return getBrowserRoots().includes(normalizedTarget);
}

/** Reset state — for testing only. */
export function __resetBrowserRootsForTests(): void {
  resolvedRoots = null;
}
