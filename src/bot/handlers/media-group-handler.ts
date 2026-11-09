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
  MAX_FILE_SIZE_BYTES,
  toDataUri,
} from "../../app/services/file-download-service.js";
import {
  buildLocalFileSection,
  saveTelegramFile,
  type StoredFile,
} from "../../app/services/file-inbox-service.js";
import { processUserPrompt, type ProcessPromptDeps } from "./prompt.js";
import type { ArrivalTicket } from "../../app/managers/prompt-handover-manager.js";
import { createIncomingPrompt, type IncomingPrompt } from "../../app/types/prompt.js";
import { flushPendingPrompt } from "./message-merger.js";
import { handleUnsupportedMessages } from "./unsupported-message-handler.js";
import {
  rejectQueuedMediaBeforePreparation,
  takeArrivalTicket,
  tryEnqueuePromptIfBusy,
} from "./prompt-queue-dispatch.js";

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
      fileSize?: number | undefined;
    }
  | {
      kind: "text";
      ctx: Context;
      fileId: string;
      filename: string;
    }
  | {
      /** A document the model cannot ingest: saved locally and passed by path. */
      kind: "stored";
      ctx: Context;
      fileId: string;
      filename: string;
      fileSize?: number | undefined;
    };

interface MediaGroupBatch {
  /** Taken with the first item, before the album is prepared. */
  ticket: ArrivalTicket | undefined;
  timer: ReturnType<typeof setTimeout>;
  items: PendingMediaGroupItem[];
}

interface ValidatedMediaGroup {
  items: ValidMediaGroupItem[];
}

interface MediaGroupValidationError {
  reason: string;
}

/** A locally stored album item could not be written to the inbox directory. */
class MediaGroupSaveError extends Error {
  constructor(cause: unknown) {
    super("Failed to save a media group file locally", { cause });
    this.name = "MediaGroupSaveError";
  }
}

export interface MediaGroupHandlerDeps extends ProcessPromptDeps {
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

    flushPendingPrompt(chatId);

    const key = this.getBatchKey(chatId, mediaGroupId);
    const existingBatch = this.batches.get(key);

    if (existingBatch) {
      clearTimeout(existingBatch.timer);
      existingBatch.items.push(item);
      existingBatch.timer = this.createFlushTimer(key);
      return;
    }

    this.batches.set(key, {
      ticket: takeArrivalTicket(),
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
      const unsupportedContexts = items
        .filter((item) => item.kind === "unsupported")
        .map((item) => item.ctx);
      if (unsupportedContexts.length > 0) {
        await handleUnsupportedMessages(unsupportedContexts);
        return;
      }

      const validationResult = await this.validateItems(items);
      if ("reason" in validationResult) {
        logger.warn(
          `[MediaGroup] Rejecting media group: key=${key}, reason=${validationResult.reason}`,
        );
        await replyCtx.reply(t("bot.media_group_not_processed"));
        return;
      }

      // Only media held in the bot's memory counts: text becomes prompt text and
      // locally stored documents are already on disk.
      const mediaBytes = validationResult.items.reduce<number | undefined>((total, item) => {
        if (total === undefined || item.kind !== "file") {
          return total;
        }
        return item.fileSize === undefined ? undefined : total + item.fileSize;
      }, 0);
      if (await rejectQueuedMediaBeforePreparation(replyCtx, mediaBytes)) {
        return;
      }
      await replyCtx.reply(t("bot.files_downloading"));

      const { promptText, fileParts } = await this.preparePrompt(validationResult.items, items);
      const processPrompt = this.deps.processPrompt ?? processUserPrompt;

      logger.info(
        `[MediaGroup] Sending media group as one prompt: key=${key}, files=${fileParts.length}, textLength=${promptText.length}`,
      );

      const captions = items
        .map((item) => item.caption.trim())
        .filter((caption) => caption.length > 0);
      if (
        await tryEnqueuePromptIfBusy(
          replyCtx,
          {
            ...createIncomingPrompt(promptText, { fileParts }),
            displayText: captions.join(" / ") || `[Album: ${items.length} files]`,
            fileParts,
            ...(mediaBytes === undefined ? {} : { mediaBytes }),
          },
          batch.ticket,
        )
      ) {
        return;
      }
      await processPrompt(replyCtx, createIncomingPrompt(promptText, { fileParts }), this.deps);
    } catch (err) {
      if (err instanceof MediaGroupSaveError) {
        logger.error(`[MediaGroup] Failed to save an album file locally: key=${key}`, err);
        await replyCtx.reply(t("bot.file_save_error"));
        return;
      }
      logger.error(`[MediaGroup] Failed to process media group: key=${key}`, err);
      await replyCtx.reply(t("bot.media_group_download_error"));
    }
  }

