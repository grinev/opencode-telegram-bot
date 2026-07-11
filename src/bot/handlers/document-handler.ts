import type { Context } from "grammy";
import { config } from "../../config.js";
import { processUserPrompt, type ProcessPromptDeps } from "./prompt.js";
import {
  downloadTelegramFile,
  toDataUri,
  isTextMimeType,
  isFileSizeAllowed,
} from "../../app/services/file-download-service.js";
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

    if (mimeType === "application/pdf") {
      const storedModel = getStored();
      const capabilities = await getCapabilities(storedModel.providerID, storedModel.modelID);

      if (!supportsInput(capabilities, "pdf")) {
        logger.warn(
          `[Document] Model ${storedModel.providerID}/${storedModel.modelID} doesn't support PDF input`,
        );
        await ctx.reply(t("bot.model_no_pdf"));

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
        `[Document] Sending PDF (${downloadedFile.buffer.length} bytes, ${filename}) with prompt`,
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
