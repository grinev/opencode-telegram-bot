import type { I18nKey } from "../../i18n/en.js";
import { t } from "../../i18n/index.js";
import { BOT_COMMAND } from "./constants.js";

/**
 * Centralized bot commands definitions
 * Used for both Telegram API setMyCommands and command handler registration
 */

export interface BotCommandDefinition {
  command: string;
  description: string;
}

interface BotCommandI18nDefinition {
  command: string;
  descriptionKey: I18nKey;
}

/**
 * List of all bot commands
 * Update this array when adding new commands
 */
const COMMAND_DEFINITIONS: BotCommandI18nDefinition[] = [
  { command: BOT_COMMAND.STATUS, descriptionKey: "cmd.description.status" },
  { command: BOT_COMMAND.NEW, descriptionKey: "cmd.description.new" },
  { command: BOT_COMMAND.STOP, descriptionKey: "cmd.description.stop" },
  { command: BOT_COMMAND.SESSIONS, descriptionKey: "cmd.description.sessions" },
  { command: BOT_COMMAND.PROJECTS, descriptionKey: "cmd.description.projects" },
  { command: BOT_COMMAND.RENAME, descriptionKey: "cmd.description.rename" },
  { command: BOT_COMMAND.COMMANDS, descriptionKey: "cmd.description.commands" },
  { command: BOT_COMMAND.OPENCODE_START, descriptionKey: "cmd.description.opencode_start" },
  { command: BOT_COMMAND.OPENCODE_STOP, descriptionKey: "cmd.description.opencode_stop" },
  { command: BOT_COMMAND.HELP, descriptionKey: "cmd.description.help" },
];

export function getLocalizedBotCommands(): BotCommandDefinition[] {
  return COMMAND_DEFINITIONS.map(({ command, descriptionKey }) => ({
    command,
    description: t(descriptionKey),
  }));
}

export const BOT_COMMANDS: BotCommandDefinition[] = getLocalizedBotCommands();
