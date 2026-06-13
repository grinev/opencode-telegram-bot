#!/usr/bin/env node

import type { RuntimeMode } from "./runtime/mode.js";
import { parseCliArgs } from "./cli/args.js";
import { resolveRuntimeMode, setRuntimeMode } from "./runtime/mode.js";
import { getRuntimePaths } from "./runtime/paths.js";

const EXIT_SUCCESS = 0;
const EXIT_RUNTIME_ERROR = 1;
const EXIT_INVALID_ARGS = 2;

const CLI_USAGE = `Usage:
  opencode-telegram [start] [--daemon] [--mode installed]
  opencode-telegram status
  opencode-telegram stop
  opencode-telegram config

Notes:
  - No command defaults to start
  - start runs in foreground by default
  - --daemon is supported for the installed runtime only`;

const CLI_MESSAGES = {
  daemonRequiresInstalled:
    "Daemon mode is supported only for the installed runtime. Use `opencode-telegram start` for foreground source runs.",
  unknownServiceError: "Unknown service error.",
  cleanupStale: "Removed stale daemon state file.",
  cleanupInvalid: "Removed invalid daemon state file.",
  startSuccess: "OpenCode Telegram Bot daemon started.",
  startAlreadyRunning: "OpenCode Telegram Bot daemon is already running.",
  statusRunning: "Service status: running",
  statusStopped: "Service status: stopped",
  stopSuccess: "OpenCode Telegram Bot daemon stopped.",
  stopAlreadyStopped: "OpenCode Telegram Bot daemon is not running.",
  linePid: (pid: number) => `PID: ${pid}`,
  lineStartedAt: (startedAt: string) => `Started at: ${startedAt}`,
  lineUptimeSec: (seconds: number) => `Uptime: ${seconds} sec`,
  lineLogFile: (filePath: string) => `Log file: ${filePath}`,
  lineAppHome: (appHome: string) => `App home: ${appHome}`,
  errorPrefix: (message: string) => `CLI error: ${message}`,
} as const;

function writeStdout(message: string): void {
  process.stdout.write(`${message}\n`);
}

function writeStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

function printUsage(): void {
  writeStdout(CLI_USAGE);
}

function formatServiceCleanupMessage(cleanupReason: "stale" | "invalid" | null): string | null {
  if (cleanupReason === "stale") {
    return CLI_MESSAGES.cleanupStale;
  }

  if (cleanupReason === "invalid") {
    return CLI_MESSAGES.cleanupInvalid;
  }

  return null;
}

function formatServiceDetails(details: {
  pid: number;
  startedAt: string;
  logFilePath: string;
  appHome: string;
}): string {
  const uptimeSec = Math.max(0, Math.floor((Date.now() - Date.parse(details.startedAt)) / 1000));

  return [
    CLI_MESSAGES.linePid(details.pid),
    CLI_MESSAGES.lineStartedAt(details.startedAt),
    CLI_MESSAGES.lineUptimeSec(uptimeSec),
    CLI_MESSAGES.lineLogFile(details.logFilePath),
    CLI_MESSAGES.lineAppHome(details.appHome),
  ].join("\n");
}

function writeOptionalLine(message: string | null): void {
  if (message) {
    writeStdout(message);
  }
}

