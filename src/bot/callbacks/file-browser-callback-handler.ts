import { InlineKeyboard, type Context } from "grammy";
import type { AppContainer } from "../../app/bootstrap/app-container.js";
import {
  getProjectRoot,
  isPathWithinDirectory,
  isWithinAllowedRoot,
  isWithinProjectRoot,
  pathToDisplayPath,
} from "../../app/services/file-browser-service.js";
import { isForegroundBusy } from "../../app/services/run-control-service.js";
import { t } from "../../i18n/index.js";
import { alert, failure } from "./feedback.js";
import { getProjectByWorktree } from "../../app/services/project-service.js";
import { upsertSessionDirectory } from "../../app/services/session-cache-service.js";
import { logger } from "../../utils/logger.js";
import { replyBusyBlocked } from "../messages/busy-blocked-renderer.js";
import { ensureActiveInlineMenu, clearActiveInlineMenu } from "../menus/inline-menu.js";
import { sendDownloadedFile } from "../messages/send-downloaded-file.js";
import { switchToProject } from "../../app/services/project-switch-service.js";
import { createProjectSwitchPresentation } from "../services/project-switch-presentation.js";
import { promptAttachment } from "../../app/managers/prompt-attachment-manager.js";
import { toRelativePath } from "../../app/services/prompt-attachment-service.js";
import { ATTACHMENT_CANCEL_CALLBACK } from "./prompt-attachment-callback-handler.js";
import {
  buildOpenRootsKeyboard,
  clearLsPathIndex,
  clearOpenPathIndex,
  decodeLsAttachCallback,
  decodeLsBackCallback,
  decodeLsFileCallback,
  decodeLsPaginationCallback,
  decodeLsPathFromCallback,
  decodeOpenPaginationCallback,
  decodeOpenPathFromCallback,
  LS_CALLBACK_DOWNLOAD_PREFIX,
  LS_CALLBACK_NAV_PREFIX,
  LS_CALLBACK_PREFIX,
  OPEN_CALLBACK_NAV_PREFIX,
  OPEN_CALLBACK_PREFIX,
  OPEN_CALLBACK_ROOTS,
  OPEN_CALLBACK_SELECT_PREFIX,
  renderLsBrowseView,
  renderLsFileDetailsView,
  renderOpenBrowseView,
} from "../menus/file-browser-menu.js";

export type LsCallbackDeps = Pick<AppContainer, "interactionManager">;

export interface OpenCallbackDeps {
  ensureEventSubscription?: (directory: string) => Promise<void>;
}

const sessionDirectories = new Map<number, string>();

export function clearSessionDirectories(): void {
  sessionDirectories.clear();
}

export function resolveInitialLsDirectory(userId?: number): string | null {
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

export function rememberLsDirectory(userId: number | undefined, directory: string): void {
  if (userId) {
    sessionDirectories.set(userId, directory);
  }
}

export async function handleOpenCallback(
  ctx: Context,
  deps: OpenCallbackDeps = {},
): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith(OPEN_CALLBACK_PREFIX)) {
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
    if (data === OPEN_CALLBACK_ROOTS) {
      await showOpenRoots(ctx);
      return true;
    }

    const navPath = decodeOpenPathFromCallback(OPEN_CALLBACK_NAV_PREFIX, data);
    if (navPath !== null) {
      if (!isWithinAllowedRoot(navPath)) {
        await alert(ctx, "open.access_denied");
        return true;
      }
      await navigateOpenTo(ctx, navPath);
      return true;
    }

    const pageInfo = decodeOpenPaginationCallback(data);
    if (pageInfo !== null) {
      if (!isWithinAllowedRoot(pageInfo.path)) {
        await alert(ctx, "open.access_denied");
        return true;
      }
      await navigateOpenTo(ctx, pageInfo.path, pageInfo.page);
      return true;
    }

    const selectPath = decodeOpenPathFromCallback(OPEN_CALLBACK_SELECT_PREFIX, data);
    if (selectPath !== null) {
      if (!isWithinAllowedRoot(selectPath)) {
        await alert(ctx, "open.access_denied");
        return true;
      }
      await selectDirectory(ctx, selectPath, deps);
      return true;
    }

    return false;
  } catch (error) {
    logger.error("[Bot] Error handling open callback:", error);
    await ctx.answerCallbackQuery({ text: t("callback.processing_error") });
    return true;
  }
}

async function showOpenRoots(ctx: Context): Promise<void> {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(t("open.select_root"), { reply_markup: buildOpenRootsKeyboard() });
}

async function navigateOpenTo(ctx: Context, dirPath: string, page: number = 0): Promise<void> {
  const view = await renderOpenBrowseView(dirPath, page);

  if ("error" in view) {
    await ctx.answerCallbackQuery({ text: view.error });
    return;
  }

  await ctx.answerCallbackQuery();
  await ctx.editMessageText(view.text, { reply_markup: view.keyboard });
}

