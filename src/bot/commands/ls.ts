import { CommandContext, Context, InlineKeyboard } from "grammy";
import path from "node:path";
import { promises as fs } from "node:fs";
import os from "node:os";
import {
  appendInlineMenuCancelButton,
  clearActiveInlineMenu,
  ensureActiveInlineMenu,
} from "../handlers/inline-menu.js";
import { interactionManager } from "../../interaction/manager.js";
import { isForegroundBusy, replyBusyBlocked } from "../utils/busy-guard.js";
import { getCurrentProject } from "../../settings/manager.js";
import { sendDownloadedFile } from "../utils/send-downloaded-file.js";
import { formatFileSize } from "../utils/file-download.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";

const CALLBACK_PREFIX = "ls:";
const CALLBACK_NAV_PREFIX = "ls:nav:";
const CALLBACK_FILE_PREFIX = "ls:file:";
const CALLBACK_DOWNLOAD_PREFIX = "ls:download:";
const CALLBACK_BACK_PREFIX = "ls:back:";
const CALLBACK_PAGE_PREFIX = "ls:pg:";
const PAGE_SEPARATOR = "|";
const MAX_ENTRIES_PER_PAGE = 8;
const MAX_BUTTON_LABEL_LENGTH = 64;

const sessionDirectories = new Map<number, string>();
const pathIndex = new Map<string, string>();
let pathCounter = 0;

interface LsEntry {
  name: string;
  fullPath: string;
  type: "file" | "directory";
}

