import { CommandContext, Context, InlineKeyboard } from "grammy";
import path from "node:path";
import { appendInlineMenuCancelButton, ensureActiveInlineMenu } from "../handlers/inline-menu.js";
import { interactionManager } from "../../interaction/manager.js";
import { isForegroundBusy, replyBusyBlocked } from "../utils/busy-guard.js";
import {
  getHomeDirectory,
  pathToDisplayPath,
  scanDirectory,
  buildEntryLabel,
  buildTreeHeader,
  isScanError,
  MAX_ENTRIES_PER_PAGE,
  type DirectoryEntry,
} from "../utils/file-tree.js";
import { upsertSessionDirectory } from "../../session/cache-manager.js";
import { getProjectByWorktree } from "../../project/manager.js";
import { switchToProject } from "../utils/switch-project.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";

const CALLBACK_PREFIX = "open:";
const CALLBACK_NAV_PREFIX = "open:nav:";
const CALLBACK_SELECT_PREFIX = "open:sel:";
const CALLBACK_PAGE_PREFIX = "open:pg:";
const CALLBACK_HOME = "open:home";
const MAX_BUTTON_LABEL_LENGTH = 64;

/**
 * Separator used inside pagination callback data between the encoded path
 * reference and the page number. We avoid `:` because it appears in Windows
 * drive letters (e.g. `C:\`) and is already used as a prefix delimiter.
 */
const PAGE_SEPARATOR = "|";

function truncateLabel(label: string, maxLen: number = MAX_BUTTON_LABEL_LENGTH): string {
  if (label.length <= maxLen) {
    return label;
  }
  return label.slice(0, Math.max(0, maxLen - 3)) + "...";
}

/**
 * Encode a path into callback data. Telegram limits callback_data to 64 bytes.
 * Long absolute paths can exceed this, so we encode them as a compact index
 * when necessary. The index is stored in a module-level map that lives for the
 * duration of the current inline menu interaction.
 */
const pathIndex = new Map<string, string>();
let pathCounter = 0;

/** Clear the path index. Exported so it can be called on menu cancel/cleanup. */
export function clearOpenPathIndex(): void {
  pathIndex.clear();
  pathCounter = 0;
}

/**
 * @param prefix   Callback-data prefix that precedes the path.
 * @param fullPath Absolute path to encode.
 * @param reserveBytes Extra bytes to reserve for a suffix that will be
 *   appended *after* the returned value (e.g. the page separator + digits in
 *   pagination callbacks). The total callback_data must stay ≤ 64 bytes.
 */
