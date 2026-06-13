import { BOT_COMMANDS } from "../commands/definitions.js";

const KNOWN_COMMANDS = new Set<string>(["start", ...BOT_COMMANDS.map((item) => item.command)]);

export function extractCommandName(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const token = trimmed.split(/\s+/)[0];
  const withoutSlash = token.slice(1);
  if (!withoutSlash) {
    return null;
  }

  const withoutMention = withoutSlash.split("@")[0].toLowerCase();
  if (!withoutMention) {
    return null;
  }

  return withoutMention;
}

export function isKnownCommand(commandName: string): boolean {
  return KNOWN_COMMANDS.has(commandName);
}
