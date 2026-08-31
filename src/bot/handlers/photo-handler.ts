import type { Context } from "grammy";
import type { FilePartInput, Model } from "@opencode-ai/sdk/v2";
import { downloadTelegramFile, toDataUri } from "../../app/services/file-download-service.js";
import { getModelCapabilities, supportsInput } from "../../app/services/model-capabilities-service.js";
import { getStoredModel } from "../../app/services/model-selection-service.js";
import { describeImageWithLocalVision, type LocalVisionResult } from "../../app/services/local-vision-service.js";
import { savePhotoForAgent } from "../../app/services/photo-save-service.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { flushPendingPrompt } from "./message-merger.js";
import { processUserPrompt, type ProcessPromptDeps } from "./prompt.js";

export interface PhotoHandlerDeps extends ProcessPromptDeps {
  downloadFile?: (
    api: Context["api"],
    fileId: string,
  ) => Promise<{ buffer: Buffer; filePath: string }>;
  getModelCapabilities?: (
    providerId: string,
    modelId: string,
  ) => Promise<Model["capabilities"] | null>;
  getStoredModel?: () => { providerID: string; modelID: string };
  processPrompt?: (
    ctx: Context,
    text: string,
    deps: ProcessPromptDeps,
    fileParts?: FilePartInput[],
  ) => Promise<boolean>;
  describeImage?: (
    buffer: Buffer,
    mime?: string,
    question?: string,
  ) => Promise<LocalVisionResult>;
  savePhoto?: (buffer: Buffer, extension?: string) => string;
}

export async function handlePhotoMessage(ctx: Context, deps: PhotoHandlerDeps): Promise<void> {
  const photos = ctx.message?.photo;
  if (!photos || photos.length === 0) {
    return;
  }

  flushPendingPrompt(ctx.chat!.id);

  const caption = ctx.message.caption || "";
  const largestPhoto = photos[photos.length - 1];
  if (!largestPhoto) {
    return;
  }
  const downloadFile = deps.downloadFile ?? downloadTelegramFile;
  const getCapabilities = deps.getModelCapabilities ?? getModelCapabilities;
  const getStored = deps.getStoredModel ?? getStoredModel;
  const processPrompt = deps.processPrompt ?? processUserPrompt;
  const describeImage = deps.describeImage ?? describeImageWithLocalVision;

  try {
    const storedModel = getStored();
    const capabilities = await getCapabilities(storedModel.providerID, storedModel.modelID);

    if (!supportsInput(capabilities, "image")) {
      // Vision fallback: the active model is text-only. Describe the photo
      // with the LOCAL vision model and send the description as text.
      logger.warn(
        `[Bot] Model ${storedModel.providerID}/${storedModel.modelID} doesn't support image input — using local vision fallback`,
      );
      await ctx.reply(t("bot.photo_vision_describing"));

      let downloadedFile;
      try {
        downloadedFile = await downloadFile(ctx.api, largestPhoto.file_id);
      } catch (err) {
        logger.error("[Bot] Failed to download photo for local vision:", err);
        await ctx.reply(t("bot.photo_download_error"));
        return;
      }

      const visionResult = await describeImage(downloadedFile.buffer, "image/jpeg");
      if (!visionResult.ok) {
        logger.error(`[Bot] Local vision fallback failed: ${visionResult.error}`);
        // Degrade gracefully: without a vision description we still forward
        // the caption as text (pre-fallback behavior) instead of dropping
        // the user's message entirely.
        await ctx.reply(t("bot.photo_vision_fallback_error"));
        if (caption.trim().length > 0) {
          await processPrompt(ctx, caption, deps);
        }
        return;
      }

      // Save the original photo so the opencode agent can inspect it itself
      // (e.g. with the describe_image tool) while working on the prompt.
      const savePhoto = deps.savePhoto ?? savePhotoForAgent;
      const photoPath = savePhoto(downloadedFile.buffer);
      logger.info(`[Bot] Photo saved for agent inspection: ${photoPath}`);

      const visionNote = `[Local vision description of the attached photo]\n${visionResult.description}\n\n[The original photo is available on disk at: ${photoPath} — use the describe_image tool on that path whenever you need visual details (colors, layout, exact text).]`;
      const combinedText = caption ? `${caption}\n\n${visionNote}` : visionNote;
      logger.info(
        `[Bot] Photo described by local vision (${visionResult.description.length} chars), sending as text`,
      );
      await processPrompt(ctx, combinedText, deps);
      return;
    }

    await ctx.reply(t("bot.photo_downloading"));
    const downloadedFile = await downloadFile(ctx.api, largestPhoto.file_id);
    const filePart: FilePartInput = {
      type: "file",
      mime: "image/jpeg",
      filename: "photo.jpg",
      url: toDataUri(downloadedFile.buffer, "image/jpeg"),
    };

    logger.info(`[Bot] Sending photo (${downloadedFile.buffer.length} bytes) with prompt`);
    await processPrompt(ctx, caption, deps, [filePart]);
  } catch (err) {
    logger.error("[Bot] Error handling photo message:", err);
    await ctx.reply(t("bot.photo_download_error"));
  }
}
