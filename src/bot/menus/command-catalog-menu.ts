import { InlineKeyboard } from "grammy";
import type { CommandCatalogItem } from "../../app/services/command-catalog-service.js";
import { t } from "../../i18n/index.js";

export const COMMANDS_CALLBACK_PREFIX = "commands:";
export const COMMANDS_CALLBACK_SELECT_PREFIX = `${COMMANDS_CALLBACK_PREFIX}select:`;
const COMMANDS_CALLBACK_PAGE_PREFIX = `${COMMANDS_CALLBACK_PREFIX}page:`;
export const COMMANDS_CALLBACK_CANCEL = `${COMMANDS_CALLBACK_PREFIX}cancel`;
export const COMMANDS_CALLBACK_EXECUTE = `${COMMANDS_CALLBACK_PREFIX}execute`;

const MAX_INLINE_BUTTON_LABEL_LENGTH = 64;

interface ExecutingCommandMessage {
  text: string;
  entities: Array<{
    type: "code";
    offset: number;
    length: number;
  }>;
}

export interface CommandsPaginationRange {
  page: number;
  totalPages: number;
  startIndex: number;
  endIndex: number;
}

export function formatExecutingCommandMessage(
  commandName: string,
  args: string,
): ExecutingCommandMessage {
  const prefix = t("commands.executing_prefix");
  const commandText = `/${commandName}`;
  const argsSuffix = args ? ` ${args}` : "";
  return {
    text: `${prefix}\n${commandText}${argsSuffix}`,
    entities: [
      {
        type: "code",
        offset: prefix.length + 1,
        length: commandText.length,
      },
    ],
  };
}

export function buildCommandPageCallback(page: number): string {
  return `${COMMANDS_CALLBACK_PAGE_PREFIX}${page}`;
}

export function parseCommandPageCallback(data: string): number | null {
  if (!data.startsWith(COMMANDS_CALLBACK_PAGE_PREFIX)) {
    return null;
  }

  const rawPage = data.slice(COMMANDS_CALLBACK_PAGE_PREFIX.length);
  const page = Number(rawPage);
  if (!Number.isInteger(page) || page < 0) {
    return null;
  }

  return page;
}

export function parseCommandSelectCallback(data: string): number | null {
  if (!data.startsWith(COMMANDS_CALLBACK_SELECT_PREFIX)) {
    return null;
  }

  const rawIndex = data.slice(COMMANDS_CALLBACK_SELECT_PREFIX.length);
  const index = Number(rawIndex);

  if (!Number.isInteger(index) || index < 0) {
    return null;
  }

  return index;
}

export function formatCommandsSelectText(page: number): string {
  if (page === 0) {
    return t("commands.select");
  }

  return t("commands.select_page", { page: page + 1 });
}

function formatCommandButtonLabel(command: CommandCatalogItem): string {
  const description = command.description?.trim() || t("commands.no_description");
  const rawLabel = `/${command.name} - ${description}`;

  if (rawLabel.length <= MAX_INLINE_BUTTON_LABEL_LENGTH) {
    return rawLabel;
  }

  return `${rawLabel.slice(0, MAX_INLINE_BUTTON_LABEL_LENGTH - 3)}...`;
}

export function calculateCommandsPaginationRange(
  totalCommands: number,
  page: number,
  pageSize: number,
): CommandsPaginationRange {
  const safePageSize = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(totalCommands / safePageSize));
  const normalizedPage = Math.min(Math.max(0, page), totalPages - 1);
  const startIndex = normalizedPage * safePageSize;
  const endIndex = Math.min(startIndex + safePageSize, totalCommands);

  return {
    page: normalizedPage,
    totalPages,
    startIndex,
    endIndex,
  };
}

export function buildCommandsListKeyboard(
  commands: CommandCatalogItem[],
  page: number,
  pageSize: number,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const {
    page: normalizedPage,
    totalPages,
    startIndex,
    endIndex,
  } = calculateCommandsPaginationRange(commands.length, page, pageSize);

  commands.slice(startIndex, endIndex).forEach((command, index) => {
    const globalIndex = startIndex + index;
    keyboard
      .text(formatCommandButtonLabel(command), `${COMMANDS_CALLBACK_SELECT_PREFIX}${globalIndex}`)
      .row();
  });

  if (totalPages > 1) {
    if (normalizedPage > 0) {
      keyboard.text(t("commands.button.prev_page"), buildCommandPageCallback(normalizedPage - 1));
    }

    if (normalizedPage < totalPages - 1) {
      keyboard.text(t("commands.button.next_page"), buildCommandPageCallback(normalizedPage + 1));
    }

    keyboard.row();
  }

  keyboard.text(t("commands.button.cancel"), COMMANDS_CALLBACK_CANCEL);
  return keyboard;
}

export function buildCommandsConfirmKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(t("commands.button.execute"), COMMANDS_CALLBACK_EXECUTE)
    .text(t("commands.button.cancel"), COMMANDS_CALLBACK_CANCEL);
}