async function selectDirectory(
  ctx: Context,
  directory: string,
  deps: OpenCallbackDeps = {},
): Promise<void> {
  const displayPath = pathToDisplayPath(directory);

  try {
    logger.info(`[Bot] Adding project directory: ${directory}`);
    await upsertSessionDirectory(directory, Date.now());

    const projectInfo = await getProjectByWorktree(directory);
    const selectedProjectInfo = { ...projectInfo, name: displayPath };
    const replyKeyboard = await switchToProject(ctx, selectedProjectInfo, "open_project_selected", {
      ensureEventSubscription: deps.ensureEventSubscription,
      presentation: createProjectSwitchPresentation(),
    });

    await ctx.answerCallbackQuery();
    await ctx.reply(t("open.selected", { project: displayPath }), { reply_markup: replyKeyboard });
    await ctx.deleteMessage();
    clearOpenPathIndex();

    logger.info(`[Bot] Project added and selected: ${displayPath}`);
  } catch (error) {
    logger.error("[Bot] Error selecting directory:", error);
    await failure(ctx, "open.select_error");
  }
}

export async function handleLsCallback(ctx: Context, deps: LsCallbackDeps): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith(LS_CALLBACK_PREFIX)) {
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
    const navPath = decodeLsPathFromCallback(LS_CALLBACK_NAV_PREFIX, data);
    if (navPath !== null) {
      if (!isWithinProjectRoot(navPath)) {
        await alert(ctx, "ls.access_denied");
        return true;
      }
      await navigateLsTo(ctx, navPath);
      return true;
    }

    const pageInfo = decodeLsPaginationCallback(data);
    if (pageInfo !== null) {
      if (!isWithinProjectRoot(pageInfo.path)) {
        await alert(ctx, "ls.access_denied");
        return true;
      }
      await navigateLsTo(ctx, pageInfo.path, pageInfo.page);
      return true;
    }

    const fileInfo = decodeLsFileCallback(data);
    if (fileInfo !== null) {
      if (!isWithinProjectRoot(fileInfo.path)) {
        await alert(ctx, "ls.access_denied");
        return true;
      }
      await showLsFileDetails(ctx, fileInfo.path, fileInfo.page);
      return true;
    }

    const attachPath = decodeLsAttachCallback(data);
    if (attachPath !== null) {
      if (!isWithinProjectRoot(attachPath)) {
        await alert(ctx, "ls.access_denied");
        return true;
      }
      await attachFileAndClose(ctx, deps, attachPath);
      return true;
    }

    const downloadPath = decodeLsPathFromCallback(LS_CALLBACK_DOWNLOAD_PREFIX, data);
    if (downloadPath !== null) {
      if (!isWithinProjectRoot(downloadPath)) {
        await alert(ctx, "ls.access_denied");
        return true;
      }
      await downloadFileAndClose(ctx, downloadPath);
      return true;
    }

    const backInfo = decodeLsBackCallback(data);
    if (backInfo !== null) {
      if (!isWithinProjectRoot(backInfo.path)) {
        await alert(ctx, "ls.access_denied");
        return true;
      }
      await navigateLsTo(ctx, backInfo.path, backInfo.page);
      return true;
    }

    return false;
  } catch (error) {
    logger.error("[Ls] Error handling callback:", error);
    await ctx.answerCallbackQuery({ text: t("callback.processing_error") });
    return true;
  }
}

async function navigateLsTo(ctx: Context, dirPath: string, page: number = 0): Promise<void> {
  const view = await renderLsBrowseView(dirPath, page);
  if ("error" in view) {
    await ctx.answerCallbackQuery({ text: view.error });
    return;
  }

  rememberLsDirectory(ctx.from?.id, dirPath);
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(view.text, { parse_mode: "HTML", reply_markup: view.keyboard });
}

async function showLsFileDetails(ctx: Context, filePath: string, page: number): Promise<void> {
  const view = await renderLsFileDetailsView(filePath, page);
  if ("error" in view) {
    await ctx.answerCallbackQuery({ text: view.error });
    return;
  }

  await ctx.answerCallbackQuery();
  await ctx.editMessageText(view.text, { parse_mode: "HTML", reply_markup: view.keyboard });
}

async function attachFileAndClose(
  ctx: Context,
  deps: LsCallbackDeps,
  filePath: string,
): Promise<void> {
  const projectRoot = getProjectRoot();
  if (!projectRoot) {
    await ctx.answerCallbackQuery({ text: t("bot.project_not_selected") });
    return;
  }

  promptAttachment.set(filePath, projectRoot);

  await ctx.answerCallbackQuery();
  clearActiveInlineMenu("ls_attached");
  clearLsPathIndex();
  await ctx.deleteMessage().catch(() => {});

  const relativePath = toRelativePath(filePath, projectRoot);
  const confirmation = await ctx.reply(t("attachment.added", { path: relativePath }), {
    reply_markup: new InlineKeyboard().text(t("attachment.cancel"), ATTACHMENT_CANCEL_CALLBACK),
  });
  promptAttachment.setConfirmationMessageId(confirmation.message_id);

  // Wait for the prompt the file belongs to: "mixed" lets the text and the cancel button
  // through while blocking commands, menus, and non-text messages.
  deps.interactionManager.start({
    kind: "custom",
    expectedInput: "mixed",
    metadata: { flow: "attachment" },
  });

  logger.info(`[PromptAttachment] Attached from /ls: ${filePath}`);
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
