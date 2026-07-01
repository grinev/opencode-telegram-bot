// @ts-expect-error - node-fetch v2 ships no TS types and we avoid adding @types/node-fetch
import nodeFetch from "node-fetch";
import type { Api } from "grammy";
import { Agent as HttpsAgent } from "https";
import { config } from "../../config.js";
import { logger } from "../../utils/logger.js";

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const DEFAULT_TELEGRAM_API_ROOT = "https://api.telegram.org";

export interface DownloadedFile {
  buffer: Buffer;
  filePath: string;
  mimeType?: string;
}

function telegramFileUrlBase(): string {
  const apiRoot = config.telegram.apiRoot
    ? config.telegram.apiRoot.replace(/\/+$/, "")
    : DEFAULT_TELEGRAM_API_ROOT;

  return `${apiRoot}/file/bot`;
}

export function buildTelegramFileUrl(filePath: string): string {
  return `${telegramFileUrlBase()}${config.telegram.token}/${filePath}`;
}

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

  const fileUrl = buildTelegramFileUrl(file.file_path);
  logger.debug(`[FileDownload] Downloading from ${fileUrl.replace(config.telegram.token, "***")}`);

  const fetchOptions: RequestInit & { agent?: unknown } = {};

  if (config.telegram.proxyUrl) {
    const { HttpsProxyAgent } = await import("https-proxy-agent");
    fetchOptions.agent = new HttpsProxyAgent(config.telegram.proxyUrl);
  } else if (config.telegram.forceIpv4) {
    fetchOptions.agent = new HttpsAgent({ family: 4, keepAlive: true });
  }

  if (config.telegram.proxySecret) {
    fetchOptions.headers = {
      ...(fetchOptions.headers as Record<string, string> | undefined),
      "X-Proxy-Secret": config.telegram.proxySecret,
    };
  }

  const response = await nodeFetch(fileUrl, fetchOptions);

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

export function toDataUri(buffer: Buffer, mimeType: string): string {
  const base64 = buffer.toString("base64");
  return `data:${mimeType};base64,${base64}`;
}

export function isFileSizeAllowed(fileSize: number | undefined, maxSizeKb: number): boolean {
  if (!fileSize) {
    return true;
  }

  const maxBytes = maxSizeKb * 1024;
  return fileSize <= maxBytes;
}

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

const TEXT_FILE_EXTENSIONS = new Set([
  "svelte",
  "vue",
  "ts",
  "tsx",
  "jsx",
  "mjs",
  "cjs",
  "go",
  "rs",
  "rb",
  "py",
  "java",
  "c",
  "cpp",
  "h",
  "hpp",
  "cs",
  "swift",
  "kt",
  "kts",
  "sh",
  "bash",
  "yaml",
  "yml",
  "toml",
  "ini",
  "cfg",
  "md",
  "mdx",
  "css",
  "scss",
  "less",
  "html",
  "htm",
  "graphql",
  "gql",
  "proto",
  "gradle",
]);

export function isTextMimeType(mimeType: string | undefined, filename?: string): boolean {
  if (!mimeType) {
    return false;
  }

  if (mimeType.startsWith("text/")) {
    return true;
  }

  if (APPLICATION_TEXT_MIME_TYPES.has(mimeType)) {
    return true;
  }

  if (filename) {
    const ext = filename.split(".").pop()?.toLowerCase();
    if (ext && TEXT_FILE_EXTENSIONS.has(ext)) {
      return true;
    }
  }

  return false;
}
