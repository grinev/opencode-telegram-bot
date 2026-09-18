import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { Bot, Context } from "grammy";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import { config } from "../../config.js";
import {
  isLocalSttConfigured,
  transcribeAudioLocal,
  type LocalSttResult,
  getLocalSttNotConfiguredMessage,
} from "../../app/services/local-stt-service.js";
import {
  isVoskSttConfigured,
  transcribeAudioVosk,
  getVoskSttNotConfiguredMessage,
} from "../../app/services/local-vosk-stt-service.js";
import {
  isWhisperSttConfigured,
  transcribeAudioWhisper,
  getWhisperSttNotConfiguredMessage,
} from "../../app/services/local-whisper-stt-service.js";
import { processUserPrompt, type ProcessPromptDeps } from "./prompt.js";
import { flushPendingPrompt } from "./message-merger.js";
import { createIncomingPrompt } from "../../app/types/prompt.js";
import { logger } from "../../utils/logger.js";
import { buildTelegramFileUrl } from "../../app/services/file-download-service.js";

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

    const proxySecret = config.telegram.proxySecret;
    const request = requestModule.get(
      targetUrl,
      {
        agent: getTelegramDownloadAgent(),
        ...(proxySecret ? { headers: { "X-Proxy-Secret": proxySecret } } : {}),
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;

        logger.debug(`[Voice] HTTP ${statusCode} for ${url}`);

        if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
          response.resume();

          if (redirectDepth >= TELEGRAM_DOWNLOAD_MAX_REDIRECTS) {
            reject(new Error("Too many redirects while downloading Telegram file"));
            return;
          }

          const redirectUrl = new URL(response.headers.location, targetUrl).toString();
          logger.debug(`[Voice] Redirecting to: ${redirectUrl}`);
          void downloadTelegramFileByUrl(redirectUrl, redirectDepth + 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          let errorBody = "";
          response.on("data", (chunk) => { errorBody += chunk.toString(); });
          response.on("end", () => {
            reject(new Error(`Telegram file download failed with HTTP ${statusCode}: ${errorBody}`));
          });
          return;
        }

        const chunks: Buffer[] = [];

        response.on("data", (chunk: Buffer | string) => {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        });

        response.on("end", () => {
          resolve(Buffer.concat(chunks));
        });

        response.on("error", (err) => reject(err));
      },
    );

    request.on("error", (err) => {
      logger.error(`[Voice] Request error: ${err.message}`);
      reject(err);
    });
    request.setTimeout(TELEGRAM_DOWNLOAD_TIMEOUT_MS, () => {
      request.destroy(
        new Error(`Telegram file download timed out after ${TELEGRAM_DOWNLOAD_TIMEOUT_MS}ms`),
      );
    });
  });
}

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

    const fileUrl = buildTelegramFileUrl(file.file_path);

    logger.info(`[Voice] Downloading file: ${file.file_path} (${file.file_size ?? "?"} bytes) from ${fileUrl}`);

    const buffer = await downloadTelegramFileByUrl(fileUrl);

    let filename = file.file_path.split("/").pop() || "audio.ogg";

    if (filename.endsWith(".oga")) {
      filename = filename.slice(0, -4) + ".ogg";
    }

    logger.info(`[Voice] Downloaded file: ${filename} (${buffer.length} bytes)`);
    return { buffer, filename };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? err.stack : undefined;
    logger.error(`[Voice] Error downloading file from Telegram: ${errorMessage}`, errorStack);
    return null;
  }
}

/**
 * Creates the voice message handler function.
 * Uses the same SDK path as text messages: transcribe → processUserPrompt → SSE → summary + TTS.
 */
export function createVoiceHandler() {
  return async (ctx: Context): Promise<void> => {
    await handleVoiceMessage(ctx);
  };
}

/**
 * Handles incoming voice/audio messages using local STT + OpenCode SDK + Edge TTS:
 * 1. Downloads the audio file from Telegram
 * 2. Transcribes using Vosk (offline) or API-based STT (Groq, etc.)
 * 3. Calls processUserPrompt with transcribed text (responseMode: text_and_tts)
 * 4. SSE events flow through summaryAggregator → onComplete sends text + TTS voice note
 */
