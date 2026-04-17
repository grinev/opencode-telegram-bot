import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import type { Context } from "grammy";
import type { FilePartInput } from "@opencode-ai/sdk/v2";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import { config } from "../../config.js";
import { isSttConfigured, transcribeAudio, type SttResult } from "../../stt/client.js";
import { processUserPrompt, type ProcessPromptDeps } from "./prompt.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";

const TELEGRAM_DOWNLOAD_TIMEOUT_MS = 30_000;
const TELEGRAM_DOWNLOAD_MAX_REDIRECTS = 3;

let telegramDownloadAgent: https.RequestOptions["agent"] | null | undefined;

function getTelegramDownloadAgent(): https.RequestOptions["agent"] | undefined {
  if (telegramDownloadAgent !== undefined) {
    return telegramDownloadAgent || undefined;
  }

  const proxyUrl = config.telegram.proxyUrl.trim();
  if (!proxyUrl) {
    telegramDownloadAgent = null;
    return undefined;
  }

  telegramDownloadAgent = proxyUrl.startsWith("socks")
    ? new SocksProxyAgent(proxyUrl)
    : new HttpsProxyAgent(proxyUrl);

  logger.info(`[Voice] Using Telegram download proxy: ${proxyUrl.replace(/\/\/.*@/, "//***@")}`);
  return telegramDownloadAgent;
}

async function downloadTelegramFileByUrl(url: string, redirectDepth: number = 0): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const targetUrl = new URL(url);
    const requestModule = targetUrl.protocol === "http:" ? http : https;

    const request = requestModule.get(
      targetUrl,
      { agent: getTelegramDownloadAgent() },
      (response) => {
        const statusCode = response.statusCode ?? 0;

        if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
          response.resume();

          if (redirectDepth >= TELEGRAM_DOWNLOAD_MAX_REDIRECTS) {
            reject(new Error("Too many redirects while downloading Telegram file"));
            return;
          }

          const redirectUrl = new URL(response.headers.location, targetUrl).toString();
          void downloadTelegramFileByUrl(redirectUrl, redirectDepth + 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          reject(new Error(`Telegram file download failed with HTTP ${statusCode}`));
          return;
        }

        const chunks: Buffer[] = [];

        response.on("data", (chunk: Buffer | string) => {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        });

        response.on("end", () => {
          resolve(Buffer.concat(chunks));
        });

        response.on("error", reject);
      },
    );

    request.on("error", reject);
    request.setTimeout(TELEGRAM_DOWNLOAD_TIMEOUT_MS, () => {
      request.destroy(
        new Error(`Telegram file download timed out after ${TELEGRAM_DOWNLOAD_TIMEOUT_MS}ms`),
      );
    });
  });
}

export interface VoiceMessageDeps extends ProcessPromptDeps {
  isSttConfigured?: () => boolean;
  downloadTelegramFile?: (
    ctx: Context,
    fileId: string,
  ) => Promise<{ buffer: Buffer; filename: string } | null>;
  transcribeAudio?: (audioBuffer: Buffer, filename: string) => Promise<SttResult>;
  processPrompt?: (
    ctx: Context,
    text: string,
    deps: ProcessPromptDeps,
    fileParts?: FilePartInput[],
    options?: { responseMode?: "text_only" | "text_and_tts" },
  ) => Promise<boolean>;
}

/**
 * Downloads the audio file from Telegram servers.
 *
 * @returns Buffer with file content, or null on failure
 */
async function downloadTelegramFile(
  ctx: Context,
  fileId: string,
): Promise<{ buffer: Buffer; filename: string } | null> {
  try {
    const file = await ctx.api.getFile(fileId);

    if (!file.file_path) {
      logger.error("[Voice] Telegram getFile returned no file_path");
      return null;
    }

    const fileUrl = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;

    logger.debug(`[Voice] Downloading file: ${file.file_path} (${file.file_size ?? "?"} bytes)`);

    const buffer = await downloadTelegramFileByUrl(fileUrl);

    // Extract filename from file_path (e.g., "voice/file_123.oga" -> "file_123.oga")
    let filename = file.file_path.split("/").pop() || "audio.ogg";

    if (filename.endsWith(".oga")) {
      filename = filename.slice(0, -4) + ".ogg";
    }

    logger.debug(`[Voice] Downloaded file: ${filename} (${buffer.length} bytes)`);
    return { buffer, filename };
  } catch (err) {
    logger.error("[Voice] Error downloading file from Telegram:", err);
    return null;
  }
}

