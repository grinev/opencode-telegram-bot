import path from "bun:path";
import { getRuntimeMode, type RuntimeMode } from "../runtime/mode.js";
import { getRuntimePaths } from "../runtime/paths.js";

type LogLevel = "debug" | "info" | "warn" | "error";

const DEFAULT_LOG_LEVEL: LogLevel = "info";
const DEFAULT_LOG_RETENTION = 10;
const LOGGER_ERROR_PREFIX = "[LOGGER]";
const CONSOLE_BROKEN_KEY = "__opencodeTelegramBotConsoleOutputBroken";
const CONSOLE_PIPE_GUARD_KEY = "__opencodeTelegramBotConsolePipeGuardInstalled";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

interface LogFileWriter {
  write(line: string): void;
  flush(): Promise<void>;
  end(): Promise<void>;
}

let logWriter: LogFileWriter | null = null;
let logFilePath: string | null = null;
let initializePromise: Promise<void> | null = null;
let cleanupPromise: Promise<void> | null = null;
let streamErrorReported = false;

function normalizeLogLevel(value: string): LogLevel {
  if (value in LOG_LEVELS) {
    return value as LogLevel;
  }

  return DEFAULT_LOG_LEVEL;
}

function parsePositiveInteger(value: string | undefined, defaultValue: number): number {
  if (!value) {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return defaultValue;
  }

  return parsed;
}

function getConfiguredLogLevel(): LogLevel {
  return normalizeLogLevel(process.env.LOG_LEVEL ?? DEFAULT_LOG_LEVEL);
}

function getConfiguredLogRetention(): number {
  return parsePositiveInteger(process.env.LOG_RETENTION, DEFAULT_LOG_RETENTION);
}

function formatPrefix(level: LogLevel): string {
  return `[${new Date().toISOString()}] [${level.toUpperCase()}]`;
}

function formatArg(arg: unknown): unknown {
  if (arg instanceof Error) {
    return arg.stack ?? `${arg.name}: ${arg.message}`;
  }

  return arg;
}

function formatArgForFile(arg: unknown): string {
  const formatted = formatArg(arg);

  if (typeof formatted === "string") {
    return formatted;
  }

  return Bun.inspect(formatted, {
    colors: false,
    compact: true,
    depth: 8,
    breakLength: Infinity,
  });
}

function withPrefix(level: LogLevel, args: unknown[]): unknown[] {
  const formattedArgs = args.map((arg) => formatArg(arg));
  const prefix = formatPrefix(level);

  if (formattedArgs.length === 0) {
    return [prefix];
  }

  if (typeof formattedArgs[0] === "string") {
    return [`${prefix} ${formattedArgs[0]}`, ...formattedArgs.slice(1)];
  }

  return [prefix, ...formattedArgs];
}

function formatLine(level: LogLevel, args: unknown[]): string {
  const prefix = formatPrefix(level);
  const formattedArgs = args.map((arg) => formatArgForFile(arg));

  if (formattedArgs.length === 0) {
    return prefix;
  }

  return `${prefix} ${formattedArgs.join(" ")}`;
}

function shouldLog(level: LogLevel): boolean {
  const configuredLevel = getConfiguredLogLevel();
  return LOG_LEVELS[level] >= LOG_LEVELS[configuredLevel];
}

function sanitizeTimestampForFile(timestamp: string): string {
  return timestamp.replace(/:/g, "-").replace("T", "_");
}

function getSourcesLogFileName(): string {
  const timestamp = sanitizeTimestampForFile(new Date().toISOString().slice(0, 19));
  return `bot-${timestamp}_${process.pid}.log`;
}

function getInstalledLogFileName(): string {
  return `bot-${new Date().toISOString().slice(0, 10)}.log`;
}

function getLogFileName(mode: RuntimeMode): string {
  return mode === "installed" ? getInstalledLogFileName() : getSourcesLogFileName();
}

function getLogFilePathForMode(logsDirPath: string, mode: RuntimeMode): string {
  return path.join(logsDirPath, getLogFileName(mode));
}

function getLogFilePattern(mode: RuntimeMode): RegExp {
  if (mode === "installed") {
    return /^bot-\d{4}-\d{2}-\d{2}\.log$/;
  }

  return /^bot-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_\d+\.log$/;
}

