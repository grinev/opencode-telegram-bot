import type { Context } from "grammy";
import { exec } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { downloadTelegramFile } from "../../app/services/file-download-service.js";
import {
  getMaxFileSizeMb,
  getTempPath,
  loadFileRules,
  type FileAction,
} from "../../app/services/file-rules-service.js";
import {
  normalizeActionId,
  parseCallbackData,
  recallFileAction,
} from "../../app/services/file-action-tokens.js";

const TELEGRAM_TEXT_LIMIT = 4000;
const TRUNCATION_SUFFIX = "\n… [truncated]";

function findActionById(actionId: string): FileAction | null {
  const config = loadFileRules();
  for (const rule of config.rules) {
    for (const action of rule.actions) {
      if (normalizeActionId(action.id) === actionId) {
        return action;
      }
    }
  }
  for (const action of config.default.actions) {
    if (normalizeActionId(action.id) === actionId) {
      return action;
    }
  }
  return null;
}

/** Never let a Telegram-provided name escape the target directory. */
function safeBaseName(filename: string): string {
  const base = path
    .basename(filename)
    .replace(/[\u0000-\u001f]/g, "")
    .trim();
  if (!base || base === "." || base === "..") return "file";
  return base;
}

/** Temp copies end up inside a shell command, so keep their name boring. */
function safeTempName(filename: string): string {
  return safeBaseName(filename).replace(/[^A-Za-z0-9._ ()-]/g, "_");
}

function assertSize(bytes: number, filename: string): void {
  const maxMb = getMaxFileSizeMb();
  if (bytes > maxMb * 1024 * 1024) {
    const sizeMb = (bytes / (1024 * 1024)).toFixed(2);
    throw new Error(`file too large: ${sizeMb}MB > ${maxMb}MB (${filename})`);
  }
}

function openFile(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd =
      process.platform === "win32"
        ? `start "" "${filePath}"`
        : process.platform === "darwin"
          ? `open "${filePath}"`
          : `xdg-open "${filePath}"`;

    exec(cmd, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

function executeCommand(command: string, filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // {file} is replaced with a quoted path so names with spaces keep working.
    const cmd = command.replace(/\{file\}/g, `"${filePath}"`);
    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
      } else {
        resolve(stdout);
      }
    });
  });
}

async function saveFile(ctx: Context, action: FileAction, fileId: string, filename: string): Promise<void> {
  if (!action.path) {
    throw new Error("No path configured for save action");
  }

  await ctx.reply(t("bot.file_downloading"));

  const downloadedFile = await downloadTelegramFile(ctx.api, fileId);
  assertSize(downloadedFile.buffer.length, filename);

  const destDir = action.path.replace(/^~/, os.homedir());
  await fs.mkdir(destDir, { recursive: true });

  const destPath = path.join(destDir, safeBaseName(filename));
  await fs.writeFile(destPath, downloadedFile.buffer);

  logger.info(`[FileAction] File saved: ${destPath} (${downloadedFile.buffer.length} bytes)`);
  await ctx.reply(t("bot.file_saved", { path: destPath }));
}

async function copyAsText(ctx: Context, fileId: string, filename: string): Promise<void> {
  await ctx.reply(t("bot.file_downloading"));

  const downloadedFile = await downloadTelegramFile(ctx.api, fileId);
  assertSize(downloadedFile.buffer.length, filename);

  const textContent = downloadedFile.buffer.toString("utf-8");
  const promptWithFile = `--- Content of ${filename} ---\n${textContent}\n--- End of file ---`;
  const payload =
    promptWithFile.length > TELEGRAM_TEXT_LIMIT
      ? promptWithFile.slice(0, TELEGRAM_TEXT_LIMIT) + TRUNCATION_SUFFIX
      : promptWithFile;

  logger.info(`[FileAction] Sending as text: ${filename} (${downloadedFile.buffer.length} bytes)`);
  await ctx.reply(payload);
}

async function openInSO(ctx: Context, fileId: string, filename: string): Promise<void> {
  const tempPath = getTempPath();
  await fs.mkdir(tempPath, { recursive: true });

  const downloadedFile = await downloadTelegramFile(ctx.api, fileId);
  assertSize(downloadedFile.buffer.length, filename);

  const tempFilePath = path.join(tempPath, safeTempName(filename));
  await fs.writeFile(tempFilePath, downloadedFile.buffer);

  logger.info(`[FileAction] Opening in SO: ${tempFilePath}`);
  await openFile(tempFilePath);
  await ctx.reply(t("bot.file_saved", { path: tempFilePath }));
}

async function executeExternal(ctx: Context, action: FileAction, fileId: string, filename: string): Promise<void> {
  if (!action.command) {
    throw new Error("No command configured for exec action");
  }

  const tempPath = getTempPath();
  await fs.mkdir(tempPath, { recursive: true });

  const downloadedFile = await downloadTelegramFile(ctx.api, fileId);
  assertSize(downloadedFile.buffer.length, filename);

  const tempFilePath = path.join(tempPath, safeTempName(filename));
  await fs.writeFile(tempFilePath, downloadedFile.buffer);

  logger.info(`[FileAction] Executing: ${action.command} on ${tempFilePath}`);
  const result = await executeCommand(action.command, tempFilePath);
  await ctx.reply(t("bot.file_saved", { path: result.trim() || tempFilePath }));
}

export async function handleFileActionCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data) {
    return false;
  }

  const parsed = parseCallbackData(data);
  if (!parsed) {
    return false;
  }

  // The payload lives in memory: after a bot restart the button is still on screen but
  // the file_id is gone, so answer instead of failing silently.
  const payload = recallFileAction(parsed.token);
  if (!payload) {
    logger.warn(`[FileAction] Expired or unknown token: ${parsed.token}`);
    await ctx.answerCallbackQuery({ text: t("bot.file_action_expired") }).catch(() => {});
    return true;
  }

  const { fileId, filename, mimeType } = payload;
  logger.info(`[FileAction] Callback: action=${parsed.actionId}, file=${filename}, mime=${mimeType}`);

  const action = findActionById(parsed.actionId);
  if (!action) {
    logger.warn(`[FileAction] Unknown action: ${parsed.actionId}`);
    await ctx.answerCallbackQuery({ text: t("callback.unknown_command") }).catch(() => {});
    return true;
  }

  try {
    switch (action.type) {
      case "save":
        await saveFile(ctx, action, fileId, filename);
        break;
      case "copy_text":
        await copyAsText(ctx, fileId, filename);
        break;
      case "open":
        await openInSO(ctx, fileId, filename);
        break;
      case "exec":
        await executeExternal(ctx, action, fileId, filename);
        break;
      default:
        logger.warn(`[FileAction] Unknown action type: ${action.type}`);
        await ctx.reply(t("bot.file_type_unsupported"));
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(`[FileAction] Error executing action ${parsed.actionId}:`, err);

    if (action.type === "open") {
      await ctx.reply(t("bot.file_open_error", { error: errMsg }));
    } else if (action.type === "exec") {
      await ctx.reply(t("bot.file_exec_error", { error: errMsg }));
    } else {
      await ctx.reply(t("bot.file_save_error", { error: errMsg }));
    }
  }

  await ctx.answerCallbackQuery().catch(() => {});
  return true;
}