  private async validateItems(
    items: PendingMediaGroupItem[],
  ): Promise<ValidatedMediaGroup | MediaGroupValidationError> {
    const storedModel = (this.deps.getStoredModel ?? getStoredModel)();
    let validItems: ValidMediaGroupItem[] = [];
    let needsImageSupport = false;
    let needsPdfSupport = false;

    for (const item of items) {
      if (item.kind === "unsupported") {
        return { reason: "unsupported_media_kind" };
      }

      if (item.kind === "photo") {
        needsImageSupport = true;
        const largestPhoto = item.photos[item.photos.length - 1];
        if (!largestPhoto) {
          return { reason: "unsupported_media_kind" };
        }
        validItems.push({
          kind: "file",
          ctx: item.ctx,
          messageId: item.messageId,
          fileId: largestPhoto.file_id,
          mime: "image/jpeg",
          filename: `photo-${item.messageId}.jpg`,
          fileSize: largestPhoto.file_size,
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
          fileSize: document.file_size,
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
          fileSize: document.file_size,
        });
        continue;
      }

      if (document.file_size && document.file_size > MAX_FILE_SIZE_BYTES) {
        return { reason: `document_too_large:${mimeType || "unknown"}` };
      }

      // Nothing in the album can be handed to the model natively: save the
      // original bytes so the agent can inspect them by path.
      validItems.push({
        kind: "stored",
        ctx: item.ctx,
        fileId: document.file_id,
        filename,
        fileSize: document.file_size,
      });
    }

    if (needsImageSupport || needsPdfSupport) {
      const getCapabilities = this.deps.getModelCapabilities ?? getModelCapabilities;
      const capabilities = await getCapabilities(storedModel.providerID, storedModel.modelID);

      if (needsImageSupport && !supportsInput(capabilities, "image")) {
        return { reason: `model_no_image:${storedModel.providerID}/${storedModel.modelID}` };
      }

      if (needsPdfSupport && !supportsInput(capabilities, "pdf")) {
        const converted: ValidMediaGroupItem[] = [];
        for (const item of validItems) {
          if (item.kind === "file" && item.mime === "application/pdf") {
            if (item.fileSize && item.fileSize > MAX_FILE_SIZE_BYTES) {
              return { reason: "document_too_large:application/pdf" };
            }
            converted.push({
              kind: "stored",
              ctx: item.ctx,
              fileId: item.fileId,
              filename: item.filename,
              fileSize: item.fileSize,
            });
            continue;
          }
          converted.push(item);
        }
        validItems = converted;
      }
    }

    return { items: validItems };
  }

  private async preparePrompt(
    validItems: ValidMediaGroupItem[],
    originalItems: PendingMediaGroupItem[],
  ): Promise<{ promptText: string; fileParts: FilePartInput[] }> {
    const downloadFile = this.deps.downloadFile ?? downloadTelegramFile;
    const saveFile = this.deps.saveFile ?? saveTelegramFile;
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

      if (item.kind === "stored") {
        let stored: StoredFile;
        try {
          stored = await saveFile(downloadedFile.buffer, item.filename);
        } catch (err) {
          logger.error(`[MediaGroup] Failed to save ${item.filename} locally:`, err);
          throw new MediaGroupSaveError(err);
        }
        logger.info(
          `[MediaGroup] Saved ${item.filename} locally for the agent: ${stored.filePath}`,
        );
        textSections.push(buildLocalFileSection(stored));
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