function reportLoggerInternalError(message: string, error?: unknown): void {
  const details =
    error instanceof Error
      ? (error.stack ?? `${error.name}: ${error.message}`)
      : String(error ?? "");
  const suffix = details && details !== "undefined" ? ` ${details}` : "";
  process.stderr.write(`${formatPrefix("error")} ${LOGGER_ERROR_PREFIX} ${message}${suffix}\n`);
}

function isConsoleOutputBroken(): boolean {
  return (globalThis as Record<string, unknown>)[CONSOLE_BROKEN_KEY] === true;
}

// A closed console pipe makes each console write raise EPIPE. Without an
// "error" listener, Node escalates that to an uncaught exception, whose
// handler logs through this same console — an unbounded loop that grew a
// log file to 2 GB once. Swallow EPIPE and stop console logging instead.
function installConsolePipeGuard(): void {
  if ((globalThis as Record<string, unknown>)[CONSOLE_PIPE_GUARD_KEY]) {
    return;
  }
  (globalThis as Record<string, unknown>)[CONSOLE_PIPE_GUARD_KEY] = true;

  const handleStreamError = (error: unknown): void => {
    if (
      error instanceof Error &&
      (error as { code?: unknown }).code === "EPIPE"
    ) {
      (globalThis as Record<string, unknown>)[CONSOLE_BROKEN_KEY] = true;
      return;
    }

    // Re-throw non-EPIPE errors to preserve fatal EventEmitter semantics
    throw error;
  };

  process.stdout.on("error", handleStreamError);
  process.stderr.on("error", handleStreamError);
}

installConsolePipeGuard();

function writeToConsole(level: LogLevel, args: unknown[]): void {
  if (isConsoleOutputBroken()) {
    return;
  }

  const prefixedArgs = withPrefix(level, args);
  if (level === "warn") {
    console.warn(...prefixedArgs);
  } else if (level === "error") {
    console.error(...prefixedArgs);
  } else {
    console.log(...prefixedArgs);
  }
}

function createAppendWriter(filePath: string): LogFileWriter {
  const sink = Bun.file(filePath).writer({ highWaterMark: 64 * 1024 });
  return {
    write(line: string): void {
      const result = sink.write(line);
      void result;
    },
    async flush(): Promise<void> {
      try {
        await sink.flush();
      } catch (error) {
        if (process.env.LOGGER_DEBUG) {
          console.error("[logger] sink.flush error:", error);
        }
      }
    },
    async end(): Promise<void> {
      try {
        await sink.end();
      } catch (error) {
        if (process.env.LOGGER_DEBUG) {
          console.error("[logger] sink.end error:", error);
        }
      }
    },
  };
}

function handleLogStreamError(error: unknown): void {
  if (!streamErrorReported) {
    streamErrorReported = true;
    reportLoggerInternalError("Failed to write to log file.", error);
  }

  if (logWriter) {
    logWriter.end().catch(() => {});
    logWriter = null;
  }
}

function closeLogStream(): void {
  if (!logWriter) {
    return;
  }

  logWriter.end().catch(() => {});
  logWriter = null;
}

function ensureLogStream(filePath: string): void {
  if (logWriter && logFilePath === filePath) {
    return;
  }

  closeLogStream();
  streamErrorReported = false;

  logWriter = createAppendWriter(filePath);
  logFilePath = filePath;
}

async function readDirNames(dirPath: string): Promise<string[]> {
  const glob = new Bun.Glob("*");
  const names: string[] = [];
  for await (const name of glob.scan({ cwd: dirPath, onlyFiles: true })) {
    names.push(name);
  }
  return names;
}

async function cleanupOldLogs(logsDirPath: string, mode: RuntimeMode): Promise<void> {
  const retention = getConfiguredLogRetention();
  const filePattern = getLogFilePattern(mode);

  let fileNames: string[];

  try {
    fileNames = await readDirNames(logsDirPath);
  } catch (error) {
    reportLoggerInternalError(`Failed to read log directory ${logsDirPath}.`, error);
    return;
  }

  const matchingFiles = fileNames.filter((fileName) => filePattern.test(fileName)).sort();
  const filesToDelete = matchingFiles.slice(0, Math.max(0, matchingFiles.length - retention));

  await Promise.all(
    filesToDelete.map(async (fileName) => {
      try {
        await Bun.file(path.join(logsDirPath, fileName)).delete();
      } catch (error) {
        reportLoggerInternalError(`Failed to delete old log file ${fileName}.`, error);
      }
    }),
  );
}

