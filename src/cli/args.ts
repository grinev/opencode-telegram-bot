import type { RuntimeMode } from "../runtime/mode.js";

export type CliCommand = "start" | "status" | "stop" | "config";

const CLI_MESSAGES = {
  unknownCommand: (value: string) => `Unknown command: ${value}`,
  modeRequiresValue: "Option --mode requires a value: sources|installed",
  invalidMode: (value: string) => `Invalid mode value: ${value}. Expected sources|installed`,
  unknownOption: (value: string) => `Unknown option: ${value}`,
  modeOnlyStart: "Option --mode is supported only for the start command",
  daemonOnlyStart: "Option --daemon is supported only for the start command",
} as const;

export interface ParsedCliArgs {
  command: CliCommand;
  mode?: RuntimeMode | undefined;
  daemon: boolean;
  showHelp: boolean;
  error?: string | undefined;
}

const SUPPORTED_COMMANDS: readonly CliCommand[] = ["start", "status", "stop", "config"];

function isCliCommand(value: string): value is CliCommand {
  return SUPPORTED_COMMANDS.includes(value as CliCommand);
}

function normalizeMode(value: string): RuntimeMode | null {
  if (value === "installed") {
    return "installed";
  }

  if (value === "sources") {
    return "sources";
  }

  return null;
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const args = [...argv];
  let command: CliCommand = "start";
  let mode: RuntimeMode | undefined;
  let daemon = false;
  let showHelp = false;
  let currentIndex = 0;

  const firstArg = args[0];
  if (firstArg && !firstArg.startsWith("-")) {
    if (!isCliCommand(firstArg)) {
      return {
        command,
        daemon,
        showHelp: true,
        error: CLI_MESSAGES.unknownCommand(firstArg),
      };
    }

    command = firstArg;
    currentIndex = 1;
  }

  while (currentIndex < args.length) {
    const token = args[currentIndex];
    if (!token) {
      break;
    }

    if (token === "--help" || token === "-h") {
      showHelp = true;
      currentIndex += 1;
      continue;
    }

    if (token === "--daemon") {
      daemon = true;
      currentIndex += 1;
      continue;
    }

    if (token === "--mode") {
      const modeValue = args[currentIndex + 1];
      if (!modeValue || modeValue.startsWith("-")) {
        return {
          command,
          daemon,
          mode,
          showHelp: true,
          error: CLI_MESSAGES.modeRequiresValue,
        };
      }

      const parsedMode = normalizeMode(modeValue);
      if (!parsedMode) {
        return {
          command,
          daemon,
          mode,
          showHelp: true,
          error: CLI_MESSAGES.invalidMode(modeValue),
        };
      }

      mode = parsedMode;
      currentIndex += 2;
      continue;
    }

    if (token.startsWith("--mode=")) {
      const modeValue = token.slice("--mode=".length);
      const parsedMode = normalizeMode(modeValue);
      if (!parsedMode) {
        return {
          command,
          daemon,
          mode,
          showHelp: true,
          error: CLI_MESSAGES.invalidMode(modeValue),
        };
      }

      mode = parsedMode;
      currentIndex += 1;
      continue;
    }

    return {
      command,
      daemon,
      mode,
      showHelp: true,
      error: CLI_MESSAGES.unknownOption(token),
    };
  }

  if (command !== "start" && mode) {
    return {
      command,
      daemon,
      mode,
      showHelp: true,
      error: CLI_MESSAGES.modeOnlyStart,
    };
  }

  if (command !== "start" && daemon) {
    return {
      command,
      daemon,
      mode,
      showHelp: true,
      error: CLI_MESSAGES.daemonOnlyStart,
    };
  }

  return {
    command,
    daemon,
    mode,
    showHelp,
  };
}
