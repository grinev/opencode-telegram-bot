import type { InteractionKind } from "./types.js";

export const BUSY_ALLOWED_COMMANDS = ["/abort", "/attach", "/status", "/help"] as const;

const BUSY_ALLOWED_COMMAND_SET = new Set<string>(BUSY_ALLOWED_COMMANDS);

export function isBusyAllowedCommand(command?: string): boolean {
  return Boolean(command && BUSY_ALLOWED_COMMAND_SET.has(command));
}

export function allowsBusyInteraction(kind: InteractionKind | undefined): boolean {
  return kind === "question" || kind === "permission";
}
