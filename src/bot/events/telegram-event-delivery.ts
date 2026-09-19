import { promises as fs } from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { InputFile, type Bot, type Context } from "grammy";
import type { CodeFileData } from "../../app/formatters/summary-formatter.js";
import { logger } from "../../utils/logger.js";
import {
  completeDraftPart,
  editRenderedBotPart,
  getTelegramRenderedPartSignature,
  sendDraftBotPart,
  sendRenderedBotPart,
} from "../messages/telegram-text.js";
import type { TelegramRenderedPart } from "../render/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMP_DIR = path.join(__dirname, "..", "..", ".tmp");

type TelegramApi = Bot<Context>["api"];
type SendMessageOptions = Parameters<TelegramApi["sendMessage"]>[2];
type SendDocumentOptions = Parameters<TelegramApi["sendDocument"]>[2];
type RenderedSendOptions = Parameters<typeof sendRenderedBotPart>[0]["options"];
type RenderedEditOptions = Parameters<typeof editRenderedBotPart>[0]["options"];
type DraftCompleteOptions = Parameters<typeof completeDraftPart>[0]["options"];

/** Where a session's messages go. */
export interface TelegramDestination {
  api: TelegramApi;
  chatId: number;
}

/**
 * Decides, per session, where its messages go and whether it is the session
 * the user follows. The two answers are independent on purpose.
 */
export interface SessionTargetPolicy {
  getDestination(sessionId: string): TelegramDestination | null;
  isForegroundSession(sessionId: string): boolean;
}

function getLowerCaseErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
}

function isMessageNotModifiedError(error: unknown): boolean {
  return getLowerCaseErrorMessage(error).includes("message is not modified");
}

function isMessageToDeleteMissingError(error: unknown): boolean {
  const errorMessage = getLowerCaseErrorMessage(error);
  return (
    errorMessage.includes("message to delete not found") ||
    errorMessage.includes("message identifier is not specified")
  );
}

/**
 * Telegram primitives for the event bridge. Every call names its destination;
 * only "not modified" edits and already-missing deletes are tolerated, anything
 * else (a 429 included) reaches the caller so the streamers can retry.
 */
export class TelegramEventDelivery {
  private nextDraftId = 1;

  async sendText(
    destination: TelegramDestination,
    text: string,
    options?: SendMessageOptions,
  ): Promise<number> {
    const sentMessage = options
      ? await destination.api.sendMessage(destination.chatId, text, options)
      : await destination.api.sendMessage(destination.chatId, text);
    return sentMessage.message_id;
  }

  async editText(destination: TelegramDestination, messageId: number, text: string): Promise<void> {
    try {
      await destination.api.editMessageText(destination.chatId, messageId, text);
    } catch (error) {
      if (isMessageNotModifiedError(error)) {
        return;
      }

      throw error;
    }
  }

  async deleteText(destination: TelegramDestination, messageId: number): Promise<void> {
    await destination.api.deleteMessage(destination.chatId, messageId).catch((error) => {
      if (isMessageToDeleteMissingError(error)) {
        return;
      }

      throw error;
    });
  }

  async sendDocument(
    destination: TelegramDestination,
    fileData: CodeFileData,
    options?: SendDocumentOptions,
  ): Promise<void> {
    const tempFilePath = path.join(TEMP_DIR, fileData.filename);

    try {
      logger.debug(
        `[Bot] Sending code file: ${fileData.filename} (${fileData.buffer.length} bytes)`,
      );

      await fs.mkdir(TEMP_DIR, { recursive: true });
      await fs.writeFile(tempFilePath, fileData.buffer);

      await destination.api.sendDocument(destination.chatId, new InputFile(tempFilePath), {
        caption: fileData.caption,
        ...options,
      });
    } finally {
      await fs.unlink(tempFilePath).catch(() => {});
    }
  }

  sendRenderedPart(
    destination: TelegramDestination,
    part: TelegramRenderedPart,
    options?: RenderedSendOptions,
    allowPlainFallback?: boolean,
  ) {
    return sendRenderedBotPart({
      api: destination.api,
      chatId: destination.chatId,
      part,
      options,
      ...(allowPlainFallback === undefined ? {} : { allowPlainFallback }),
    });
  }

  async editRenderedPart(
    destination: TelegramDestination,
    messageId: number,
    part: TelegramRenderedPart,
    options?: RenderedEditOptions,
  ) {
    try {
      return await editRenderedBotPart({
        api: destination.api,
        chatId: destination.chatId,
        messageId,
        part,
        options,
        allowPlainFallback: false,
      });
    } catch (error) {
      if (isMessageNotModifiedError(error)) {
        return { deliveredSignature: getTelegramRenderedPartSignature(part) };
      }

      throw error;
    }
  }

  /** Starts a new draft; its id is the stream's message id from then on. */
  async sendDraftPart(destination: TelegramDestination, part: TelegramRenderedPart) {
    const draftId = this.nextDraftId;
    this.nextDraftId += 1;
    const result = await this.editDraftPart(destination, draftId, part);
    return { messageId: draftId, deliveredSignature: result.deliveredSignature };
  }

  editDraftPart(destination: TelegramDestination, draftId: number, part: TelegramRenderedPart) {
    return sendDraftBotPart({
      api: destination.api,
      chatId: destination.chatId,
      draftId,
      part,
    });
  }

  completeDraftPart(
    destination: TelegramDestination,
    part: TelegramRenderedPart,
    options?: DraftCompleteOptions,
  ) {
    return completeDraftPart({
      api: destination.api,
      chatId: destination.chatId,
      part,
      options,
    });
  }

  resetDraftIds(): void {
    this.nextDraftId = 1;
  }
}
