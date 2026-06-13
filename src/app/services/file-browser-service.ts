import { promises as fs } from "node:fs";
import { realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { t } from "../../i18n/index.js";
import { getCurrentProject } from "../stores/settings-store.js";
import { logger } from "../../utils/logger.js";

export interface DirectoryEntry {
  name: string;
  fullPath: string;
}

export interface DirectoryScanResult {
  entries: DirectoryEntry[];
  totalCount: number;
  page: number;
  currentPath: string;
  displayPath: string;
  hasParent: boolean;
  parentPath: string | null;
}

export interface DirectoryScanError {
  error: string;
  code: "ENOENT" | "EACCES" | "ENOTDIR" | "UNKNOWN";
}

export interface LsEntry {
  name: string;
  fullPath: string;
  type: "file" | "directory";
}

export interface LsDirectoryScanResult {
  entries: LsEntry[];
  totalCount: number;
  currentPath: string;
  displayPath: string;
  hasParent: boolean;
  page: number;
}

export interface FileDetails {
  name: string;
  fullPath: string;
  size: number;
  modified: Date;
}

export const MAX_ENTRIES_PER_PAGE = 8;

let resolvedRoots: string[] | null = null;

export function getHomeDirectory(): string {
  return os.homedir();
}

export function pathToDisplayPath(absolutePath: string): string {
  const home = getHomeDirectory();
  if (absolutePath === home) {
    return "~";
  }

  if (absolutePath.startsWith(home + path.sep)) {
    return "~" + absolutePath.slice(home.length);
  }

  return absolutePath;
}

export async function scanDirectory(
  dirPath: string,
  page: number = 0,
): Promise<DirectoryScanResult | DirectoryScanError> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const subdirs: DirectoryEntry[] = [];

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        subdirs.push({
          name: entry.name,
          fullPath: path.join(dirPath, entry.name),
        });
      }
    }

    subdirs.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

    const parentPath = path.dirname(dirPath);
    const hasParent = dirPath !== path.parse(dirPath).root;
    const totalPages = Math.max(1, Math.ceil(subdirs.length / MAX_ENTRIES_PER_PAGE));
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const start = safePage * MAX_ENTRIES_PER_PAGE;

    return {
      entries: subdirs.slice(start, start + MAX_ENTRIES_PER_PAGE),
      totalCount: subdirs.length,
      page: safePage,
      currentPath: dirPath,
      displayPath: pathToDisplayPath(dirPath),
      hasParent,
      parentPath: hasParent ? parentPath : null,
    };
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      const code = error.code as string;
      if (code === "ENOENT" || code === "ELOOP") {
        return { error: `Directory not found: ${dirPath}`, code: "ENOENT" };
      }
      if (code === "EACCES" || code === "EPERM") {
        return { error: `Permission denied: ${dirPath}`, code: "EACCES" };
      }
      if (code === "ENOTDIR") {
        return { error: `Not a directory: ${dirPath}`, code: "ENOTDIR" };
      }
    }

    return {
      error: error instanceof Error ? error.message : "Unknown error",
      code: "UNKNOWN",
    };
  }
}

export function buildEntryLabel(entry: DirectoryEntry): string {
  return `📁 ${entry.name}`;
}

export function buildTreeHeader(
  displayPath: string,
  totalCount: number,
  page: number,
  totalPages: number,
): string {
  let header = `📂 ${displayPath}`;
  if (totalPages > 1) {
    header += `  (${page + 1}/${totalPages})`;
  }
  if (totalCount === 0) {
    header += `\n${t("open.no_subfolders")}`;
  } else if (totalCount === 1) {
    header += `\n${t("open.subfolder_count", { count: String(totalCount) })}`;
  } else {
    header += `\n${t("open.subfolders_count", { count: String(totalCount) })}`;
  }
  return header;
}

export function isScanError(
  result: DirectoryScanResult | DirectoryScanError,
): result is DirectoryScanError {
  return "error" in result;
}

function isWindows(): boolean {
  return process.platform === "win32";
}

