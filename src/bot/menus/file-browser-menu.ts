import { InlineKeyboard } from "grammy";
import path from "node:path";
import { formatFileSize } from "../../app/services/file-download-service.js";
import {
  buildEntryLabel,
  buildTreeHeader,
  getBrowserRoots,
  getFileDetails,
  getParentPath,
  isAllowedRoot,
  isProjectRoot,
  MAX_ENTRIES_PER_PAGE,
  pathToDisplayPath,
  scanDirectory,
  scanLsDirectory,
  type DirectoryEntry,
  type FileDetails,
  type LsEntry,
} from "../../app/services/file-browser-service.js";
import { t } from "../../i18n/index.js";
import { appendInlineMenuCancelButton } from "./inline-menu.js";

export const OPEN_CALLBACK_PREFIX = "open:";
export const OPEN_CALLBACK_NAV_PREFIX = "open:nav:";
export const OPEN_CALLBACK_SELECT_PREFIX = "open:sel:";
export const OPEN_CALLBACK_PAGE_PREFIX = "open:pg:";
export const OPEN_CALLBACK_ROOTS = "open:roots";

export const LS_CALLBACK_PREFIX = "ls:";
export const LS_CALLBACK_NAV_PREFIX = "ls:nav:";
export const LS_CALLBACK_FILE_PREFIX = "ls:file:";
export const LS_CALLBACK_DOWNLOAD_PREFIX = "ls:download:";
export const LS_CALLBACK_BACK_PREFIX = "ls:back:";
export const LS_CALLBACK_PAGE_PREFIX = "ls:pg:";

const PAGE_SEPARATOR = "|";
const MAX_BUTTON_LABEL_LENGTH = 64;

const openPathIndex = new Map<string, string>();
const lsPathIndex = new Map<string, string>();
let openPathCounter = 0;
let lsPathCounter = 0;

export function clearOpenPathIndex(): void {
  openPathIndex.clear();
  openPathCounter = 0;
}

export function clearLsPathIndex(): void {
  lsPathIndex.clear();
  lsPathCounter = 0;
}

function truncateLabel(label: string, maxLen: number = MAX_BUTTON_LABEL_LENGTH): string {
  if (label.length <= maxLen) {
    return label;
  }

  return `${label.slice(0, Math.max(0, maxLen - 3))}...`;
}

function encodePathForCallback(
  pathIndex: Map<string, string>,
  nextCounter: () => number,
  prefix: string,
  fullPath: string,
  reserveBytes: number = 0,
): string {
  const naive = `${prefix}${fullPath}`;
  if (Buffer.byteLength(naive, "utf-8") + reserveBytes <= 64) {
    return naive;
  }

  const key = `#${nextCounter()}`;
  pathIndex.set(key, fullPath);
  return `${prefix}${key}`;
}

function decodePathFromCallback(
  pathIndex: Map<string, string>,
  prefix: string,
  data: string,
): string | null {
  if (!data.startsWith(prefix)) {
    return null;
  }

  const raw = data.slice(prefix.length);
  if (raw.startsWith("#")) {
    return pathIndex.get(raw) ?? null;
  }

  return raw;
}

export function encodeOpenPathForCallback(prefix: string, fullPath: string, reserveBytes = 0): string {
  return encodePathForCallback(
    openPathIndex,
    () => openPathCounter++,
    prefix,
    fullPath,
    reserveBytes,
  );
}

export function decodeOpenPathFromCallback(prefix: string, data: string): string | null {
  return decodePathFromCallback(openPathIndex, prefix, data);
}

export function encodeLsPathForCallback(prefix: string, fullPath: string, reserveBytes = 0): string {
  return encodePathForCallback(
    lsPathIndex,
    () => lsPathCounter++,
    prefix,
    fullPath,
    reserveBytes,
  );
}

export function decodeLsPathFromCallback(prefix: string, data: string): string | null {
  return decodePathFromCallback(lsPathIndex, prefix, data);
}

function encodeOpenPaginationCallback(currentPath: string, page: number): string {
  const pageSuffix = `${PAGE_SEPARATOR}${page}`;
  const reserveBytes = Buffer.byteLength(pageSuffix, "utf-8");
  return `${encodeOpenPathForCallback(OPEN_CALLBACK_PAGE_PREFIX, currentPath, reserveBytes)}${pageSuffix}`;
}

export function decodeOpenPaginationCallback(data: string): { path: string; page: number } | null {
  return decodePathWithPageCallback(openPathIndex, data, OPEN_CALLBACK_PAGE_PREFIX);
}