/**
 * Creates the voice message handler function.
 *
 * The factory pattern is used so that `bot` and `ensureEventSubscription` dependencies
 * can be injected from createBot() without circular imports.
 */
export function createVoiceHandler(deps: VoiceMessageDeps) {
  return async (ctx: Context): Promise<void> => {
    await handleVoiceMessage(ctx, deps);
  };
}

/**
 * Handles incoming voice and audio messages:
 * 1. Checks if STT is configured
 * 2. Downloads the audio file from Telegram
 * 3. Sends "recognizing..." status message
 * 4. Calls STT API
 * 5. Shows recognized text
 * 6. Passes text to processUserPrompt
 */
export async function handleVoiceMessage(ctx: Context, deps: VoiceMessageDeps): Promise<void> {
  const sttConfigured = deps.isSttConfigured ?? isSttConfigured;
  const downloadFile = deps.downloadTelegramFile ?? downloadTelegramFile;
  const transcribe = deps.transcribeAudio ?? transcribeAudio;
  const processPrompt = deps.processPrompt ?? processUserPrompt;

  // Determine file_id from voice or audio message
  const voice = ctx.message?.voice;
  const audio = ctx.message?.audio;
  const fileId = voice?.file_id ?? audio?.file_id;

  if (!fileId) {
    logger.warn("[Voice] Received voice/audio message with no file_id");
    return;
  }

  // Check if STT is configured
  if (!sttConfigured()) {
    await ctx.reply(t("stt.not_configured"));
    return;
  }

  // Send "recognizing..." status message (will be edited later)
  const statusMessage = await ctx.reply(t("stt.recognizing"));

  try {
    // Download the audio file from Telegram
    const fileData = await downloadFile(ctx, fileId);
    if (!fileData) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMessage.message_id,
        t("stt.error", { error: "download failed" }),
      );
      return;
    }

    // Transcribe the audio
    const result = await transcribe(fileData.buffer, fileData.filename);

    const recognizedText = result.text.trim();
    if (!recognizedText) {
      await ctx.api.editMessageText(ctx.chat!.id, statusMessage.message_id, t("stt.empty_result"));
      return;
    }

    // Show the recognized text by editing the status message.
    // IMPORTANT: even if this edit fails (e.g. Telegram message length limits),
    // we still send the recognized text to OpenCode as a prompt.
    try {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMessage.message_id,
        t("stt.recognized", { text: recognizedText }),
      );
    } catch (editError) {
      logger.warn("[Voice] Failed to edit status message with recognized text:", editError);
    }

    logger.info(`[Voice] Transcribed audio: ${recognizedText.length} chars`);

    let textForLLM = recognizedText;
    const notePrompt = config.stt.notePrompt.trim();

    if (notePrompt && notePrompt.toLowerCase() !== "false" && notePrompt !== "0") {
      const llmNote = `[Note: ${notePrompt}]`;
      logger.debug(`[Voice] Added STT note to LLM prompt: ${llmNote}`);
      textForLLM = `${llmNote}\n${recognizedText}`;
    }

    // Process the recognized text as a prompt
    await processPrompt(ctx, textForLLM, deps);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "unknown error";
    logger.error("[Voice] Error processing voice message:", err);

    try {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMessage.message_id,
        t("stt.error", { error: errorMessage }),
      );
    } catch {
      // If we can't edit the status message, try sending a new one
      await ctx.reply(t("stt.error", { error: errorMessage })).catch(() => {});
    }
  }
}
