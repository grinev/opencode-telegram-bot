import path from "node:path";
import type { Context } from "grammy";
import { config } from "../../config.js";
import { processUserPrompt, type ProcessPromptDeps } from "./prompt.js";
import {
  downloadTelegramFile,
  toDataUri,
  isTextMimeType,
  isFileSizeAllowed,
  MAX_FILE_SIZE_BYTES,
} from "../../app/services/file-download-service.js";
import {
  buildLocalFileSection,
  saveTelegramFile,
  type StoredFile,
} from "../../app/services/file-inbox-service.js";
import { isDocExtractorConfigured, extractDocument } from "../../app/services/document-extractor-service.js";
import { getModelCapabilities, supportsInput } from "../../app/services/model-capabilities-service.js";
import { getStoredModel } from "../../app/services/model-selection-service.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import type { FilePartInput, Model } from "@opencode-ai/sdk/v2";
import { flushPendingPrompt } from "./message-merger.js";
import { createIncomingPrompt, type IncomingPrompt } from "../../app/types/prompt.js";
import {
  rejectQueuedMediaBeforePreparation,
  takeArrivalTicket,
  tryEnqueuePromptIfBusy,
} from "./prompt-queue-dispatch.js";

export interface DocumentHandlerDeps extends ProcessPromptDeps {
  downloadFile?: (
    api: Context["api"],
    fileId: string,
  ) => Promise<{ buffer: Buffer; filePath: string }>;
  saveFile?: (buffer: Buffer, filename: string) => Promise<StoredFile>;
  getModelCapabilities?: (
    providerId: string,
    modelId: string,
  ) => Promise<Model["capabilities"] | null>;
  getStoredModel?: () => { providerID: string; modelID: string };
  processPrompt?: (
    ctx: Context,
    input: IncomingPrompt,
    deps: ProcessPromptDeps,
  ) => Promise<boolean>;
}

// iOS "Send as File" delivers images as application/octet-stream, leaving the
// filename extension as the only signal of the real image type.
const GENERIC_MIME_TYPE = "application/octet-stream";

const IMAGE_MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

function resolveImageMimeType(mimeType: string, filename: string): string | null {
  if (mimeType.startsWith("image/")) {
    return mimeType;
  }

  if (mimeType !== GENERIC_MIME_TYPE) {
    return null;
  }

  const extension = path.extname(filename).slice(1).toLowerCase();
  return IMAGE_MIME_TYPES_BY_EXTENSION[extension] ?? null;
}

