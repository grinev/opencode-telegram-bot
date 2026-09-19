import type { Context } from "grammy";
import { processUserPrompt, type ProcessPromptDeps } from "./prompt.js";
import {
  downloadTelegramFile,
  MAX_FILE_SIZE_BYTES,
} from "../../app/services/file-download-service.js";
import {
  buildVideoSavedNote,
  saveVideoForAgent,
  videoExtensionFor,
} from "../../app/services/video-save-service.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { flushPendingPrompt } from "./message-merger.js";
import { createIncomingPrompt, type IncomingPrompt } from "../../app/types/prompt.js";
import {
  rejectQueuedMediaBeforePreparation,
  tryEnqueuePromptIfBusy,
} from "./prompt-queue-dispatch.js";

const MAX_FILE_SIZE_MB = String(MAX_FILE_SIZE_BYTES / (1024 * 1024));

export interface VideoHandlerDeps extends ProcessPromptDeps {
  downloadFile?: (
    api: Context["api"],
    fileId: string,
  ) => Promise<{ buffer: Buffer; filePath: string }>;
  saveVideo?: (buffer: Buffer, extension?: string) => Promise<string>;
  processPrompt?: (
    ctx: Context,
    input: IncomingPrompt,
    deps: ProcessPromptDeps,
  ) => Promise<boolean>;
}

export async function handleVideoMessage(ctx: Context, deps: VideoHandlerDeps): Promise<void> {
  const downloadFile = deps.downloadFile ?? downloadTelegramFile;
  const saveVideo = deps.saveVideo ?? saveVideoForAgent;
  const processPrompt = deps.processPrompt ?? processUserPrompt;

  const video = ctx.message?.video;
  if (!video) {
    return;
  }

  flushPendingPrompt(ctx.chat!.id);

  const caption = ctx.message.caption || "";
  const submitPrompt = async (text: string, mediaBytes: number | undefined): Promise<void> => {
    const input = createIncomingPrompt(text);
    if (
      await tryEnqueuePromptIfBusy(ctx, {
        ...input,
        displayText: caption.trim() || "[Video]",
        ...(mediaBytes === undefined ? {} : { mediaBytes }),
      })
    ) {
      return;
    }
    await processPrompt(ctx, input, deps);
  };

  try {
    if (video.file_size && video.file_size > MAX_FILE_SIZE_BYTES) {
      logger.warn(
        `[Video] Video too large: ${video.file_size} bytes > ${MAX_FILE_SIZE_BYTES} (Telegram Bot API download limit)`,
      );
      await ctx.reply(t("bot.file_too_large", { maxSizeMb: MAX_FILE_SIZE_MB }));
      return;
    }

    await ctx.reply(t("bot.file_downloading"));
    if (await rejectQueuedMediaBeforePreparation(ctx, video.file_size)) {
      return;
    }
    const downloadedFile = await downloadFile(ctx.api, video.file_id);
    const savedPath = await saveVideo(
      downloadedFile.buffer,
      videoExtensionFor(video.mime_type, video.file_name),
    );
    const note = buildVideoSavedNote(savedPath);

    logger.info(
      `[Video] Saved video (${downloadedFile.buffer.length} bytes, ${video.file_name ?? "video"}) for agent inspection`,
    );

    await submitPrompt(caption ? `${caption}\n\n${note}` : note, video.file_size);
  } catch (err) {
    logger.error("[Video] Error handling video message:", err);
    await ctx.reply(t("bot.file_download_error"));
  }
}
