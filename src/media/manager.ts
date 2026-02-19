import { promises as fs } from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { spawn } from "child_process";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

let mediaDirEnsured = false;

/** @internal - for testing only */
export function __resetMediaDirCacheForTests(): void {
  mediaDirEnsured = false;
}

export async function ensureMediaDir(): Promise<string> {
  if (mediaDirEnsured) {
    return config.media.dir;
  }

  try {
    await fs.mkdir(config.media.dir, { recursive: true });
    mediaDirEnsured = true;
    logger.info(`[Media] Media directory ready: ${config.media.dir}`);
    return config.media.dir;
  } catch (err) {
    logger.error("[Media] Failed to create media directory:", err);
    throw err;
  }
}

export interface SavedMedia {
  filePath: string;
  fileName: string;
  fileUrl: string;
  mimeType: string;
}

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".json": "application/json",
  ".zip": "application/zip",
};

function getMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

export async function saveTelegramFile(
  api: { getFile: (fileId: string) => Promise<{ file_path?: string }> },
  fileId: string,
  originalFileName: string,
): Promise<SavedMedia> {
  await ensureMediaDir();

  const file = await api.getFile(fileId);
  if (!file.file_path) {
    throw new Error("Could not get file path from Telegram");
  }

  const timestamp = Date.now();
  const ext = path.extname(originalFileName) || "";
  const baseName = path.basename(originalFileName, ext);
  const safeBaseName = baseName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50);
  const fileName = `${timestamp}_${safeBaseName}${ext}`;
  const filePath = path.join(config.media.dir, fileName);

  const telegramUrl = `https://api.telegram.org/file/bot${config.telegram.token}/${file.file_path}`;

  logger.debug(`[Media] Downloading file from Telegram: file_path=${file.file_path}`);

  const response = await fetch(telegramUrl);
  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  await fs.writeFile(filePath, Buffer.from(buffer));

  logger.info(`[Media] Saved file: ${filePath} (${buffer.byteLength} bytes)`);

  const fileUrl = pathToFileURL(filePath).href;
  const mimeType = getMimeType(fileName);

  return { filePath, fileName, fileUrl, mimeType };
}

export interface TranscriptionResult {
  success: boolean;
  notConfigured?: boolean;
  transcript?: string;
  error?: string;
  details?: string;
}

function truncateOutput(text: string, maxLength: number = 1200): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

export async function transcribeAudioFile(filePath: string): Promise<TranscriptionResult> {
  const command = config.transcription.command;
  if (!command || command === "false") {
    return {
      success: false,
      notConfigured: true,
      error: "TRANSCRIBE_VOICE_COMMAND not configured",
    };
  }

  const fullCommand = command.replace("{voice-message-file}", filePath);

  logger.info(`[Transcription] Running: ${fullCommand}`);

  return new Promise((resolve) => {
    const process = spawn(fullCommand, [], {
      shell: true,
      timeout: 60000, // 60 second timeout
    });

    let stdout = "";
    let stderr = "";

    process.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    process.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    process.on("close", (code) => {
      if (code === 0 && stdout.trim()) {
        logger.info(`[Transcription] Success: ${stdout.trim().slice(0, 100)}...`);
        resolve({ success: true, transcript: stdout.trim() });
      } else {
        const error = stderr.trim() || `Exit code ${code}`;
        const detailLines = [
          `command: ${fullCommand}`,
          stderr.trim() ? `stderr: ${truncateOutput(stderr.trim())}` : "",
          stdout.trim() ? `stdout: ${truncateOutput(stdout.trim())}` : "",
          `exit_code: ${code ?? "unknown"}`,
        ].filter(Boolean);

        logger.warn(`[Transcription] Failed: ${error}`);
        resolve({ success: false, error, details: detailLines.join("\n") });
      }
    });

    process.on("error", (err) => {
      logger.error(`[Transcription] Error: ${err.message}`);
      resolve({ success: false, error: err.message });
    });
  });
}