function encodePathForCallback(prefix: string, fullPath: string, reserveBytes: number = 0): string {
  const naive = `${prefix}${fullPath}`;
  if (Buffer.byteLength(naive, "utf-8") + reserveBytes <= 64) {
    return naive;
  }

  // Use a short numeric key instead
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

/**
 * Encode a pagination callback. The path part goes through the same 64-byte
 * safe encoding used by nav/select callbacks, followed by a separator and
 * the page number.
 *
 * We reserve bytes for the page suffix so the 64-byte check inside
 * `encodePathForCallback` accounts for the complete final callback length.
 */
function encodePaginationCallback(currentPath: string, page: number): string {
  const pageSuffix = `${PAGE_SEPARATOR}${page}`;
  const reserveBytes = Buffer.byteLength(pageSuffix, "utf-8");
  const pathRef = encodePathForCallback(CALLBACK_PAGE_PREFIX, currentPath, reserveBytes);
  return `${pathRef}${pageSuffix}`;
}

/**
 * Decode a pagination callback into { path, page } or null on failure.
 */
function decodePaginationCallback(data: string): { path: string; page: number } | null {
  if (!data.startsWith(CALLBACK_PAGE_PREFIX)) {
    return null;
  }

  const payload = data.slice(CALLBACK_PAGE_PREFIX.length);
  const sepIndex = payload.lastIndexOf(PAGE_SEPARATOR);
  if (sepIndex < 0) {
    return null;
  }

  const pathRef = payload.slice(0, sepIndex);
  const pageNum = Number.parseInt(payload.slice(sepIndex + 1), 10);
  if (Number.isNaN(pageNum)) {
    return null;
  }

  // Resolve indexed path references
  const resolvedPath = pathRef.startsWith("#") ? (pathIndex.get(pathRef) ?? null) : pathRef;
  if (resolvedPath === null) {
    return null;
  }

  return { path: resolvedPath, page: pageNum };
}

function buildBrowseKeyboard(
  entries: DirectoryEntry[],
  currentPath: string,
  hasParent: boolean,
  page: number,
  totalCount: number,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const totalPages = Math.max(1, Math.ceil(totalCount / MAX_ENTRIES_PER_PAGE));

  // Directory entries
  for (const entry of entries) {
    const label = truncateLabel(buildEntryLabel(entry));
    keyboard.text(label, encodePathForCallback(CALLBACK_NAV_PREFIX, entry.fullPath)).row();
  }

  // Navigation: Up + Home
  const showUp = hasParent;
  const showHome = currentPath !== getHomeDirectory();

  if (showUp || showHome) {
    if (showUp) {
      const parentPath = path.dirname(currentPath);
      keyboard.text(t("open.back"), encodePathForCallback(CALLBACK_NAV_PREFIX, parentPath));
    }
    if (showHome) {
      keyboard.text(t("open.home"), CALLBACK_HOME);
    }
    keyboard.row();
  }

  // Pagination
  if (totalPages > 1) {
    if (page > 0) {
      keyboard.text(t("open.prev_page"), encodePaginationCallback(currentPath, page - 1));
    }
    if (page < totalPages - 1) {
      keyboard.text(t("open.next_page"), encodePaginationCallback(currentPath, page + 1));
    }
    keyboard.row();
  }

  // Select current folder
  keyboard
    .text(t("open.select_current"), encodePathForCallback(CALLBACK_SELECT_PREFIX, currentPath))
    .row();

  // Cancel
  appendInlineMenuCancelButton(keyboard, "open");

  return keyboard;
}

async function renderBrowseView(dirPath: string, page: number = 0) {
  const result = await scanDirectory(dirPath, page);

  if (isScanError(result)) {
    return { error: result.error };
  }

  const { entries, totalCount, page: clampedPage, currentPath, displayPath, hasParent } = result;
  const totalPages = Math.max(1, Math.ceil(totalCount / MAX_ENTRIES_PER_PAGE));
  const header = buildTreeHeader(displayPath, totalCount, clampedPage, totalPages);
  const keyboard = buildBrowseKeyboard(entries, currentPath, hasParent, clampedPage, totalCount);

  return { text: header, keyboard };
}

export async function openCommand(ctx: CommandContext<Context>) {
  try {
    if (isForegroundBusy()) {
      await replyBusyBlocked(ctx);
      return;
    }

    // Reset path index for new interaction
    clearOpenPathIndex();

    const view = await renderBrowseView(getHomeDirectory());

    if ("error" in view) {
      await ctx.reply(t("open.scan_error", { error: view.error }));
      return;
    }

    const message = await ctx.reply(view.text, {
      reply_markup: view.keyboard,
    });

    interactionManager.start({
      kind: "inline",
      expectedInput: "callback",
      metadata: {
        menuKind: "open",
        messageId: message.message_id,
      },
    });
  } catch (error) {
    logger.error("[Bot] Error opening directory browser:", error);
    await ctx.reply(t("open.open_error"));
  }
}

export async function handleOpenCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith(CALLBACK_PREFIX)) {
    return false;
  }

  if (isForegroundBusy()) {
    await replyBusyBlocked(ctx);
    return true;
  }

  const isActiveMenu = await ensureActiveInlineMenu(ctx, "open");
  if (!isActiveMenu) {
    return true;
  }

  try {
    // Navigate to home
    if (data === CALLBACK_HOME) {
      await navigateTo(ctx, getHomeDirectory());
      return true;
    }

    // Navigate into a directory (including "up")
    const navPath = decodePathFromCallback(CALLBACK_NAV_PREFIX, data);
    if (navPath !== null) {
      await navigateTo(ctx, navPath);
      return true;
    }

    // Pagination
    const pageInfo = decodePaginationCallback(data);
    if (pageInfo !== null) {
      await navigateTo(ctx, pageInfo.path, pageInfo.page);
      return true;
    }

    // Select directory as project
    const selectPath = decodePathFromCallback(CALLBACK_SELECT_PREFIX, data);
    if (selectPath !== null) {
      await selectDirectory(ctx, selectPath);
      return true;
    }

    return false;
  } catch (error) {
    logger.error("[Bot] Error handling open callback:", error);
    await ctx.answerCallbackQuery({ text: t("callback.processing_error") });
    return true;
  }
}

async function navigateTo(ctx: Context, dirPath: string, page: number = 0) {
  const view = await renderBrowseView(dirPath, page);

  if ("error" in view) {
    await ctx.answerCallbackQuery({ text: view.error });
    return;
  }

  await ctx.answerCallbackQuery();
  await ctx.editMessageText(view.text, {
    reply_markup: view.keyboard,
  });
}

async function selectDirectory(ctx: Context, directory: string) {
  const displayPath = pathToDisplayPath(directory);

  try {
    logger.info(`[Bot] Adding project directory: ${directory}`);

    const projectInfo = await getProjectByWorktree(directory);
    const replyKeyboard = await switchToProject(
      ctx,
      { ...projectInfo, name: displayPath },
      "open_project_selected",
    );

    // Register directory in the session cache only after the project switch
    // succeeded — avoids leaving a stale entry if an earlier step fails.
    await upsertSessionDirectory(directory, Date.now());

    await ctx.answerCallbackQuery();
    await ctx.reply(t("open.selected", { project: displayPath }), {
      reply_markup: replyKeyboard,
    });

    // Clean up the inline menu message
    await ctx.deleteMessage();

    // Clear path index after selection
    clearOpenPathIndex();

    logger.info(`[Bot] Project added and selected: ${displayPath}`);
  } catch (error) {
    logger.error("[Bot] Error selecting directory:", error);
    await ctx.answerCallbackQuery({ text: t("callback.processing_error") });
    await ctx.reply(t("open.select_error"));
  }
}