export interface VoiceHandlerDeps {
  bot?: Bot<Context>;
  ensureEventSubscription?: (directory: string) => Promise<void>;
  downloadFile?: (
    ctx: Context,
    fileId: string,
  ) => Promise<{ buffer: Buffer; filename: string } | null>;
  transcribeAudio?: (audioBuffer: Buffer, filename: string) => Promise<LocalSttResult>;
  getSttNotConfiguredMessage?: () => string;
  isSttConfigured?: () => boolean;
}

export async function handleVoiceMessage(
  ctx: Context,
  deps: VoiceHandlerDeps = {} as VoiceHandlerDeps,
): Promise<void> {
  const voice = ctx.message?.voice;
  const audio = ctx.message?.audio;
  const fileId = voice?.file_id ?? audio?.file_id;

  if (!fileId) {
    logger.warn("[Voice] Received voice/audio message with no file_id");
    return;
  }

  flushPendingPrompt(ctx.chat!.id);

  // Determine STT mode from config
  const sttMode = config.voiceCli.sttMode || "api";
  const useVosk = sttMode === "vosk";
  const useWhisper = sttMode === "whisper";

  const downloadFile = deps.downloadFile ?? downloadTelegramFile;
  const transcribeAudio =
    deps.transcribeAudio ??
    (useVosk ? transcribeAudioVosk : useWhisper ? transcribeAudioWhisper : transcribeAudioLocal);
  const getSttNotConfiguredMessage =
    deps.getSttNotConfiguredMessage ??
    (useVosk
      ? getVoskSttNotConfiguredMessage
      : useWhisper
        ? getWhisperSttNotConfiguredMessage
        : getLocalSttNotConfiguredMessage);
  const isSttConfigured =
    deps.isSttConfigured ?? (useVosk ? isVoskSttConfigured : useWhisper ? isWhisperSttConfigured : isLocalSttConfigured);

  // Check STT configuration based on mode
  if (!isSttConfigured()) {
    await ctx.reply(getSttNotConfiguredMessage());
    return;
  }

  // Send "processing..." status message
  const sttLabel = useWhisper ? "Whisper (local)" : useVosk ? "Vosk (offline)" : "API";
  const statusMessage = await ctx.reply(
    `🎙️ Processing voice message...\n1/3 Downloading audio...\n🔧 STT: ${sttLabel}`,
  );

  try {
    // Step 1: Download the audio file
    const fileData = await downloadFile(ctx, fileId);
    if (!fileData) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMessage.message_id,
        "❌ Failed to download audio file from Telegram",
      );
      return;
    }

    // Step 2: Transcribe
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMessage.message_id,
      `🎙️ Processing voice message...\n1/3 ✅ Downloaded\n2/3 🔄 Transcribing (${sttLabel})...`,
    );

    const result = await transcribeAudio(fileData.buffer, fileData.filename);
    const recognizedText = result.text.trim();

    if (!recognizedText) {
      await ctx.api.editMessageText(ctx.chat!.id, statusMessage.message_id, "❌ No speech detected in audio");
      return;
    }

    logger.info(`[Voice] Transcribed (${sttLabel}): ${recognizedText.length} chars`);

    // Step 3: Send to OpenCode via SDK (same as text messages)
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMessage.message_id,
      `🎙️ Processing voice message...\n1/3 ✅ Downloaded\n2/3 ✅ Transcribed\n3/3 🔄 Sending to OpenCode...\n\n📝 Recognized: ${recognizedText.slice(0, 200)}${recognizedText.length > 200 ? "..." : ""}`,
    );

    // Use the same prompt processing as text messages, with TTS enabled
    const promptDeps: ProcessPromptDeps = {
      bot: deps.bot!,
      ensureEventSubscription: deps.ensureEventSubscription!,
    };

    await processUserPrompt(ctx, createIncomingPrompt(recognizedText), promptDeps, {
      responseMode: "text_and_tts",
    });

    // Status message will be updated by the SSE flow (typing indicator, tool notifications, etc.)
    // The final text response appears naturally via the streaming response.

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "unknown error";
    logger.error("[Voice] Error processing voice message:", err);

    try {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMessage.message_id,
        `❌ Error: ${errorMessage}`,
      );
    } catch {
      await ctx.reply(`❌ Error: ${errorMessage}`).catch(() => {});
    }
  }
}