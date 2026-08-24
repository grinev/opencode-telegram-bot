import type { Context } from "grammy";
import { config } from "../../config.js";
import { processUserPrompt, type ProcessPromptDeps } from "./prompt.js";
import {
  downloadTelegramFile,
  toDataUri,
  isTextMimeType,
  isFileSizeAllowed,
} from "../../app/services/file-download-service.js";
import { isDocExtractorConfigured, extractDocument } from "../../app/services/document-extractor-service.js";
import { getModelCapabilities, supportsInput } from "../../app/services/model-capabilities-service.js";
import { getStoredModel } from "../../app/services/model-selection-service.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import type { FilePartInput, Model } from "@opencode-ai/sdk/v2";
import { flushPendingPrompt } from "./message-merger.js";

export interface DocumentHandlerDeps extends ProcessPromptDeps {
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
}

export async function handleDocumentMessage(
  ctx: Context,
  deps: DocumentHandlerDeps,
): Promise<void> {
  const downloadFile = deps.downloadFile ?? downloadTelegramFile;
  const getCapabilities = deps.getModelCapabilities ?? getModelCapabilities;
  const getStored = deps.getStoredModel ?? getStoredModel;
  const processPrompt = deps.processPrompt ?? processUserPrompt;

  const doc = ctx.message?.document;
  if (!doc) {
    return;
  }

  flushPendingPrompt(ctx.chat!.id);

  const caption = ctx.message.caption || "";
  const mimeType = doc.mime_type || "";
  const filename = doc.file_name || "document";

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
      const downloadedFile = await downloadFile(ctx.api, doc.file_id);

      const textContent = downloadedFile.buffer.toString("utf-8");

      const promptWithFile = `--- Content of ${filename} ---\n${textContent}\n--- End of file ---\n\n${caption}`;

      logger.info(
        `[Document] Sending text file (${downloadedFile.buffer.length} bytes, ${filename}) as prompt`,
      );

      await processPrompt(ctx, promptWithFile, deps);
      return;
    }

    if (mimeType.startsWith("image/")) {
      const storedModel = getStored();
      const capabilities = await getCapabilities(storedModel.providerID, storedModel.modelID);

      if (!supportsInput(capabilities, "image")) {
        logger.warn(
          `[Document] Model ${storedModel.providerID}/${storedModel.modelID} doesn't support image input`,
        );
        await ctx.reply(t("bot.photo_model_no_image"));

        if (caption.trim().length > 0) {
          await processPrompt(ctx, caption, deps);
        }
        return;
      }

      await ctx.reply(t("bot.file_downloading"));
      const downloadedFile = await downloadFile(ctx.api, doc.file_id);

      const dataUri = toDataUri(downloadedFile.buffer, mimeType);

      const filePart: FilePartInput = {
        type: "file",
        mime: mimeType,
        filename: filename,
        url: dataUri,
      };

      logger.info(
        `[Document] Sending image (${downloadedFile.buffer.length} bytes, ${filename}, ${mimeType}) with prompt`,
      );

      await processPrompt(ctx, caption, deps, [filePart]);
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

    // Image files: route to the model as image parts. Two delivery shapes exist —
    // Telegram sets mime_type="image/jpeg" for some clients, but iOS "Send as File"
    // (the highest-quality path) delivers application/octet-stream with only the
    // filename extension to go on. Trust the extension as the fallback signal.
    const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
    const looksLikeImage =
      (typeof mimeType === "string" && mimeType.startsWith("image/")) ||
      IMAGE_EXTENSIONS.some((ext) => filename.toLowerCase().endsWith(ext));

    if (looksLikeImage) {
      const storedModel = getStored();
      const capabilities = await getCapabilities(storedModel.providerID, storedModel.modelID);
      if (!supportsInput(capabilities, "image")) {
        logger.warn(
          `[Document] Model doesn't support image input (${storedModel.providerID}/${storedModel.modelID})`,
        );
        await ctx.reply(t("bot.photo_model_no_image"));
        if (caption.trim().length > 0) {
          await processPrompt(ctx, caption, deps);
        }
        return;
      }
      await ctx.reply(t("bot.file_downloading"));
      const downloadedFile = await downloadFile(ctx.api, doc.file_id);
      const effectiveMime = mimeType.startsWith("image/") ? mimeType : "image/jpeg";
      const filePart = {
        type: "file" as const,
        mime: effectiveMime,
        filename: filename,
        url: toDataUri(downloadedFile.buffer, effectiveMime),
      };
      logger.info(
        `[Document] Sending image document (${downloadedFile.buffer.length} bytes, ${filename}, ${mimeType})`,
      );
      await processPrompt(ctx, caption, deps, [filePart]);
      return;
    }

    if (DOCUMENT_MIME_TYPES.includes(mimeType)) {
      const storedModel = getStored();
      const capabilities = await getCapabilities(storedModel.providerID, storedModel.modelID);

      if (!supportsInput(capabilities, "pdf")) {
        if (isDocExtractorConfigured()) {
          logger.warn(
            `[Document] Model doesn't support PDF input, delegating document to DOC_EXTRACTOR_URL`,
          );
          await ctx.reply(t("bot.file_downloading"));
          const downloadedFile = await downloadFile(ctx.api, doc.file_id);

          try {
            const result = await extractDocument(downloadedFile.buffer, mimeType, filename);
            const promptWithFile = `--- Content of ${filename} ---\n${result.text}\n--- End of file ---\n\n${caption}`;
            logger.info(
              `[Document] Sending extracted document text from ${filename} (${result.text.length} chars) as prompt`,
            );
            await processPrompt(ctx, promptWithFile, deps);
          } catch (extractErr) {
            const errMsg = extractErr instanceof Error ? extractErr.message : String(extractErr);
            logger.error(`[Document] Document extraction failed: ${errMsg}`);
            await ctx.reply(t("bot.document_extraction_error"));
            if (caption.trim().length > 0) {
              await processPrompt(ctx, caption, deps);
            }
          }
        } else {
          logger.warn(
            `[Document] Model doesn't support PDF input and DOC_EXTRACTOR_URL is not configured`,
          );
          await ctx.reply(t("bot.model_no_pdf"));
          if (caption.trim().length > 0) {
            await processPrompt(ctx, caption, deps);
          }
        }
        return;
      }

      await ctx.reply(t("bot.file_downloading"));
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

      await processPrompt(ctx, caption, deps, [filePart]);
      return;
    }

    logger.warn(`[Document] Unsupported document MIME type: ${mimeType}, filename=${filename}`);
    await ctx.reply(t("bot.file_type_unsupported"));
  } catch (err) {
    logger.error("[Document] Error handling document message:", err);
    await ctx.reply(t("bot.file_download_error"));
  }
}