function expandTilde(p: string): string {
  if (p === "~") {
    return os.homedir();
  }
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

function resolveConfiguredPath(p: string): string {
  return path.resolve(expandTilde(p));
}

function normalizePath(p: string): string {
  const resolved = resolveConfiguredPath(p);
  return isWindows() ? resolved.toLowerCase() : resolved;
}

export function initBrowserRoots(raw?: string): void {
  if (!raw || raw.trim() === "") {
    resolvedRoots = [resolveConfiguredPath(os.homedir())];
    logger.debug(
      `[BrowserRoots] No OPEN_BROWSER_ROOTS configured, defaulting to home: ${resolvedRoots[0]}`,
    );
    return;
  }

  const entries = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const roots = entries.map((entry) => resolveConfiguredPath(entry));
  if (roots.length === 0) {
    resolvedRoots = [resolveConfiguredPath(os.homedir())];
    logger.warn("[BrowserRoots] All configured roots were invalid, falling back to home directory");
  } else {
    resolvedRoots = roots;
    logger.info(`[BrowserRoots] Configured roots: ${roots.join(", ")}`);
  }
}

export function getBrowserRoots(): string[] {
  if (resolvedRoots === null) {
    initBrowserRoots(process.env.OPEN_BROWSER_ROOTS);
  }
  return resolvedRoots!;
}

export function getBrowserRootPaths(): string[] {
  return getBrowserRoots();
}

export function isWithinAllowedRoot(targetPath: string): boolean {
  const normalizedTarget = normalizePath(targetPath);

  for (const root of getBrowserRoots()) {
    const normalizedRoot = normalizePath(root);

    if (normalizedTarget === normalizedRoot) {
      return true;
    }

    if (
      normalizedTarget.startsWith(normalizedRoot + "/") ||
      normalizedTarget.startsWith(normalizedRoot + "\\")
    ) {
      return true;
    }
  }

  return false;
}

export async function isWithinAllowedRootSafe(targetPath: string): Promise<boolean> {
  let resolved = targetPath;
  try {
    resolved = await realpath(targetPath);
  } catch {
    // Path doesn't exist yet or can't be resolved; use the original value.
  }
  return isWithinAllowedRoot(resolved);
}

export function isAllowedRoot(targetPath: string): boolean {
  const normalizedTarget = normalizePath(targetPath);
  return getBrowserRoots().some((root) => normalizePath(root) === normalizedTarget);
}

export function __resetBrowserRootsForTests(): void {
  resolvedRoots = null;
}

function usesWindowsPath(filePath: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(filePath) || filePath.startsWith("\\\\");
}

function getPathApi(filePath: string): typeof path.posix {
  return usesWindowsPath(filePath) ? path.win32 : path.posix;
}

export function joinPath(parentPath: string, childName: string): string {
  return getPathApi(parentPath).join(parentPath, childName);
}

export function getBaseName(filePath: string): string {
  return getPathApi(filePath).basename(filePath);
}

export function getParentPath(filePath: string): string {
  return getPathApi(filePath).dirname(filePath);
}

function getRootPath(filePath: string): string {
  return getPathApi(filePath).parse(filePath).root;
}

function isSamePath(leftPath: string, rightPath: string): boolean {
  return getPathApi(rightPath).relative(rightPath, leftPath) === "";
}

export function isPathWithinDirectory(targetPath: string, directoryPath: string): boolean {
  const pathApi = getPathApi(directoryPath);
  const relativePath = pathApi.relative(directoryPath, targetPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !pathApi.isAbsolute(relativePath));
}

export function getProjectRoot(): string | null {
  return getCurrentProject()?.worktree ?? null;
}

export function isWithinProjectRoot(targetPath: string): boolean {
  const projectRoot = getProjectRoot();
  return projectRoot !== null && isPathWithinDirectory(targetPath, projectRoot);
}

export function isProjectRoot(targetPath: string): boolean {
  const projectRoot = getProjectRoot();
  return projectRoot !== null && isSamePath(targetPath, projectRoot);
}

export async function scanLsDirectory(
  dirPath: string,
  page: number = 0,
): Promise<LsDirectoryScanResult | { error: string }> {
  try {
    if (!isWithinProjectRoot(dirPath)) {
      return { error: t("ls.access_denied") };
    }

    const dirEntries = await fs.readdir(dirPath, { withFileTypes: true });
    const entries: LsEntry[] = dirEntries
      .map((entry): LsEntry => ({
        name: entry.name,
        fullPath: joinPath(dirPath, entry.name),
        type: entry.isDirectory() ? "directory" : "file",
      }))
      .sort((left, right) => {
        if (left.type !== right.type) {
          return left.type === "directory" ? -1 : 1;
        }

        return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
      });

    const totalPages = Math.max(1, Math.ceil(entries.length / MAX_ENTRIES_PER_PAGE));
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const startIndex = safePage * MAX_ENTRIES_PER_PAGE;

    return {
      entries: entries.slice(startIndex, startIndex + MAX_ENTRIES_PER_PAGE),
      totalCount: entries.length,
      currentPath: dirPath,
      displayPath: pathToDisplayPath(dirPath),
      hasParent: dirPath !== getRootPath(dirPath),
      page: safePage,
    };
  } catch (error) {
    return {
      error: `${t("ls.scan_error")}: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

export async function getFileDetails(filePath: string): Promise<FileDetails | { error: string }> {
  try {
    if (!isWithinProjectRoot(filePath)) {
      return { error: t("ls.access_denied") };
    }

    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      return { error: t("commands.download.not_file") };
    }

    return {
      name: getBaseName(filePath),
      fullPath: filePath,
      size: stat.size,
      modified: stat.mtime,
    };
  } catch (error) {
    return {
      error: `${t("ls.scan_error")}: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}