interface FileDetails {
  name: string;
  fullPath: string;
  size: number;
  modified: Date;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncateLabel(label: string, maxLen: number = MAX_BUTTON_LABEL_LENGTH): string {
  if (label.length <= maxLen) {
    return label;
  }

  return `${label.slice(0, Math.max(0, maxLen - 3))}...`;
}

function pathToDisplayPath(absolutePath: string): string {
  const home = os.homedir();
  if (absolutePath === home) {
    return "~";
  }

  if (absolutePath.startsWith(home + path.sep)) {
    return `~${absolutePath.slice(home.length)}`;
  }

  return absolutePath;
}

function usesWindowsPath(filePath: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(filePath) || filePath.startsWith("\\\\");
}

function getPathApi(filePath: string): typeof path.posix {
  return usesWindowsPath(filePath) ? path.win32 : path.posix;
}

function joinPath(parentPath: string, childName: string): string {
  return getPathApi(parentPath).join(parentPath, childName);
}

function getBaseName(filePath: string): string {
  return getPathApi(filePath).basename(filePath);
}

function getParentPath(filePath: string): string {
  return getPathApi(filePath).dirname(filePath);
}

function getRootPath(filePath: string): string {
  return getPathApi(filePath).parse(filePath).root;
}

function isSamePath(leftPath: string, rightPath: string): boolean {
  return getPathApi(rightPath).relative(rightPath, leftPath) === "";
}

function buildEntryLabel(entry: LsEntry): string {
  return `${entry.type === "directory" ? "📁" : "📄"} ${entry.name}`;
}

function isPathWithinDirectory(targetPath: string, directoryPath: string): boolean {
  const pathApi = getPathApi(directoryPath);
  const relativePath = pathApi.relative(directoryPath, targetPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !pathApi.isAbsolute(relativePath));
}

function getProjectRoot(): string | null {
  return getCurrentProject()?.worktree ?? null;
}

function isWithinProjectRoot(targetPath: string): boolean {
  const projectRoot = getProjectRoot();
  return projectRoot !== null && isPathWithinDirectory(targetPath, projectRoot);
}

function isProjectRoot(targetPath: string): boolean {
  const projectRoot = getProjectRoot();
  return projectRoot !== null && isSamePath(targetPath, projectRoot);
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

function encodePathForCallback(prefix: string, fullPath: string, reserveBytes: number = 0): string {
  const naive = `${prefix}${fullPath}`;
  if (Buffer.byteLength(naive, "utf-8") + reserveBytes <= 64) {
    return naive;
  }

  const key = `#${pathCounter++}`;
  pathIndex.set(key, fullPath);
  return `${prefix}${key}`;
}

function decodePathFromCallback(prefix: string, data: string): string | null {
  if (!data.startsWith(prefix)) {
    return null;
  }

  const raw = data.slice(prefix.length);
  if (raw.startsWith("#")) {
    return pathIndex.get(raw) ?? null;
  }

  return raw;
}

function encodePathWithPageCallback(prefix: string, fullPath: string, page: number): string {
  const pageSuffix = `${PAGE_SEPARATOR}${page}`;
  const reserveBytes = Buffer.byteLength(pageSuffix, "utf-8");
  const pathRef = encodePathForCallback(prefix, fullPath, reserveBytes);
  return `${pathRef}${pageSuffix}`;
}

function decodePathWithPageCallback(data: string, prefix: string): { path: string; page: number } | null {
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

function encodePaginationCallback(currentPath: string, page: number): string {
  return encodePathWithPageCallback(CALLBACK_PAGE_PREFIX, currentPath, page);
}

function decodePaginationCallback(data: string): { path: string; page: number } | null {
  return decodePathWithPageCallback(data, CALLBACK_PAGE_PREFIX);
}

function encodeFileCallback(fullPath: string, page: number): string {
  return encodePathWithPageCallback(CALLBACK_FILE_PREFIX, fullPath, page);
}

function decodeFileCallback(data: string): { path: string; page: number } | null {
  return decodePathWithPageCallback(data, CALLBACK_FILE_PREFIX);
}

function encodeBackCallback(directoryPath: string, page: number): string {
  return encodePathWithPageCallback(CALLBACK_BACK_PREFIX, directoryPath, page);
}

function decodeBackCallback(data: string): { path: string; page: number } | null {
  return decodePathWithPageCallback(data, CALLBACK_BACK_PREFIX);
}

async function scanDirectory(
  dirPath: string,
  page: number = 0,
): Promise<
  | {
      entries: LsEntry[];
      totalCount: number;
      currentPath: string;
      displayPath: string;
      hasParent: boolean;
      page: number;
    }
  | { error: string }
> {
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

function buildBrowseKeyboard(
  entries: LsEntry[],
  currentPath: string,
  hasParent: boolean,
  page: number,
  totalCount: number,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const totalPages = Math.max(1, Math.ceil(totalCount / MAX_ENTRIES_PER_PAGE));

  for (const entry of entries) {
    const label = truncateLabel(buildEntryLabel(entry));
    const callbackData =
      entry.type === "directory"
        ? encodePathForCallback(CALLBACK_NAV_PREFIX, entry.fullPath)
        : encodeFileCallback(entry.fullPath, page);
    keyboard.text(label, callbackData).row();
  }

  if (hasParent && !isProjectRoot(currentPath)) {
    keyboard.text(t("open.back"), encodePathForCallback(CALLBACK_NAV_PREFIX, getParentPath(currentPath))).row();
  }

  if (totalPages > 1) {
    if (page > 0) {
      keyboard.text(t("open.prev_page"), encodePaginationCallback(currentPath, page - 1));
    }
    if (page < totalPages - 1) {
      keyboard.text(t("open.next_page"), encodePaginationCallback(currentPath, page + 1));
    }
    keyboard.row();
  }

  appendInlineMenuCancelButton(keyboard, "ls");
  return keyboard;
}

function buildFileDetailsKeyboard(filePath: string, page: number): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const parentPath = getParentPath(filePath);

  keyboard.text(t("ls.file.download"), encodePathForCallback(CALLBACK_DOWNLOAD_PREFIX, filePath));
  keyboard.text(t("ls.file.back"), encodeBackCallback(parentPath, page));
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

async function renderBrowseView(dirPath: string, page: number = 0) {
  const result = await scanDirectory(dirPath, page);
  if ("error" in result) {
    return result;
  }

  const totalPages = Math.max(1, Math.ceil(result.totalCount / MAX_ENTRIES_PER_PAGE));
  return {
    text: buildLsHeader(result.displayPath, result.totalCount, result.page, totalPages),
    hasActions: hasBrowseActions(result.currentPath, result.hasParent, result.totalCount),
    keyboard: buildBrowseKeyboard(
      result.entries,
      result.currentPath,
      result.hasParent,
      result.page,
      result.totalCount,
    ),
  };
}

async function getFileDetails(filePath: string): Promise<FileDetails | { error: string }> {
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

async function renderFileDetailsView(filePath: string, page: number) {
  const fileDetails = await getFileDetails(filePath);
  if ("error" in fileDetails) {
    return fileDetails;
  }

  return {
    text: buildFileDetailsText(fileDetails),
    keyboard: buildFileDetailsKeyboard(fileDetails.fullPath, page),
  };
}

function resolveInitialDirectory(userId?: number): string | null {
  const currentProject = getProjectRoot();
  if (!currentProject) {
    return null;
  }

  if (userId) {
    const cachedDirectory = sessionDirectories.get(userId);
    if (cachedDirectory && isPathWithinDirectory(cachedDirectory, currentProject)) {
      return cachedDirectory;
    }
  }

  return currentProject;
}

export function clearLsPathIndex(): void {
  pathIndex.clear();
  pathCounter = 0;
}

export function clearSessionDirectories(): void {
  sessionDirectories.clear();
}

export async function lsCommand(ctx: CommandContext<Context>): Promise<void> {
  if (isForegroundBusy()) {
    await replyBusyBlocked(ctx);
    return;
  }

  clearLsPathIndex();

  const projectRoot = getProjectRoot();
  if (!projectRoot) {
    await ctx.reply(t("bot.project_not_selected"));
    return;
  }

  const args = typeof ctx.match === "string" ? ctx.match.trim() : undefined;
  const targetDir = args || resolveInitialDirectory(ctx.from?.id);
  if (!targetDir) {
    await ctx.reply(t("bot.project_not_selected"));
    return;
  }

  if (!isWithinProjectRoot(targetDir)) {
    await ctx.reply(`❌ ${t("ls.access_denied")}`);
    return;
  }

  const view = await renderBrowseView(targetDir);
  if ("error" in view) {
    await ctx.reply(`❌ ${view.error}`);
    return;
  }

  if (ctx.from) {
    sessionDirectories.set(ctx.from.id, targetDir);
  }

  if (!view.hasActions) {
    await ctx.reply(view.text, { parse_mode: "HTML" });
    return;
  }

  const message = await ctx.reply(view.text, { parse_mode: "HTML", reply_markup: view.keyboard });
  interactionManager.start({
    kind: "inline",
    expectedInput: "callback",
    metadata: {
      menuKind: "ls",
      messageId: message.message_id,
    },
  });
}

async function navigateTo(ctx: Context, dirPath: string, page: number = 0): Promise<void> {
  const view = await renderBrowseView(dirPath, page);
  if ("error" in view) {
    await ctx.answerCallbackQuery({ text: view.error });
    return;
  }

  if (ctx.from) {
    sessionDirectories.set(ctx.from.id, dirPath);
  }

  await ctx.answerCallbackQuery();
  await ctx.editMessageText(view.text, { parse_mode: "HTML", reply_markup: view.keyboard });
}

async function showFileDetails(ctx: Context, filePath: string, page: number): Promise<void> {
  const view = await renderFileDetailsView(filePath, page);
  if ("error" in view) {
    await ctx.answerCallbackQuery({ text: view.error });
    return;
  }

  await ctx.answerCallbackQuery();
  await ctx.editMessageText(view.text, { parse_mode: "HTML", reply_markup: view.keyboard });
}

async function downloadFileAndClose(ctx: Context, filePath: string): Promise<void> {
  await ctx.answerCallbackQuery({ text: t("commands.download.downloading") });
  const downloaded = await sendDownloadedFile(ctx, filePath, { announce: false });
  if (!downloaded) {
    return;
  }

  clearActiveInlineMenu("ls_downloaded");
  clearLsPathIndex();
  await ctx.deleteMessage().catch(() => {});
}

export async function handleLsCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith(CALLBACK_PREFIX)) {
    return false;
  }

  if (isForegroundBusy()) {
    await replyBusyBlocked(ctx);
    return true;
  }

  const isActiveMenu = await ensureActiveInlineMenu(ctx, "ls");
  if (!isActiveMenu) {
    return true;
  }

  try {
    const navPath = decodePathFromCallback(CALLBACK_NAV_PREFIX, data);
    if (navPath !== null) {
      if (!isWithinProjectRoot(navPath)) {
        await ctx.answerCallbackQuery({ text: t("ls.access_denied") });
        return true;
      }
      await navigateTo(ctx, navPath);
      return true;
    }

    const pageInfo = decodePaginationCallback(data);
    if (pageInfo !== null) {
      if (!isWithinProjectRoot(pageInfo.path)) {
        await ctx.answerCallbackQuery({ text: t("ls.access_denied") });
        return true;
      }
      await navigateTo(ctx, pageInfo.path, pageInfo.page);
      return true;
    }

    const fileInfo = decodeFileCallback(data);
    if (fileInfo !== null) {
      if (!isWithinProjectRoot(fileInfo.path)) {
        await ctx.answerCallbackQuery({ text: t("ls.access_denied") });
        return true;
      }
      await showFileDetails(ctx, fileInfo.path, fileInfo.page);
      return true;
    }

    const downloadPath = decodePathFromCallback(CALLBACK_DOWNLOAD_PREFIX, data);
    if (downloadPath !== null) {
      if (!isWithinProjectRoot(downloadPath)) {
        await ctx.answerCallbackQuery({ text: t("ls.access_denied") });
        return true;
      }
      await downloadFileAndClose(ctx, downloadPath);
      return true;
    }

    const backInfo = decodeBackCallback(data);
    if (backInfo !== null) {
      if (!isWithinProjectRoot(backInfo.path)) {
        await ctx.answerCallbackQuery({ text: t("ls.access_denied") });
        return true;
      }
      await navigateTo(ctx, backInfo.path, backInfo.page);
      return true;
    }

    return false;
  } catch (error) {
    logger.error("[Ls] Error handling callback:", error);
    await ctx.answerCallbackQuery({ text: t("callback.processing_error") });
    return true;
  }
}
