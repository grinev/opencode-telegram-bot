import { CommandContext, Context, InlineKeyboard } from "grammy";
import path from "node:path";
import { promises as fs } from "node:fs";
import os from "node:os";
import { appendInlineMenuCancelButton, ensureActiveInlineMenu } from "../handlers/inline-menu.js";
import { interactionManager } from "../../interaction/manager.js";
import { isForegroundBusy, replyBusyBlocked } from "../utils/busy-guard.js";
import { getBrowserRoots, isAllowedRoot, isWithinAllowedRoot } from "../utils/browser-roots.js";
import { getCurrentProject } from "../../settings/manager.js";
import { sendDownloadedFile } from "../utils/send-downloaded-file.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";

const CALLBACK_PREFIX = "ls:";
const CALLBACK_NAV_PREFIX = "ls:nav:";
const CALLBACK_FILE_PREFIX = "ls:file:";
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

function buildEntryLabel(entry: LsEntry): string {
  return `${entry.type === "directory" ? "📁" : "📄"} ${entry.name}`;
}

function isPathWithinDirectory(targetPath: string, directoryPath: string): boolean {
  const relativePath = path.relative(directoryPath, targetPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function buildLsHeader(displayPath: string, totalCount: number, page: number, totalPages: number): string {
  let header = `📁 ${t("ls.header")}\n<code>${escapeHtml(displayPath)}</code>`;
  if (totalPages > 1) {
    header += `\n(${page + 1}/${totalPages})`;
  }
  header += `\n${t("ls.total", { count: totalCount })}`;
  return header;
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

function encodePaginationCallback(currentPath: string, page: number): string {
  const pageSuffix = `${PAGE_SEPARATOR}${page}`;
  const reserveBytes = Buffer.byteLength(pageSuffix, "utf-8");
  const pathRef = encodePathForCallback(CALLBACK_PAGE_PREFIX, currentPath, reserveBytes);
  return `${pathRef}${pageSuffix}`;
}

function decodePaginationCallback(data: string): { path: string; page: number } | null {
  if (!data.startsWith(CALLBACK_PAGE_PREFIX)) {
    return null;
  }

  const payload = data.slice(CALLBACK_PAGE_PREFIX.length);
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
    if (!isWithinAllowedRoot(dirPath)) {
      return { error: t("ls.access_denied") };
    }

    const dirEntries = await fs.readdir(dirPath, { withFileTypes: true });
    const entries: LsEntry[] = dirEntries
      .map((entry): LsEntry => ({
        name: entry.name,
        fullPath: path.join(dirPath, entry.name),
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
      hasParent: dirPath !== path.parse(dirPath).root,
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
  const projectRoot = getCurrentProject()?.worktree;
  const atProjectRoot = !!projectRoot && currentPath === projectRoot;

  for (const entry of entries) {
    const label = truncateLabel(buildEntryLabel(entry));
    const callbackData =
      entry.type === "directory"
        ? encodePathForCallback(CALLBACK_NAV_PREFIX, entry.fullPath)
        : encodePathForCallback(CALLBACK_FILE_PREFIX, entry.fullPath);
    keyboard.text(label, callbackData).row();
  }

  if (hasParent && !isAllowedRoot(currentPath) && !atProjectRoot) {
    keyboard.text(t("open.back"), encodePathForCallback(CALLBACK_NAV_PREFIX, path.dirname(currentPath))).row();
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

async function renderBrowseView(dirPath: string, page: number = 0) {
  const result = await scanDirectory(dirPath, page);
  if ("error" in result) {
    return result;
  }

  const totalPages = Math.max(1, Math.ceil(result.totalCount / MAX_ENTRIES_PER_PAGE));
  return {
    text: buildLsHeader(result.displayPath, result.totalCount, result.page, totalPages),
    keyboard: buildBrowseKeyboard(
      result.entries,
      result.currentPath,
      result.hasParent,
      result.page,
      result.totalCount,
    ),
  };
}

function resolveInitialDirectory(userId?: number): string | null {
  const currentProject = getCurrentProject()?.worktree;

  if (userId) {
    const cachedDirectory = sessionDirectories.get(userId);
    if (cachedDirectory) {
      if (!currentProject || isPathWithinDirectory(cachedDirectory, currentProject)) {
        return cachedDirectory;
      }
    }
  }

  if (currentProject) {
    return currentProject;
  }

  const browserRoots = getBrowserRoots();
  return browserRoots[0] ?? null;
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

  const args = typeof ctx.match === "string" ? ctx.match.trim() : undefined;
  const targetDir = args || resolveInitialDirectory(ctx.from?.id);
  if (!targetDir) {
    await ctx.reply(`❌ ${t("commands.download.no_roots")}`);
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
      if (!isWithinAllowedRoot(navPath)) {
        await ctx.answerCallbackQuery({ text: t("ls.access_denied") });
        return true;
      }
      await navigateTo(ctx, navPath);
      return true;
    }

    const pageInfo = decodePaginationCallback(data);
    if (pageInfo !== null) {
      if (!isWithinAllowedRoot(pageInfo.path)) {
        await ctx.answerCallbackQuery({ text: t("ls.access_denied") });
        return true;
      }
      await navigateTo(ctx, pageInfo.path, pageInfo.page);
      return true;
    }

    const filePath = decodePathFromCallback(CALLBACK_FILE_PREFIX, data);
    if (filePath !== null) {
      if (!isWithinAllowedRoot(filePath)) {
        await ctx.answerCallbackQuery({ text: t("ls.access_denied") });
        return true;
      }

      await ctx.answerCallbackQuery({ text: t("commands.download.downloading") });
      await sendDownloadedFile(ctx, filePath, { announce: false });
      return true;
    }

    return false;
  } catch (error) {
    logger.error("[Ls] Error handling callback:", error);
    await ctx.answerCallbackQuery({ text: t("callback.processing_error") });
    return true;
  }
}
