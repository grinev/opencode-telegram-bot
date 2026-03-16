import { InputFile } from "grammy";
import { promises as fs } from "fs";
import * as path from "path";
import type { Api, RawApi } from "grammy";
import {
  editMessageWithMarkdownFallback,
  sendMessageWithMarkdownFallback,
} from "./send-with-markdown-fallback.js";

const TELEGRAM_MESSAGE_MAX_LENGTH = 4096;

type SendMessageApi = Pick<Api<RawApi>, "sendMessage" | "sendDocument">;
type EditMessageApi = Pick<Api<RawApi>, "editMessageText">;

type TelegramSendMessageOptions = Parameters<SendMessageApi["sendMessage"]>[2];
type TelegramEditMessageOptions = Parameters<EditMessageApi["editMessageText"]>[3];

export type TelegramTextFormat = "raw" | "markdown_v2";

interface SendBotTextParams {
  api: SendMessageApi;
  chatId: Parameters<SendMessageApi["sendMessage"]>[0];
  text: string;
  options?: TelegramSendMessageOptions;
  format?: TelegramTextFormat;
}

interface EditBotTextParams {
  api: EditMessageApi;
  chatId: Parameters<EditMessageApi["editMessageText"]>[0];
  messageId: Parameters<EditMessageApi["editMessageText"]>[1];
  text: string;
  options?: TelegramEditMessageOptions;
  format?: TelegramTextFormat;
}

function resolveParseMode(format: TelegramTextFormat | undefined): "MarkdownV2" | undefined {
  if (format === "markdown_v2") {
    return "MarkdownV2";
  }

  return undefined;
}

export async function sendBotText({
  api,
  chatId,
  text,
  options,
  format = "raw",
}: SendBotTextParams): Promise<void> {
  await sendMessageWithMarkdownFallback({
    api,
    chatId,
    text,
    options,
    parseMode: resolveParseMode(format),
  });
}

export async function sendBotTextWithFileFallback({
  api,
  chatId,
  text,
  options,
  format = "raw",
}: SendBotTextParams): Promise<void> {
  // Si el mensaje cabe en un solo mensaje de Telegram, enviar normal
  if (text.length <= TELEGRAM_MESSAGE_MAX_LENGTH) {
    return sendBotText({ api, chatId, text, options, format });
  }

  // Mensaje de advertencia indicando que el contenido se envía como archivo
  await api.sendMessage(
    chatId,
    "⚠️ El mensaje es muy largo y se ha convertido en archivo.",
    { disable_notification: options?.disable_notification }
  );

  // Crear archivo temporal
  const tempDir = path.join(process.cwd(), ".tmp");
  await fs.mkdir(tempDir, { recursive: true });

  const filename = `opencode_output_${Date.now()}.txt`;
  const tempFilePath = path.join(tempDir, filename);

  await fs.writeFile(tempFilePath, text, "utf-8");

  try {
    await api.sendDocument(chatId, new InputFile(tempFilePath), {
      caption: `Respuesta de OpenCode (${text.length} caracteres)`,
      disable_notification: options?.disable_notification,
    });
  } finally {
    // IMPORTANTE: Borrar archivo después de enviar
    await fs.unlink(tempFilePath).catch(() => {});
  }
}

export async function editBotText({
  api,
  chatId,
  messageId,
  text,
  options,
  format = "raw",
}: EditBotTextParams): Promise<void> {
  await editMessageWithMarkdownFallback({
    api,
    chatId,
    messageId,
    text,
    options,
    parseMode: resolveParseMode(format),
  });
}
