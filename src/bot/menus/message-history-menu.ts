import { InlineKeyboard } from "grammy";
import type { UserMessageItem } from "../../app/services/message-history-service.js";
import { t } from "../../i18n/index.js";

export const MESSAGES_CALLBACK_PREFIX = "messages:";
export const MESSAGES_CALLBACK_SELECT_PREFIX = `${MESSAGES_CALLBACK_PREFIX}select:`;
const MESSAGES_CALLBACK_PAGE_PREFIX = `${MESSAGES_CALLBACK_PREFIX}page:`;
export const MESSAGES_CALLBACK_REVERT = `${MESSAGES_CALLBACK_PREFIX}revert`;
export const MESSAGES_CALLBACK_FORK = `${MESSAGES_CALLBACK_PREFIX}fork`;
export const MESSAGES_CALLBACK_BACK = `${MESSAGES_CALLBACK_PREFIX}back`;
export const MESSAGES_CALLBACK_CANCEL = `${MESSAGES_CALLBACK_PREFIX}cancel`;
export const TELEGRAM_MESSAGE_LIMIT = 4096;

const MAX_INLINE_BUTTON_LABEL_LENGTH = 64;

export interface MessagesPaginationRange {
  page: number;
  totalPages: number;
  startIndex: number;
  endIndex: number;
}

export function truncateMessageHistoryText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function normalizeButtonText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function formatMessageTime(created: number): string {
  const date = new Date(created);
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

function formatMessageButtonLabel(message: UserMessageItem): string {
  const prefix = `[${formatMessageTime(message.created)}] `;
  const text = normalizeButtonText(message.text);
  return `${prefix}${truncateMessageHistoryText(text, MAX_INLINE_BUTTON_LABEL_LENGTH - prefix.length)}`;
}

export function formatMessagesSelectText(page: number): string {
  if (page === 0) {
    return t("messages.select");
  }

  return t("messages.select_page", { page: page + 1 });
}

export function formatMessageDetailText(message: UserMessageItem): string {
  const prefix = `[${formatMessageTime(message.created)}]\n\n`;
  return truncateMessageHistoryText(`${prefix}${message.text}`, TELEGRAM_MESSAGE_LIMIT);
}

export function buildMessagePageCallback(page: number): string {
  return `${MESSAGES_CALLBACK_PAGE_PREFIX}${page}`;
}

export function parseMessagePageCallback(data: string): number | null {
  if (!data.startsWith(MESSAGES_CALLBACK_PAGE_PREFIX)) {
    return null;
  }

  const rawPage = data.slice(MESSAGES_CALLBACK_PAGE_PREFIX.length);
  const page = Number(rawPage);
  if (!Number.isInteger(page) || page < 0) {
    return null;
  }

  return page;
}

export function parseMessageSelectCallback(data: string): number | null {
  if (!data.startsWith(MESSAGES_CALLBACK_SELECT_PREFIX)) {
    return null;
  }

  const rawIndex = data.slice(MESSAGES_CALLBACK_SELECT_PREFIX.length);
  const index = Number(rawIndex);

  if (!Number.isInteger(index) || index < 0) {
    return null;
  }

  return index;
}

export function calculateMessagesPaginationRange(
  totalMessages: number,
  page: number,
  pageSize: number,
): MessagesPaginationRange {
  const safePageSize = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(totalMessages / safePageSize));
  const normalizedPage = Math.min(Math.max(0, page), totalPages - 1);
  const startIndex = normalizedPage * safePageSize;
  const endIndex = Math.min(startIndex + safePageSize, totalMessages);

  return {
    page: normalizedPage,
    totalPages,
    startIndex,
    endIndex,
  };
}

export function buildMessagesListKeyboard(
  messages: UserMessageItem[],
  page: number,
  pageSize: number,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const {
    page: normalizedPage,
    totalPages,
    startIndex,
    endIndex,
  } = calculateMessagesPaginationRange(messages.length, page, pageSize);

  messages.slice(startIndex, endIndex).forEach((message, index) => {
    const globalIndex = startIndex + index;
    keyboard.text(formatMessageButtonLabel(message), `${MESSAGES_CALLBACK_SELECT_PREFIX}${globalIndex}`).row();
  });

  if (totalPages > 1) {
    if (normalizedPage > 0) {
      keyboard.text(t("messages.button.prev_page"), buildMessagePageCallback(normalizedPage - 1));
    }

    if (normalizedPage < totalPages - 1) {
      keyboard.text(t("messages.button.next_page"), buildMessagePageCallback(normalizedPage + 1));
    }

    keyboard.row();
  }

  keyboard.text(t("messages.button.cancel"), MESSAGES_CALLBACK_CANCEL);
  return keyboard;
}

export function buildMessageDetailKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(t("messages.button.revert"), MESSAGES_CALLBACK_REVERT)
    .row()
    .text(t("messages.button.fork"), MESSAGES_CALLBACK_FORK)
    .row()
    .text(t("messages.button.back"), MESSAGES_CALLBACK_BACK)
    .text(t("messages.button.cancel"), MESSAGES_CALLBACK_CANCEL);
}
