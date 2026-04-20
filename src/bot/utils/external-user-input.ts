import type { Api, RawApi } from "grammy";
import { t } from "../../i18n/index.js";
import { escapePlainTextForTelegramMarkdownV2 } from "../../summary/formatter.js";
import { sendBotText } from "./telegram-text.js";

type SendMessageApi = Pick<Api<RawApi>, "sendMessage">;

interface ExternalUserInputNotification {
  text: string;
  rawFallbackText: string;
}

interface DeliverExternalUserInputParams {
  api: SendMessageApi;
  chatId: number;
  currentSessionId: string | null;
  sessionId: string;
  text: string;
  consumeSuppressedInput: (sessionId: string, text: string) => boolean;
}

function normalizeExternalUserInputText(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

function buildQuotedPlainText(text: string): string {
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? `> ${line}` : ">"))
    .join("\n");
}

function buildQuotedMarkdownText(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      line.length > 0 ? `> ${escapePlainTextForTelegramMarkdownV2(line)}` : ">",
    )
    .join("\n");
}

export function buildExternalUserInputNotification(text: string): ExternalUserInputNotification | null {
  const normalizedText = normalizeExternalUserInputText(text);
  if (!normalizedText) {
    return null;
  }

  const title = `👤 ${t("bot.external_user_input")}`;
  return {
    text: `${escapePlainTextForTelegramMarkdownV2(title)}\n\n${buildQuotedMarkdownText(normalizedText)}`,
    rawFallbackText: `${title}\n\n${buildQuotedPlainText(normalizedText)}`,
  };
}

export async function deliverExternalUserInputNotification({
  api,
  chatId,
  currentSessionId,
  sessionId,
  text,
  consumeSuppressedInput,
}: DeliverExternalUserInputParams): Promise<boolean> {
  const notification = buildExternalUserInputNotification(text);
  if (!notification || currentSessionId !== sessionId) {
    return false;
  }

  if (consumeSuppressedInput(sessionId, text)) {
    return false;
  }

  await sendBotText({
    api,
    chatId,
    text: notification.text,
    rawFallbackText: notification.rawFallbackText,
    format: "markdown_v2",
  });

  return true;
}