async function runStartCommand(mode: RuntimeMode | undefined, daemon: boolean): Promise<number> {
  const modeResult = resolveRuntimeMode({
    defaultMode: "installed",
    explicitMode: mode,
  });

  if (modeResult.error) {
    throw new Error(modeResult.error);
  }

  setRuntimeMode(modeResult.mode);

  if (daemon && modeResult.mode !== "installed") {
    throw new Error(CLI_MESSAGES.daemonRequiresInstalled);
  }

  const { ensureRuntimeConfigForStart } = await import("./runtime/bootstrap.js");
  await ensureRuntimeConfigForStart();

  if (daemon) {
    const { startBotDaemon } = await import("./runtime/service/manager.js");
    const result = await startBotDaemon(modeResult.mode);
    const cleanupMessage = formatServiceCleanupMessage(result.cleanupReason);
    const runtimePaths = getRuntimePaths();

    writeOptionalLine(cleanupMessage);

    if (!result.success) {
      if (result.alreadyRunning && result.service) {
        writeStdout(CLI_MESSAGES.startAlreadyRunning);
        writeStdout("");
        writeStdout(
          formatServiceDetails({
            pid: result.service.pid,
            startedAt: result.service.startedAt,
            logFilePath: result.service.logFilePath,
            appHome: runtimePaths.appHome,
          }),
        );
        return EXIT_SUCCESS;
      }

      throw new Error(result.error || CLI_MESSAGES.unknownServiceError);
    }

    if (!result.service) {
      throw new Error(CLI_MESSAGES.unknownServiceError);
    }

    writeStdout(CLI_MESSAGES.startSuccess);
    writeStdout("");
    writeStdout(
      formatServiceDetails({
        pid: result.service.pid,
        startedAt: result.service.startedAt,
        logFilePath: result.service.logFilePath,
        appHome: runtimePaths.appHome,
      }),
    );
    return EXIT_SUCCESS;
  }

  const { initializeLogger } = await import("./utils/logger.js");
  await initializeLogger();

  const { startBotApp } = await import("./app/bootstrap/start-bot-app.js");
  await startBotApp();
  return EXIT_SUCCESS;
}

async function runConfigCommand(): Promise<number> {
  setRuntimeMode("installed");

  const { initializeLogger } = await import("./utils/logger.js");
  await initializeLogger();

  const { runConfigWizardCommand } = await import("./runtime/bootstrap.js");
  await runConfigWizardCommand();
  return EXIT_SUCCESS;
}

async function runStatusCommand(): Promise<number> {
  setRuntimeMode("installed");

  const { getBotServiceStatus } = await import("./runtime/service/manager.js");
  const runtimePaths = getRuntimePaths();
  const status = await getBotServiceStatus();

  writeOptionalLine(formatServiceCleanupMessage(status.cleanupReason));

  if (status.status !== "running" || !status.service) {
    writeStdout(CLI_MESSAGES.statusStopped);
    writeStdout(CLI_MESSAGES.lineAppHome(runtimePaths.appHome));
    return EXIT_SUCCESS;
  }

  writeStdout(CLI_MESSAGES.statusRunning);
  writeStdout("");
  writeStdout(
    formatServiceDetails({
      pid: status.service.pid,
      startedAt: status.service.startedAt,
      logFilePath: status.service.logFilePath,
      appHome: runtimePaths.appHome,
    }),
  );
  return EXIT_SUCCESS;
}

async function runStopCommand(): Promise<number> {
  setRuntimeMode("installed");

  const { stopBotDaemon } = await import("./runtime/service/manager.js");
  const result = await stopBotDaemon();

  writeOptionalLine(formatServiceCleanupMessage(result.cleanupReason));

  if (!result.success) {
    throw new Error(result.error || CLI_MESSAGES.unknownServiceError);
  }

  if (result.alreadyStopped) {
    writeStdout(CLI_MESSAGES.stopAlreadyStopped);
    return EXIT_SUCCESS;
  }

  writeStdout(CLI_MESSAGES.stopSuccess);
  return EXIT_SUCCESS;
}

async function runCli(argv: string[]): Promise<number> {
  const parsedArgs = parseCliArgs(argv);

  if (parsedArgs.error) {
    writeStderr(parsedArgs.error);
  }

  if (parsedArgs.showHelp) {
    printUsage();
    return parsedArgs.error ? EXIT_INVALID_ARGS : EXIT_SUCCESS;
  }

  if (parsedArgs.command === "start") {
    return runStartCommand(parsedArgs.mode, parsedArgs.daemon);
  }

  if (parsedArgs.command === "config") {
    return runConfigCommand();
  }

  if (parsedArgs.command === "status") {
    return runStatusCommand();
  }

  return runStopCommand();
}

void runCli(process.argv.slice(2))
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    if (error instanceof Error) {
      writeStderr(CLI_MESSAGES.errorPrefix(error.message));
    } else {
      writeStderr(CLI_MESSAGES.errorPrefix(String(error)));
    }

    process.exitCode = EXIT_RUNTIME_ERROR;
  });
