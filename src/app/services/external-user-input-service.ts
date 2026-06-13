import { t } from "../../i18n/index.js";

const EXTERNAL_USER_INPUT_MAX_DISPLAY_LENGTH = 2000;
const MARKDOWN_V2_RESERVED_CHARS = /([_\*\[\]\(\)~`>#+\-=|{}.!\\])/g;

export interface ExternalUserInputNotification {
  text: string;
  rawFallbackText: string;
}

function escapePlainTextForTelegramMarkdownV2(text: string): string {
  return text.replace(MARKDOWN_V2_RESERVED_CHARS, "\\$1");
}

function normalizeExternalUserInputText(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

function truncateExternalUserInputText(text: string): string {
  if (text.length <= EXTERNAL_USER_INPUT_MAX_DISPLAY_LENGTH) {
    return text;
  }

  return `${text.slice(0, EXTERNAL_USER_INPUT_MAX_DISPLAY_LENGTH - 3)}...`;
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

  const displayText = truncateExternalUserInputText(normalizedText);
  const title = `👤 ${t("bot.external_user_input")}`;
  return {
    text: `${escapePlainTextForTelegramMarkdownV2(title)}\n\n${buildQuotedMarkdownText(displayText)}`,
    rawFallbackText: `${title}\n\n${buildQuotedPlainText(displayText)}`,
  };
}