function cleanupOldLogsInBackground(logsDirPath: string, mode: RuntimeMode): void {
  if (cleanupPromise) {
    return;
  }

  cleanupPromise = cleanupOldLogs(logsDirPath, mode)
    .catch((error) => {
      reportLoggerInternalError(`Failed to clean up old logs in ${logsDirPath}.`, error);
    })
    .finally(() => {
      cleanupPromise = null;
    });
}

function ensureDirectorySync(dirPath: string): void {
  const result = Bun.spawnSync(["mkdir", "-p", dirPath], { stdout: "ignore", stderr: "ignore" });
  if (result.exitCode !== 0) {
    throw new Error(`mkdir -p "${dirPath}" failed with exit code ${result.exitCode}`);
  }
}

function rotateInstalledLogIfNeeded(): void {
  const mode = getRuntimeMode();
  if (mode !== "installed" || !logFilePath) {
    return;
  }

  const runtimePaths = getRuntimePaths();
  const nextLogFilePath = getLogFilePathForMode(runtimePaths.logsDirPath, mode);
  if (logFilePath === nextLogFilePath) {
    return;
  }

  try {
    ensureDirectorySync(runtimePaths.logsDirPath);
    ensureLogStream(nextLogFilePath);
    cleanupOldLogsInBackground(runtimePaths.logsDirPath, mode);
  } catch (error) {
    reportLoggerInternalError(
      `Failed to rotate file logging to ${nextLogFilePath}.`,
      error,
    );
    closeLogStream();
    logFilePath = null;
  }
}

function writeToFile(line: string): void {
  if (!logWriter) {
    return;
  }

  try {
    rotateInstalledLogIfNeeded();
    if (!logWriter) {
      return;
    }

    logWriter.write(`${line}\n`);
  } catch (error) {
    handleLogStreamError(error);
  }
}

async function ensureDirectoryAsync(dirPath: string): Promise<void> {
  const proc = Bun.spawn(["mkdir", "-p", dirPath], { stdout: "ignore", stderr: "ignore" });
  await proc.exited;
}

async function initializeLoggerInternal(): Promise<void> {
  if (logWriter && logFilePath) {
    return;
  }

  const runtimePaths = getRuntimePaths();
  const mode = getRuntimeMode();

  try {
    await ensureDirectoryAsync(runtimePaths.logsDirPath);
    const nextLogFilePath = getLogFilePathForMode(runtimePaths.logsDirPath, mode);
    ensureLogStream(nextLogFilePath);
    await cleanupOldLogs(runtimePaths.logsDirPath, mode);
  } catch (error) {
    reportLoggerInternalError(
      `Failed to initialize file logging in ${runtimePaths.logsDirPath}.`,
      error,
    );
    closeLogStream();
    logFilePath = null;
  }
}

export async function initializeLogger(): Promise<void> {
  if (initializePromise) {
    await initializePromise;
    return;
  }

  initializePromise = initializeLoggerInternal();

  try {
    await initializePromise;
  } finally {
    initializePromise = null;
  }
}

export function getLogFilePath(): string | null {
  return logFilePath;
}

export async function flushLogger(): Promise<void> {
  if (cleanupPromise) {
    await cleanupPromise;
  }

  if (!logWriter) {
    return;
  }

  await logWriter.flush();
}

export async function __flushLoggerForTests(): Promise<void> {
  await flushLogger();
}

export async function __flushLoggerForTests(): Promise<void> {
  await flushLogger();
}

export function __resetLoggerForTests(): void {
  initializePromise = null;
  cleanupPromise = null;
  logFilePath = null;
  streamErrorReported = false;
  (globalThis as Record<string, unknown>)[CONSOLE_BROKEN_KEY] = false;
  closeLogStream();
}

export const logger = {
  debug: (...args: unknown[]): void => {
    if (shouldLog("debug")) {
      writeToConsole("debug", args);
      writeToFile(formatLine("debug", args));
    }
  },

  info: (...args: unknown[]): void => {
    if (shouldLog("info")) {
      writeToConsole("info", args);
      writeToFile(formatLine("info", args));
    }
  },

  warn: (...args: unknown[]): void => {
    if (shouldLog("warn")) {
      writeToConsole("warn", args);
      writeToFile(formatLine("warn", args));
    }
  },

  error: (...args: unknown[]): void => {
    if (shouldLog("error")) {
      writeToConsole("error", args);
      writeToFile(formatLine("error", args));
    }
  },
};
