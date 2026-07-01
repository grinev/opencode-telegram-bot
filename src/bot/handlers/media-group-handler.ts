import type { Context, NextFunction } from "grammy";
import type { FilePartInput, Model } from "@opencode-ai/sdk/v2";
import { config } from "../../config.js";
import { t } from "../../i18n/index.js";
import { getModelCapabilities, supportsInput } from "../../app/services/model-capabilities-service.js";
import { getStoredModel } from "../../app/services/model-selection-service.js";
import { logger } from "../../utils/logger.js";
import {
  downloadTelegramFile,
  isFileSizeAllowed,
  isTextMimeType,
  toDataUri,
} from "../../app/services/file-download-service.js";
import { processUserPrompt, type ProcessPromptDeps } from "./prompt.js";

const DEFAULT_MEDIA_GROUP_DEBOUNCE_MS = 1_000;

type TelegramDocument = NonNullable<NonNullable<Context["message"]>["document"]>;
type TelegramPhoto = NonNullable<NonNullable<Context["message"]>["photo"]>;

type PendingMediaGroupItem = {
  ctx: Context;
  messageId: number;
  caption: string;
} & (
  | {
      kind: "photo";
      photos: TelegramPhoto;
    }
  | {
      kind: "document";
      document: TelegramDocument;
    }
  | {
      kind: "unsupported";
    }
);

type ValidMediaGroupItem =
  | {
      kind: "file";
      ctx: Context;
      messageId: number;
      fileId: string;
      mime: string;
      filename: string;
    }
  | {
      kind: "text";
      ctx: Context;
      fileId: string;
      filename: string;
    };

interface MediaGroupBatch {
  timer: ReturnType<typeof setTimeout>;
  items: PendingMediaGroupItem[];
}

interface ValidatedMediaGroup {
  items: ValidMediaGroupItem[];
}

interface MediaGroupValidationError {
  reason: string;
}

export interface MediaGroupHandlerDeps extends ProcessPromptDeps {
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

export interface MediaGroupHandlerOptions {
  debounceMs?: number;
}

export class MediaGroupAttachmentHandler {
  private readonly deps: MediaGroupHandlerDeps;
  private readonly debounceMs: number;
  private readonly batches = new Map<string, MediaGroupBatch>();

  constructor(deps: MediaGroupHandlerDeps, options: MediaGroupHandlerOptions = {}) {
    this.deps = deps;
    this.debounceMs = options.debounceMs ?? DEFAULT_MEDIA_GROUP_DEBOUNCE_MS;
  }

  async handle(ctx: Context, next: NextFunction): Promise<void> {
    const item = this.createPendingItem(ctx);

    if (!item) {
      await next();
      return;
    }

    const mediaGroupId = ctx.message?.media_group_id;
    const chatId = ctx.chat?.id;
    if (!mediaGroupId || chatId === undefined) {
      await next();
      return;
    }

    const key = this.getBatchKey(chatId, mediaGroupId);
    const existingBatch = this.batches.get(key);

    if (existingBatch) {
      clearTimeout(existingBatch.timer);
      existingBatch.items.push(item);
      existingBatch.timer = this.createFlushTimer(key);
      return;
    }

    this.batches.set(key, {
      items: [item],
      timer: this.createFlushTimer(key),
    });
  }

  async flushAll(): Promise<void> {
    const keys = Array.from(this.batches.keys());
    await Promise.all(keys.map((key) => this.flushBatch(key)));
  }

  private createPendingItem(ctx: Context): PendingMediaGroupItem | null {
    const message = ctx.message;
    const mediaGroupId = message?.media_group_id;

    if (!message || !mediaGroupId || !ctx.chat) {
      return null;
    }

    const baseItem = {
      ctx,
      messageId: message.message_id,
      caption: message.caption || "",
    };

    if (message.photo && message.photo.length > 0) {
      return {
        ...baseItem,
        kind: "photo",
        photos: message.photo,
      };
    }

    if (message.document) {
      return {
        ...baseItem,
        kind: "document",
        document: message.document,
      };
    }

    return {
      ...baseItem,
      kind: "unsupported",
    };
  }

  private getBatchKey(chatId: number | string, mediaGroupId: string): string {
    return `${chatId}:${mediaGroupId}`;
  }