function encodeLsPathWithPageCallback(prefix: string, fullPath: string, page: number): string {
  const pageSuffix = `${PAGE_SEPARATOR}${page}`;
  const reserveBytes = Buffer.byteLength(pageSuffix, "utf-8");
  return `${encodeLsPathForCallback(prefix, fullPath, reserveBytes)}${pageSuffix}`;
}

export function decodeLsPathWithPageCallback(
  data: string,
  prefix: string,
): { path: string; page: number } | null {
  return decodePathWithPageCallback(lsPathIndex, data, prefix);
}

function decodePathWithPageCallback(
  pathIndex: Map<string, string>,
  data: string,
  prefix: string,
): { path: string; page: number } | null {
  if (!data.startsWith(prefix)) {
    return null;
  }

  const payload = data.slice(prefix.length);
  const separatorIndex = payload.lastIndexOf(PAGE_SEPARATOR);
  if (separatorIndex < 0) {
    return null;
  }

  const pathRef = payload.slice(0, separatorIndex);
  const page = Number.parseInt(payload.slice(separatorIndex + 1), 10);
  if (Number.isNaN(page)) {
    return null;
  }

  const resolvedPath = pathRef.startsWith("#") ? (pathIndex.get(pathRef) ?? null) : pathRef;
  if (resolvedPath === null) {
    return null;
  }

  return { path: resolvedPath, page };
}

function buildOpenBrowseKeyboard(
  entries: DirectoryEntry[],
  currentPath: string,
  hasParent: boolean,
  page: number,
  totalCount: number,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const totalPages = Math.max(1, Math.ceil(totalCount / MAX_ENTRIES_PER_PAGE));

  for (const entry of entries) {
    const label = truncateLabel(buildEntryLabel(entry));
    keyboard.text(label, encodeOpenPathForCallback(OPEN_CALLBACK_NAV_PREFIX, entry.fullPath)).row();
  }

  const atRoot = isAllowedRoot(currentPath);
  const showUp = hasParent && !atRoot;
  const showRoots = getBrowserRoots().length > 1;

  if (showUp || showRoots) {
    if (showUp) {
      const parentPath = path.dirname(currentPath);
      keyboard.text(t("open.back"), encodeOpenPathForCallback(OPEN_CALLBACK_NAV_PREFIX, parentPath));
    }
    if (showRoots) {
      keyboard.text(t("open.roots"), OPEN_CALLBACK_ROOTS);
    }
    keyboard.row();
  }

  if (totalPages > 1) {
    if (page > 0) {
      keyboard.text(t("open.prev_page"), encodeOpenPaginationCallback(currentPath, page - 1));
    }
    if (page < totalPages - 1) {
      keyboard.text(t("open.next_page"), encodeOpenPaginationCallback(currentPath, page + 1));
    }
    keyboard.row();
  }

  keyboard
    .text(t("open.select_current"), encodeOpenPathForCallback(OPEN_CALLBACK_SELECT_PREFIX, currentPath))
    .row();
  appendInlineMenuCancelButton(keyboard, "open");

  return keyboard;
}

export async function renderOpenBrowseView(dirPath: string, page: number = 0) {
  const result = await scanDirectory(dirPath, page);

  if ("error" in result) {
    return { error: result.error };
  }

  const totalPages = Math.max(1, Math.ceil(result.totalCount / MAX_ENTRIES_PER_PAGE));
  return {
    text: buildTreeHeader(result.displayPath, result.totalCount, result.page, totalPages),
    keyboard: buildOpenBrowseKeyboard(
      result.entries,
      result.currentPath,
      result.hasParent,
      result.page,
      result.totalCount,
    ),
  };
}

export function buildOpenRootsKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  for (const root of getBrowserRoots()) {
    const label = truncateLabel(`📂 ${pathToDisplayPath(root)}`);
    keyboard.text(label, encodeOpenPathForCallback(OPEN_CALLBACK_NAV_PREFIX, root)).row();
  }

  appendInlineMenuCancelButton(keyboard, "open");
  return keyboard;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildLsEntryLabel(entry: LsEntry): string {
  return `${entry.type === "directory" ? "📁" : "📄"} ${entry.name}`;
}

function buildLsHeader(displayPath: string, totalCount: number, page: number, totalPages: number): string {
  let header = `📁 ${t("ls.header")}\n<code>${escapeHtml(displayPath)}</code>`;
  if (totalPages > 1) {
    header += `\n(${page + 1}/${totalPages})`;
  }
  header += `\n${t("ls.total", { count: totalCount })}`;
  return header;
}

