import type { Context } from "grammy";
import { config } from "../../config.js";
import { getTtsMode } from "../../app/stores/settings-store.js";
import {
  isSttConfigured,
  transcribeAudio,
  type SttResult,
} from "../../app/services/stt-service.js";
import { processUserPrompt, type ProcessPromptDeps } from "./prompt.js";
import { createIncomingPrompt, type IncomingPrompt } from "../../app/types/prompt.js";
import { flushPendingPrompt } from "./message-merger.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { buildTelegramFileUrl } from "../../app/services/file-download-service.js";
import { buildQuotedNotification } from "../../app/services/quoted-notification.js";
import { editBotText } from "../messages/telegram-text.js";
import { tryEnqueuePromptIfBusy } from "./prompt-queue-dispatch.js";

const TELEGRAM_DOWNLOAD_TIMEOUT_MS = 30_000;

let cachedProxyUrl: string | null | undefined;

function getTelegramDownloadProxy(): string | undefined {
  if (cachedProxyUrl !== undefined) {
    return cachedProxyUrl ?? undefined;
  }

  const proxyUrl = config.telegram.proxyUrl.trim();
  if (!proxyUrl) {
    cachedProxyUrl = null;
    return undefined;
  }

  if (proxyUrl.startsWith("socks")) {
    logger.warn(
      "[Voice] SOCKS proxies are not supported by Bun's fetch. Falling back to a direct connection.",
    );
    cachedProxyUrl = null;
    return undefined;
  }

  cachedProxyUrl = proxyUrl;
  logger.info(`[Voice] Using Telegram download proxy: ${proxyUrl.replace(/\/\/.*@/, "//***@")}`);
  return proxyUrl;
}

async function downloadTelegramFileByUrl(url: string): Promise<Buffer> {
  const proxyUrl = getTelegramDownloadProxy();
  const proxySecret = config.telegram.proxySecret;
  const headers: Record<string, string> = {};
  if (proxySecret) {
    headers["X-Proxy-Secret"] = proxySecret;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TELEGRAM_DOWNLOAD_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...(proxyUrl ? { proxy: proxyUrl } : {}),
      headers,
      signal: controller.signal,
      redirect: "follow",
    });

    if (!response.ok) {
      throw new Error(`Telegram file download failed with HTTP ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    if ((error as { name?: string }).name === "AbortError") {
      throw new Error(`Telegram file download timed out after ${TELEGRAM_DOWNLOAD_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
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
    input: IncomingPrompt,
    deps: ProcessPromptDeps,
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

    const fileUrl = buildTelegramFileUrl(file.file_path);

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

  flushPendingPrompt(ctx.chat!.id);

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
      const notification = buildQuotedNotification(t("stt.recognized"), recognizedText, {
        blankLineAfterTitle: false,
      });
      await editBotText({
        api: ctx.api,
        chatId: ctx.chat!.id,
        messageId: statusMessage.message_id,
        text: notification.text,
        rawFallbackText: notification.rawFallbackText,
        format: "markdown_v2",
      });
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
    const currentTtsMode = getTtsMode();
    const responseMode =
      currentTtsMode === "all" || currentTtsMode === "auto" ? "text_and_tts" : "text_only";
    if (
      await tryEnqueuePromptIfBusy(ctx, {
        ...createIncomingPrompt(textForLLM),
        displayText: recognizedText,
        responseMode,
      })
    ) {
      return;
    }
    await processPrompt(ctx, createIncomingPrompt(textForLLM), deps, { responseMode });
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
