import { t } from "../../i18n/index.js";
import { buildQuotedNotification } from "./quoted-notification.js";

const EXTERNAL_USER_INPUT_MAX_DISPLAY_LENGTH = 2000;

export interface ExternalUserInputNotification {
  text: string;
  rawFallbackText: string;
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

export function buildExternalUserInputNotification(text: string): ExternalUserInputNotification | null {
  const normalizedText = normalizeExternalUserInputText(text);
  if (!normalizedText) {
    return null;
  }

  const displayText = truncateExternalUserInputText(normalizedText);
  const title = `👤 ${t("bot.external_user_input")}`;
  return buildQuotedNotification(title, displayText);
}