export async function handleDocumentMessage(
  ctx: Context,
  deps: DocumentHandlerDeps,
): Promise<void> {
  const downloadFile = deps.downloadFile ?? downloadTelegramFile;
  const saveFile = deps.saveFile ?? saveTelegramFile;
  const getCapabilities = deps.getModelCapabilities ?? getModelCapabilities;
  const getStored = deps.getStoredModel ?? getStoredModel;
  const processPrompt = deps.processPrompt ?? processUserPrompt;

  const doc = ctx.message?.document;
  if (!doc) {
    return;
  }

  flushPendingPrompt(ctx.chat!.id);
  const ticket = takeArrivalTicket();

  const caption = ctx.message.caption || "";
  const mimeType = doc.mime_type || "";
  const filename = doc.file_name || "document";
  const submitPrompt = async (
    text: string,
    fileParts: FilePartInput[] = [],
    mediaBytes: number | undefined = 0,
  ): Promise<void> => {
    const input = createIncomingPrompt(text, { fileParts });
    if (
      await tryEnqueuePromptIfBusy(
        ctx,
        {
          ...input,
          displayText: caption.trim() || filename,
          mediaBytes,
        },
        ticket,
      )
    ) {
      return;
    }
    await processPrompt(ctx, input, deps);
  };

  /**
   * Stores a document the model cannot ingest and hands its local path to the
   * agent. The file is downloaded as-is: no parsing or conversion happens here.
   */
  const saveAndSubmit = async (downloaded?: { buffer: Buffer }): Promise<void> => {
    if (doc.file_size && doc.file_size > MAX_FILE_SIZE_BYTES) {
      const maxSizeMb = String(MAX_FILE_SIZE_BYTES / (1024 * 1024));
      logger.warn(
        `[Document] File exceeds the Telegram Bot API download limit: ${filename} (${doc.file_size} bytes)`,
      );
      await ctx.reply(t("bot.file_too_large", { maxSizeMb }));
      return;
    }

    let buffer: Buffer;
    if (downloaded) {
      buffer = downloaded.buffer;
    } else {
      await ctx.reply(t("bot.file_downloading"));
      if (await rejectQueuedMediaBeforePreparation(ctx, 0)) {
        return;
      }
      buffer = (await downloadFile(ctx.api, doc.file_id)).buffer;
    }

    let stored: StoredFile;
    try {
      stored = await saveFile(buffer, filename);
    } catch (err) {
      logger.error(`[Document] Failed to save ${filename} to local storage:`, err);
      await ctx.reply(t("bot.file_save_error"));
      if (caption.trim().length > 0) {
        await submitPrompt(caption);
      }
      return;
    }

    logger.info(`[Document] Saved ${filename} locally for the agent: ${stored.filePath}`);
    await submitPrompt(`${buildLocalFileSection(stored)}\n\n${caption}`);
  };

  try {
    if (isTextMimeType(mimeType, filename)) {
      if (!isFileSizeAllowed(doc.file_size, config.files.maxFileSizeKb)) {
        logger.warn(
          `[Document] Text file too large: ${filename} (${doc.file_size} bytes > ${config.files.maxFileSizeKb}KB)`,
        );
        await ctx.reply(
          t("bot.text_file_too_large", { maxSizeKb: String(config.files.maxFileSizeKb) }),
        );
        return;
      }

      await ctx.reply(t("bot.file_downloading"));
      if (await rejectQueuedMediaBeforePreparation(ctx, doc.file_size)) {
        return;
      }
      const downloadedFile = await downloadFile(ctx.api, doc.file_id);

      const textContent = downloadedFile.buffer.toString("utf-8");

      const promptWithFile = `--- Content of ${filename} ---\n${textContent}\n--- End of file ---\n\n${caption}`;

      logger.info(
        `[Document] Sending text file (${downloadedFile.buffer.length} bytes, ${filename}) as prompt`,
      );

      await submitPrompt(promptWithFile, [], doc.file_size);
      return;
    }

    const imageMimeType = resolveImageMimeType(mimeType, filename);
    if (imageMimeType) {
      const storedModel = getStored();
      const capabilities = await getCapabilities(storedModel.providerID, storedModel.modelID);

      if (!supportsInput(capabilities, "image")) {
        logger.warn(
          `[Document] Model ${storedModel.providerID}/${storedModel.modelID} doesn't support image input`,
        );
        await ctx.reply(t("bot.photo_model_no_image"));

        if (caption.trim().length > 0) {
          await submitPrompt(caption);
        }
        return;
      }

      await ctx.reply(t("bot.file_downloading"));
      if (await rejectQueuedMediaBeforePreparation(ctx, doc.file_size)) {
        return;
      }
      const downloadedFile = await downloadFile(ctx.api, doc.file_id);

      const dataUri = toDataUri(downloadedFile.buffer, imageMimeType);

      const filePart: FilePartInput = {
        type: "file",
        mime: imageMimeType,
        filename: filename,
        url: dataUri,
      };

      logger.info(
        `[Document] Sending image (${downloadedFile.buffer.length} bytes, ${filename}, ${imageMimeType}) with prompt`,
      );

      await submitPrompt(caption, [filePart], doc.file_size);
      return;
    }

    const DOCUMENT_MIME_TYPES = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.oasis.opendocument.text",
      "application/vnd.oasis.opendocument.presentation",
      "application/vnd.oasis.opendocument.spreadsheet",
      "text/rtf",
    ];

    if (DOCUMENT_MIME_TYPES.includes(mimeType)) {
      const storedModel = getStored();
      const capabilities = await getCapabilities(storedModel.providerID, storedModel.modelID);

      if (!supportsInput(capabilities, "pdf")) {
        if (isDocExtractorConfigured()) {
          logger.warn(
            `[Document] Model doesn't support PDF input, delegating document to DOC_EXTRACTOR_URL`,
          );
          await ctx.reply(t("bot.file_downloading"));
          if (await rejectQueuedMediaBeforePreparation(ctx, doc.file_size)) {
            return;
          }
          const downloadedFile = await downloadFile(ctx.api, doc.file_id);

          try {
            const result = await extractDocument(downloadedFile.buffer, mimeType, filename);
            const promptWithFile = `--- Content of ${filename} ---\n${result.text}\n--- End of file ---\n\n${caption}`;
            logger.info(
              `[Document] Sending extracted document text from ${filename} (${result.text.length} chars) as prompt`,
            );
            await submitPrompt(promptWithFile, [], doc.file_size);
            return;
          } catch (extractErr) {
            const errMsg = extractErr instanceof Error ? extractErr.message : String(extractErr);
            logger.error(`[Document] Document extraction failed: ${errMsg}`);
            await ctx.reply(t("bot.document_extraction_error"));
            logger.warn(
              `[Document] Saving ${filename} locally after extraction failure so the agent can read it`,
            );
            await saveAndSubmit(downloadedFile);
            return;
          }
        }

        logger.warn(
          `[Document] Model doesn't support PDF input and DOC_EXTRACTOR_URL is not configured; saving ${filename} locally`,
        );
        await saveAndSubmit();
        return;
      }

      await ctx.reply(t("bot.file_downloading"));
      if (await rejectQueuedMediaBeforePreparation(ctx, doc.file_size)) {
        return;
      }
      const downloadedFile = await downloadFile(ctx.api, doc.file_id);

      const dataUri = toDataUri(downloadedFile.buffer, mimeType);

      const filePart: FilePartInput = {
        type: "file",
        mime: mimeType,
        filename: filename,
        url: dataUri,
      };

      logger.info(
        `[Document] Sending document (${downloadedFile.buffer.length} bytes, ${filename}, ${mimeType}) with prompt`,
      );

      await submitPrompt(caption, [filePart], doc.file_size);
      return;
    }

    logger.warn(
      `[Document] Unsupported document MIME type: ${mimeType}, filename=${filename}; saving locally`,
    );
    await saveAndSubmit();
  } catch (err) {
    logger.error("[Document] Error handling document message:", err);
    await ctx.reply(t("bot.file_download_error"));
  }
}
