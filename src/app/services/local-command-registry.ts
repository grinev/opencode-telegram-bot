import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { logger } from "../../utils/logger.js";

const COMMAND_NAME_PATTERN = /^[a-z0-9_]{1,32}$/;
const COMMAND_LIMIT = 100;
const EXECUTION_TIMEOUT_MS = 30_000;
const TELEGRAM_TEXT_LIMIT = 4096;
const TRUNCATION_SUFFIX = "\n… [truncated]";
const STDERR_TAIL_LIMIT = 1024;

export interface LocalCommandDefinition {
  command: string;
  description: string;
  allowWhenBusy: boolean;
}

interface LoadedCommand extends LocalCommandDefinition {
  exec: string;
}

export type LocalCommandResult =
  | { kind: "success"; text: string }
  | { kind: "empty" }
  | { kind: "failed"; exitCode: number | null; stderr: string }
  | { kind: "timeout" };

export class LocalCommandRegistry {
  private constructor(
    private readonly commands: ReadonlyMap<string, LoadedCommand>,
    private readonly workingDirectory: string,
  ) {}

  static empty(): LocalCommandRegistry {
    return new LocalCommandRegistry(new Map(), process.cwd());
  }

  static async load(options: {
    directoryPath: string;
    builtInCommands: readonly string[];
  }): Promise<LocalCommandRegistry> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(options.directoryPath, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        logger.info("[LocalCommands] Loaded 0 command(s), skipped 0");
        return LocalCommandRegistry.empty();
      }
      logger.warn(`[LocalCommands] Failed to read directory: ${options.directoryPath}`, error);
      logger.info("[LocalCommands] Loaded 0 command(s), skipped 0");
      return LocalCommandRegistry.empty();
    }

    const names = new Set(options.builtInCommands);
    const commands = new Map<string, LoadedCommand>();
    let skipped = 0;
    const fileNames = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));

    for (const fileName of fileNames) {
      const filePath = path.join(options.directoryPath, fileName);
      const command = fileName.slice(0, -".json".length);
      if (!COMMAND_NAME_PATTERN.test(command)) {
        skipped++;
        logger.warn(`[LocalCommands] Skipped ${filePath}: invalid command name`);
        continue;
      }
      if (names.has(command)) {
        skipped++;
        logger.warn(`[LocalCommands] Skipped ${filePath}: command collides with a built-in command`);
        continue;
      }
      if (options.builtInCommands.length + commands.size >= COMMAND_LIMIT) {
        skipped++;
        logger.warn(`[LocalCommands] Skipped ${filePath}: Telegram command limit reached`);
        continue;
      }

      try {
        const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
        if (!isCommandFile(parsed)) {
          skipped++;
          logger.warn(`[LocalCommands] Skipped ${filePath}: invalid command definition`);
          continue;
        }
        commands.set(command, {
          command,
          description: parsed.description,
          exec: parsed.exec,
          allowWhenBusy: parsed.allowWhenBusy ?? false,
        });
      } catch (error) {
        skipped++;
        logger.warn(`[LocalCommands] Skipped ${filePath}: failed to load command`, error);
      }
    }

    logger.info(`[LocalCommands] Loaded ${commands.size} command(s), skipped ${skipped}`);
    return new LocalCommandRegistry(commands, path.dirname(options.directoryPath));
  }

  definitions(): readonly LocalCommandDefinition[] {
    return [...this.commands.values()].map(({ command, description, allowWhenBusy }) => ({
      command,
      description,
      allowWhenBusy,
    }));
  }

  allowsWhenBusy(command: string | undefined): boolean {
    return Boolean(command && this.commands.get(command.slice(1))?.allowWhenBusy);
  }

  has(command: string | undefined): boolean {
    return Boolean(command && this.commands.has(command.slice(1)));
  }

  async execute(command: string): Promise<LocalCommandResult> {
    const definition = this.commands.get(command);
    if (!definition) {
      return { kind: "failed", exitCode: null, stderr: "" };
    }

    const child = spawn(
      process.platform === "win32" ? "cmd.exe" : "/bin/sh",
      process.platform === "win32" ? ["/d", "/s", "/c", definition.exec] : ["-c", definition.exec],
      { cwd: this.workingDirectory, env: process.env, windowsHide: true, detached: process.platform !== "win32" },
    );
    let stdout = "";
    let stderr = "";
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendBounded(stdout, stdoutDecoder.write(chunk), TELEGRAM_TEXT_LIMIT + TRUNCATION_SUFFIX.length);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendTail(stderr, stderrDecoder.write(chunk), STDERR_TAIL_LIMIT);
    });

    return new Promise<LocalCommandResult>((resolve) => {
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        terminateProcessTree(child.pid);
        resolve({ kind: "timeout" });
      }, EXECUTION_TIMEOUT_MS);
      child.once("error", (error) => {
        clearTimeout(timeout);
        resolve({ kind: "failed", exitCode: null, stderr: error.message });
      });
      child.once("close", (code) => {
        clearTimeout(timeout);
        if (timedOut) return;
        if (code !== 0) {
          resolve({ kind: "failed", exitCode: code, stderr });
          return;
        }
        resolve(stdout.length === 0 ? { kind: "empty" } : { kind: "success", text: truncate(stdout) });
      });
    });
  }
}

function isCommandFile(value: unknown): value is {
  description: string;
  exec: string;
  allowWhenBusy?: boolean;
} {
  if (!value || typeof value !== "object") return false;
  const description = Reflect.get(value, "description");
  const exec = Reflect.get(value, "exec");
  const allowWhenBusy = Reflect.get(value, "allowWhenBusy");
  return (
    typeof description === "string" &&
    description.length > 0 &&
    description.length <= 256 &&
    !/[\r\n]/.test(description) &&
    typeof exec === "string" &&
    exec.trim().length > 0 &&
    (allowWhenBusy === undefined || typeof allowWhenBusy === "boolean")
  );
}

function appendBounded(current: string, next: string, limit: number): string {
  return current.length >= limit ? current : `${current}${next}`.slice(0, limit);
}

function appendTail(current: string, next: string, limit: number): string {
  const combined = `${current}${next}`;
  let start = Math.max(0, combined.length - limit);
  const previous = combined.charCodeAt(start - 1);
  const first = combined.charCodeAt(start);
  if (previous >= 0xd800 && previous <= 0xdbff && first >= 0xdc00 && first <= 0xdfff) start++;
  return combined.slice(start);
}

function truncate(text: string): string {
  if (text.length <= TELEGRAM_TEXT_LIMIT) return text;
  let end = TELEGRAM_TEXT_LIMIT - TRUNCATION_SUFFIX.length;
  const previous = text.charCodeAt(end - 1);
  const next = text.charCodeAt(end);
  if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end--;
  return `${text.slice(0, end)}${TRUNCATION_SUFFIX}`;
}

function terminateProcessTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === "win32") {
    const taskkill = spawn("taskkill", ["/pid", String(pid), "/t", "/f"], { windowsHide: true });
    taskkill.once("error", (error) => logger.warn(`[LocalCommands] Failed to terminate process tree ${pid}`, error));
    taskkill.once("close", (code) => {
      if (code !== 0) {
        logger.warn(`[LocalCommands] Process-tree termination exited with code ${code}: ${pid}`);
      }
    });
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      logger.warn(`[LocalCommands] Failed to terminate process tree ${pid}`, error);
    }
  }
}
