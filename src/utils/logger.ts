import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { getRuntimePaths } from "../runtime/paths.js";

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const FILE_LOG_NAME = "opencode-telegram.log";
const FILE_LOG_MAX_BYTES = 5 * 1024 * 1024;
const FILE_LOG_MAX_ROTATIONS = 5;
const LOG_LINE_SEPARATOR = "\n";
const LOG_FILE_SUFFIX_SEPARATOR = ".";

let fileLoggerInitialized = false;
let currentLogFileSizeBytes = 0;
let fileWriteQueue: Promise<void> = Promise.resolve();

function normalizeLogLevel(value: string): LogLevel {
  if (value in LOG_LEVELS) {
    return value as LogLevel;
  }

  return "info";
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

function shouldLog(level: LogLevel): boolean {
  const configLevel = normalizeLogLevel(config.server.logLevel);
  return LOG_LEVELS[level] >= LOG_LEVELS[configLevel];
}

function getLogFilePath(): string {
  return path.join(getRuntimePaths().logsDirPath, FILE_LOG_NAME);
}

function getRotatedLogPath(logFilePath: string, index: number): string {
  return `${logFilePath}${LOG_FILE_SUFFIX_SEPARATOR}${index}`;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureFileLoggerInitialized(logFilePath: string): Promise<void> {
  if (fileLoggerInitialized) {
    return;
  }

  await fs.mkdir(path.dirname(logFilePath), { recursive: true });

  try {
    const stat = await fs.stat(logFilePath);
    currentLogFileSizeBytes = stat.size;
  } catch {
    currentLogFileSizeBytes = 0;
  }

  fileLoggerInitialized = true;
}

async function rotateLogFile(logFilePath: string): Promise<void> {
  const oldestPath = getRotatedLogPath(logFilePath, FILE_LOG_MAX_ROTATIONS);
  if (await pathExists(oldestPath)) {
    await fs.rm(oldestPath, { force: true });
  }

  for (let index = FILE_LOG_MAX_ROTATIONS - 1; index >= 1; index--) {
    const currentPath = getRotatedLogPath(logFilePath, index);
    if (!(await pathExists(currentPath))) {
      continue;
    }

    const nextPath = getRotatedLogPath(logFilePath, index + 1);
    await fs.rename(currentPath, nextPath);
  }

  if (await pathExists(logFilePath)) {
    await fs.rename(logFilePath, getRotatedLogPath(logFilePath, 1));
  }

  currentLogFileSizeBytes = 0;
}

function stringifyLogArg(arg: unknown): string {
  if (arg instanceof Error) {
    return arg.stack ?? `${arg.name}: ${arg.message}`;
  }

  if (typeof arg === "string") {
    return arg;
  }

  if (typeof arg === "number" || typeof arg === "boolean" || arg === null || arg === undefined) {
    return String(arg);
  }

  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function toFileLogLine(level: LogLevel, args: unknown[]): string {
  const prefix = formatPrefix(level);
  if (args.length === 0) {
    return prefix;
  }

  const serializedArgs = args.map((arg) => stringifyLogArg(arg));
  return `${prefix} ${serializedArgs.join(" ")}`;
}

function writeToConsole(level: LogLevel, args: unknown[]): void {
  const output = withPrefix(level, args);

  if (level === "warn") {
    console.warn(...output);
    return;
  }

  if (level === "error") {
    console.error(...output);
    return;
  }

  console.log(...output);
}

function writeToFile(level: LogLevel, args: unknown[]): void {
  const logFilePath = getLogFilePath();
  const logLine = `${toFileLogLine(level, args)}${LOG_LINE_SEPARATOR}`;

  fileWriteQueue = fileWriteQueue
    .catch(() => {
      // Keep queue alive after previous write error.
    })
    .then(async () => {
      try {
        await ensureFileLoggerInitialized(logFilePath);

        const lineSizeBytes = Buffer.byteLength(logLine);
        if (currentLogFileSizeBytes + lineSizeBytes > FILE_LOG_MAX_BYTES) {
          await rotateLogFile(logFilePath);
        }

        await fs.appendFile(logFilePath, logLine, "utf-8");
        currentLogFileSizeBytes += lineSizeBytes;
      } catch (error) {
        console.error("[Logger] Failed to write log file:", error);
      }
    });
}

function log(level: LogLevel, ...args: unknown[]): void {
  if (!shouldLog(level)) {
    return;
  }

  writeToConsole(level, args);
  writeToFile(level, args);
}

export const logger = {
  debug: (...args: unknown[]): void => {
    log("debug", ...args);
  },
  info: (...args: unknown[]): void => {
    log("info", ...args);
  },
  warn: (...args: unknown[]): void => {
    log("warn", ...args);
  },
  error: (...args: unknown[]): void => {
    log("error", ...args);
  },
};
