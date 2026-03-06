export const BOT_COMMAND = {
  START: "start",
  HELP: "help",
  STATUS: "status",
  NEW: "new",
  STOP: "stop",
  SESSIONS: "sessions",
  PROJECTS: "projects",
  RENAME: "rename",
  COMMANDS: "commands",
  OPENCODE_START: "opencode_start",
  OPENCODE_STOP: "opencode_stop",
} as const;

export type BotCommandName = (typeof BOT_COMMAND)[keyof typeof BOT_COMMAND];

export const DM_ALLOWED_COMMANDS: readonly BotCommandName[] = [
  BOT_COMMAND.START,
  BOT_COMMAND.HELP,
  BOT_COMMAND.STATUS,
  BOT_COMMAND.OPENCODE_START,
  BOT_COMMAND.OPENCODE_STOP,
];