  private createFlushTimer(key: string): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      void this.flushBatch(key);
    }, this.debounceMs);
  }

  private async flushBatch(key: string): Promise<void> {
    const batch = this.batches.get(key);
    if (!batch) {
      return;
    }

    clearTimeout(batch.timer);
    this.batches.delete(key);

    const items = [...batch.items].sort((left, right) => left.messageId - right.messageId);
    const replyCtx = items[0]?.ctx;

    if (!replyCtx) {
      return;
    }

    logger.info(`[MediaGroup] Processing Telegram media group: key=${key}, items=${items.length}`);

    try {
      const validationResult = await this.validateItems(items);
      if ("reason" in validationResult) {
        logger.warn(
          `[MediaGroup] Rejecting media group: key=${key}, reason=${validationResult.reason}`,
        );
        await replyCtx.reply(t("bot.media_group_not_processed"));
        return;
      }

      await replyCtx.reply(t("bot.files_downloading"));

      const { promptText, fileParts } = await this.preparePrompt(validationResult.items, items);
      const processPrompt = this.deps.processPrompt ?? processUserPrompt;

      logger.info(
        `[MediaGroup] Sending media group as one prompt: key=${key}, files=${fileParts.length}, textLength=${promptText.length}`,
      );

      await processPrompt(replyCtx, promptText, this.deps, fileParts);
    } catch (err) {
      logger.error(`[MediaGroup] Failed to process media group: key=${key}`, err);
      await replyCtx.reply(t("bot.media_group_download_error"));
    }
  }

  private async validateItems(
    items: PendingMediaGroupItem[],
  ): Promise<ValidatedMediaGroup | MediaGroupValidationError> {
    const storedModel = (this.deps.getStoredModel ?? getStoredModel)();
    const validItems: ValidMediaGroupItem[] = [];
    let needsImageSupport = false;
    let needsPdfSupport = false;

    for (const item of items) {
      if (item.kind === "unsupported") {
        return { reason: "unsupported_media_kind" };
      }

      if (item.kind === "photo") {
        needsImageSupport = true;
        const largestPhoto = item.photos[item.photos.length - 1];
        validItems.push({
          kind: "file",
          ctx: item.ctx,
          messageId: item.messageId,
          fileId: largestPhoto.file_id,
          mime: "image/jpeg",
          filename: `photo-${item.messageId}.jpg`,
        });
        continue;
      }

      const document = item.document;
      const mimeType = document.mime_type || "";
      const filename = document.file_name || "document";

      if (isTextMimeType(mimeType, filename)) {
        if (!isFileSizeAllowed(document.file_size, config.files.maxFileSizeKb)) {
          return { reason: "text_file_too_large" };
        }

        validItems.push({
          kind: "text",
          ctx: item.ctx,
          fileId: document.file_id,
          filename,
        });
        continue;
      }

      if (mimeType.startsWith("image/")) {
        needsImageSupport = true;
        validItems.push({
          kind: "file",
          ctx: item.ctx,
          messageId: item.messageId,
          fileId: document.file_id,
          mime: mimeType,
          filename,
        });
        continue;
      }

      if (mimeType === "application/pdf") {
        needsPdfSupport = true;
        validItems.push({
          kind: "file",
          ctx: item.ctx,
          messageId: item.messageId,
          fileId: document.file_id,
          mime: mimeType,
          filename,
        });
        continue;
      }

      return { reason: `unsupported_document_mime:${mimeType || "unknown"}` };
    }

    if (needsImageSupport || needsPdfSupport) {
      const getCapabilities = this.deps.getModelCapabilities ?? getModelCapabilities;
      const capabilities = await getCapabilities(storedModel.providerID, storedModel.modelID);

      if (needsImageSupport && !supportsInput(capabilities, "image")) {
        return { reason: `model_no_image:${storedModel.providerID}/${storedModel.modelID}` };
      }

      if (needsPdfSupport && !supportsInput(capabilities, "pdf")) {
        return { reason: `model_no_pdf:${storedModel.providerID}/${storedModel.modelID}` };
      }
    }

    return { items: validItems };
  }

  private async preparePrompt(
    validItems: ValidMediaGroupItem[],
    originalItems: PendingMediaGroupItem[],
  ): Promise<{ promptText: string; fileParts: FilePartInput[] }> {
    const downloadFile = this.deps.downloadFile ?? downloadTelegramFile;
    const textSections: string[] = [];
    const fileParts: FilePartInput[] = [];

    for (const item of validItems) {
      const downloadedFile = await downloadFile(item.ctx.api, item.fileId);

      if (item.kind === "text") {
        const textContent = downloadedFile.buffer.toString("utf-8");
        textSections.push(
          `--- Content of ${item.filename} ---\n${textContent}\n--- End of file ---`,
        );
        continue;
      }

      fileParts.push({
        type: "file",
        mime: item.mime,
        filename: item.filename,
        url: toDataUri(downloadedFile.buffer, item.mime),
      });
    }

    const captions = originalItems
      .map((item) => item.caption.trim())
      .filter((caption) => caption.length > 0);

    return {
      promptText: [...textSections, ...captions].join("\n\n"),
      fileParts,
    };
  }
}

export function createMediaGroupAttachmentMiddleware(
  deps: MediaGroupHandlerDeps,
  options: MediaGroupHandlerOptions = {},
): (ctx: Context, next: NextFunction) => Promise<void> {
  const handler = new MediaGroupAttachmentHandler(deps, options);
  return (ctx, next) => handler.handle(ctx, next);
}
