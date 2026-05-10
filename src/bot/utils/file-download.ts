import type { Api } from "grammy";
import { config } from "../../config.js";
import { logger } from "../../utils/logger.js";

const DEFAULT_TELEGRAM_FILE_URL_BASE = "https://api.telegram.org/file/bot";

function fileUrlBase(): string {
  return config.telegram.apiRoot
    ? `${config.telegram.apiRoot.replace(/\/$/, "")}/file/bot`
    : DEFAULT_TELEGRAM_FILE_URL_BASE;
}
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB Telegram limit

export interface DownloadedFile {
  buffer: Buffer;
  filePath: string;
  mimeType?: string;
}

/**
 * Download a photo from Telegram servers
 * @param api Grammy API instance
 * @param fileId Telegram file_id
 * @returns Downloaded photo buffer and path
 */
export async function downloadTelegramFile(api: Api, fileId: string): Promise<DownloadedFile> {
  logger.debug(`[FileDownload] Getting file info for fileId=${fileId}`);

  const file = await api.getFile(fileId);

  if (!file.file_path) {
    throw new Error("File path not available from Telegram");
  }

  if (file.file_size && file.file_size > MAX_FILE_SIZE_BYTES) {
    const sizeMb = (file.file_size / (1024 * 1024)).toFixed(2);
    throw new Error(`File too large: ${sizeMb}MB (max 20MB)`);
  }

  const fileUrl = `${fileUrlBase()}${config.telegram.token}/${file.file_path}`;
  logger.debug(`[FileDownload] Downloading from ${fileUrl.replace(config.telegram.token, "***")}`);

  const fetchOptions: RequestInit & { agent?: unknown } = {};

  // Use proxy if configured
  if (config.telegram.proxyUrl) {
    const { HttpsProxyAgent } = await import("https-proxy-agent");
    fetchOptions.agent = new HttpsProxyAgent(config.telegram.proxyUrl);
  }

  // Send shared secret when custom API root expects it
  if (config.telegram.proxySecret) {
    fetchOptions.headers = {
      ...(fetchOptions.headers as Record<string, string> | undefined),
      "X-Proxy-Secret": config.telegram.proxySecret,
    };
  }

  const response = await fetch(fileUrl, fetchOptions);

  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  logger.debug(`[FileDownload] Downloaded ${buffer.length} bytes`);

  return {
    buffer,
    filePath: file.file_path,
  };
}

/**
 * Convert buffer to base64 data URI
 * @param buffer File buffer
 * @param mimeType MIME type (e.g., "image/jpeg")
 * @returns Data URI string
 */
export function toDataUri(buffer: Buffer, mimeType: string): string {
  const base64 = buffer.toString("base64");
  return `data:${mimeType};base64,${base64}`;
}

/**
 * Check if photo size is within limits
 * @param fileSize Photo size in bytes
 * @param maxSizeKb Maximum size in KB (from config)
 * @returns true if within limit
 */
export function isFileSizeAllowed(fileSize: number | undefined, maxSizeKb: number): boolean {
  if (!fileSize) {
    return true; // Unknown size, allow (will be checked on download)
  }

  const maxBytes = maxSizeKb * 1024;
  return fileSize <= maxBytes;
}

/**
 * Get human-readable photo size
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

const APPLICATION_TEXT_MIME_TYPES = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/x-yaml",
  "application/sql",
]);

export function isTextMimeType(mimeType: string | undefined): boolean {
  if (!mimeType) {
    return false;
  }

  if (mimeType.startsWith("text/")) {
    return true;
  }

  return APPLICATION_TEXT_MIME_TYPES.has(mimeType);
}
