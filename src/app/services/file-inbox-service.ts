import { randomBytes } from "node:crypto";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { config } from "../../config.js";
import { getRuntimePaths } from "../../runtime/paths.js";
import { logger } from "../../utils/logger.js";

/** Directory mode keeps the saved uploads private to the bot user. */
const INBOX_DIR_MODE = 0o700;
const INBOX_FILE_MODE = 0o600;
const MAX_FILENAME_LENGTH = 120;
// Linux filesystems cap a single filename at 255 bytes, while Windows counts
// UTF-16 units: limit both so a long non-ASCII name still saves everywhere.
const MAX_FILENAME_BYTES = 200;
const FALLBACK_FILENAME = "file";
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
/** Upload directories created by `createUploadDirName`. */
const UPLOAD_DIR_NAME = /^\d{13}-[0-9a-f]{8}$/;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export interface StoredFile {
  /** Absolute path of the saved file, as seen by the machine running the bot. */
  filePath: string;
  /** Sanitized filename inside the per-upload directory. */
  filename: string;
}

function expandHome(inputPath: string): string {
  if (inputPath === "~") {
    return os.homedir();
  }
  if (inputPath.startsWith("~/") || inputPath.startsWith("~\\")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

/**
 * Directory that holds uploads which cannot be passed to the model directly.
 * Defaults to `inbox` inside the bot home so the path is stable across runs.
 */
export function resolveInboxDir(): string {
  const configured = config.files.inboxDir.trim();
  return configured
    ? path.resolve(expandHome(configured))
    : path.join(getRuntimePaths().appHome, "inbox");
}

/**
 * Telegram filenames are attacker-controlled input: keep only the last path
 * segment and drop characters that are unsafe on Windows, macOS or Linux.
 */
export function sanitizeInboxFilename(rawName: string): string {
  const baseName = rawName.split(/[\\/]/).pop() ?? "";
  const cleaned = baseName
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>:"|?*]/g, "_")
    .replace(/^[.\s]+/, "")
    .replace(/[.\s]+$/, "")
    .trim();

  const name = cleaned || FALLBACK_FILENAME;
  // Device names such as CON or NUL cannot be created as files on Windows.
  const safeName = WINDOWS_RESERVED_NAME.test(name) ? `_${name}` : name;
  return truncateFilename(safeName);
}

function limitFilenameBytes(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) {
    return value;
  }

  let result = "";
  let bytes = 0;
  for (const char of value) {
    const charBytes = Buffer.byteLength(char, "utf8");
    if (bytes + charBytes > maxBytes) {
      break;
    }
    result += char;
    bytes += charBytes;
  }
  return result;
}

function truncateFilename(name: string): string {
  if (
    name.length <= MAX_FILENAME_LENGTH &&
    Buffer.byteLength(name, "utf8") <= MAX_FILENAME_BYTES
  ) {
    return name;
  }

  const extension = path.extname(name);
  const extensionBytes = Buffer.byteLength(extension, "utf8");
  const keepExtension = extension.length > 0 && extensionBytes < MAX_FILENAME_BYTES - 1;

  if (!keepExtension) {
    return (
      limitFilenameBytes(name.slice(0, MAX_FILENAME_LENGTH), MAX_FILENAME_BYTES) ||
      FALLBACK_FILENAME
    );
  }

  const stem = name.slice(0, name.length - extension.length);
  const stemLengthBudget = Math.max(1, MAX_FILENAME_LENGTH - extension.length);
  const stemBytesBudget = Math.max(1, MAX_FILENAME_BYTES - extensionBytes);
  const limitedStem = limitFilenameBytes(stem.slice(0, stemLengthBudget), stemBytesBudget);
  return `${limitedStem || FALLBACK_FILENAME}${extension}`;
}

function createUploadDirName(): string {
  return `${Date.now()}-${randomBytes(4).toString("hex")}`;
}

/**
 * Saves the original Telegram document bytes unchanged. Every upload gets its
 * own directory so the original filename survives without collisions.
 */
export async function saveTelegramFile(
  buffer: Buffer,
  originalName: string,
  inboxDir: string = resolveInboxDir(),
): Promise<StoredFile> {
  const filename = sanitizeInboxFilename(originalName);
  const uploadDir = path.join(inboxDir, createUploadDirName());
  const filePath = path.join(uploadDir, filename);

  await mkdir(uploadDir, { recursive: true, mode: INBOX_DIR_MODE });
  await writeFile(filePath, buffer, { mode: INBOX_FILE_MODE });

  logger.debug(`[FileInbox] Saved ${buffer.length} bytes to ${filePath}`);

  // Cleanup is best effort: a failed sweep must not lose an already saved file.
  try {
    await pruneInbox(inboxDir);
  } catch (err) {
    logger.warn("[FileInbox] Failed to prune expired uploads:", err);
  }

  return { filePath, filename };
}

/**
 * Removes uploads older than `FILE_INBOX_RETENTION_DAYS`. A non-positive
 * retention keeps files forever.
 */
export async function pruneInbox(
  inboxDir: string = resolveInboxDir(),
  now: number = Date.now(),
): Promise<number> {
  const retentionDays = config.files.inboxRetentionDays;
  if (retentionDays <= 0) {
    return 0;
  }

  const cutoff = now - retentionDays * MILLISECONDS_PER_DAY;

  let entries;
  try {
    entries = await readdir(inboxDir, { withFileTypes: true });
  } catch (err) {
    // The directory does not exist until the first upload.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return 0;
    }
    throw err;
  }

  let removed = 0;
  for (const entry of entries) {
    // Only sweep our own upload directories: the inbox may be a shared folder
    // that also holds files the bot did not create.
    if (!entry.isDirectory() || !UPLOAD_DIR_NAME.test(entry.name)) {
      continue;
    }

    const entryPath = path.join(inboxDir, entry.name);
    try {
      const info = await stat(entryPath);
      if (info.mtimeMs >= cutoff) {
        continue;
      }
      await rm(entryPath, { recursive: true, force: true });
      removed += 1;
    } catch (err) {
      logger.warn(`[FileInbox] Failed to remove expired upload ${entryPath}:`, err);
    }
  }

  if (removed > 0) {
    logger.info(`[FileInbox] Removed ${removed} expired upload(s) from ${inboxDir}`);
  }

  return removed;
}

/**
 * Prompt section handed to the agent. It must not read as a native model
 * attachment: the agent only gets a path it can inspect with its own tools.
 */
export function buildLocalFileSection(file: StoredFile): string {
  return [
    "--- Local file ---",
    `The user sent "${file.filename}" through Telegram. The original file is saved at:`,
    file.filePath,
    "This is a local filesystem path on the machine running OpenCode, not a model attachment.",
    "Read it with your own tools if you need its contents.",
    "--- End of local file ---",
  ].join("\n");
}