function buildFileDetailsText(fileDetails: FileDetails): string {
  return (
    `📄 ${t("ls.file.header")}\n<code>${escapeHtml(fileDetails.name)}</code>\n` +
    `${t("commands.download.size")}: ${formatFileSize(fileDetails.size)}\n` +
    `${t("commands.download.modified")}: ${fileDetails.modified.toLocaleDateString()}`
  );
}

function encodeLsPaginationCallback(currentPath: string, page: number): string {
  return encodeLsPathWithPageCallback(LS_CALLBACK_PAGE_PREFIX, currentPath, page);
}

export function decodeLsPaginationCallback(data: string): { path: string; page: number } | null {
  return decodeLsPathWithPageCallback(data, LS_CALLBACK_PAGE_PREFIX);
}

function encodeLsFileCallback(fullPath: string, page: number): string {
  return encodeLsPathWithPageCallback(LS_CALLBACK_FILE_PREFIX, fullPath, page);
}

export function decodeLsFileCallback(data: string): { path: string; page: number } | null {
  return decodeLsPathWithPageCallback(data, LS_CALLBACK_FILE_PREFIX);
}

function encodeLsBackCallback(directoryPath: string, page: number): string {
  return encodeLsPathWithPageCallback(LS_CALLBACK_BACK_PREFIX, directoryPath, page);
}

export function decodeLsBackCallback(data: string): { path: string; page: number } | null {
  return decodeLsPathWithPageCallback(data, LS_CALLBACK_BACK_PREFIX);
}

function buildLsBrowseKeyboard(
  entries: LsEntry[],
  currentPath: string,
  hasParent: boolean,
  page: number,
  totalCount: number,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const totalPages = Math.max(1, Math.ceil(totalCount / MAX_ENTRIES_PER_PAGE));

  for (const entry of entries) {
    const label = truncateLabel(buildLsEntryLabel(entry));
    const callbackData =
      entry.type === "directory"
        ? encodeLsPathForCallback(LS_CALLBACK_NAV_PREFIX, entry.fullPath)
        : encodeLsFileCallback(entry.fullPath, page);
    keyboard.text(label, callbackData).row();
  }

  if (hasParent && !isProjectRoot(currentPath)) {
    keyboard
      .text(t("open.back"), encodeLsPathForCallback(LS_CALLBACK_NAV_PREFIX, getParentPath(currentPath)))
      .row();
  }

  if (totalPages > 1) {
    if (page > 0) {
      keyboard.text(t("open.prev_page"), encodeLsPaginationCallback(currentPath, page - 1));
    }
    if (page < totalPages - 1) {
      keyboard.text(t("open.next_page"), encodeLsPaginationCallback(currentPath, page + 1));
    }
    keyboard.row();
  }

  appendInlineMenuCancelButton(keyboard, "ls");
  return keyboard;
}

function buildLsFileDetailsKeyboard(filePath: string, page: number): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const parentPath = getParentPath(filePath);

  keyboard.text(t("ls.file.download"), encodeLsPathForCallback(LS_CALLBACK_DOWNLOAD_PREFIX, filePath));
  keyboard.text(t("ls.file.back"), encodeLsBackCallback(parentPath, page));
  keyboard.row();
  appendInlineMenuCancelButton(keyboard, "ls");
  return keyboard;
}

function hasBrowseActions(currentPath: string, hasParent: boolean, totalCount: number): boolean {
  if (totalCount > 0) {
    return true;
  }

  return hasParent && !isProjectRoot(currentPath);
}

export async function renderLsBrowseView(dirPath: string, page: number = 0) {
  const result = await scanLsDirectory(dirPath, page);
  if ("error" in result) {
    return result;
  }

  const totalPages = Math.max(1, Math.ceil(result.totalCount / MAX_ENTRIES_PER_PAGE));
  return {
    text: buildLsHeader(result.displayPath, result.totalCount, result.page, totalPages),
    hasActions: hasBrowseActions(result.currentPath, result.hasParent, result.totalCount),
    keyboard: buildLsBrowseKeyboard(
      result.entries,
      result.currentPath,
      result.hasParent,
      result.page,
      result.totalCount,
    ),
  };
}

export async function renderLsFileDetailsView(filePath: string, page: number) {
  const fileDetails = await getFileDetails(filePath);
  if ("error" in fileDetails) {
    return fileDetails;
  }

  return {
    text: buildFileDetailsText(fileDetails),
    keyboard: buildLsFileDetailsKeyboard(fileDetails.fullPath, page),
  };
}
