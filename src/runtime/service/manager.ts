import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { exec, spawn } from "node:child_process";
import { promisify } from "node:util";
import { getRuntimePaths } from "../paths.js";
import { buildServiceChildEnv } from "./env.js";
import type {
  BotServiceState,
  BotServiceStatus,
  ServiceCleanupReason,
  ServiceOperationResult,
} from "./types.js";

const execAsync = promisify(exec);
const SERVICE_STATE_FILE_NAME = "bot-service.json";
const PROCESS_EXIT_POLL_MS = 100;
const DEFAULT_STOP_TIMEOUT_MS = 5000;

function sanitizeTimestampForFile(timestamp: string): string {
  return timestamp.replace(/:/g, "-").replace("T", "_");
}

function createServiceLogFilePath(logsDirPath: string): string {
  const timestamp = sanitizeTimestampForFile(new Date().toISOString().slice(0, 19));
  return path.join(logsDirPath, `bot-service-${timestamp}.log`);
}

function isValidServiceState(value: unknown): value is BotServiceState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<BotServiceState>;
  return (
    typeof candidate.pid === "number" &&
    Number.isInteger(candidate.pid) &&
    candidate.pid > 0 &&
    typeof candidate.startedAt === "string" &&
    candidate.startedAt.length > 0 &&
    typeof candidate.logFilePath === "string" &&
    candidate.logFilePath.length > 0 &&
    candidate.mode === "daemon"
  );
}

async function writeFileAtomically(filePath: string, content: string): Promise<void> {
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });

  const tempFilePath = `${filePath}.${process.pid}.tmp`;
  await fsPromises.writeFile(tempFilePath, content, "utf-8");
  await fsPromises.rename(tempFilePath, filePath);
}

async function readServiceStateFile(
  filePath: string,
): Promise<{ service: BotServiceState | null; cleanupReason: ServiceCleanupReason }> {
  try {
    const content = await fsPromises.readFile(filePath, "utf-8");
    const parsed = JSON.parse(content) as unknown;

    if (!isValidServiceState(parsed)) {
      await clearServiceStateFile(filePath);
      return { service: null, cleanupReason: "invalid" };
    }

    return { service: parsed, cleanupReason: null };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { service: null, cleanupReason: null };
    }

    if (error instanceof SyntaxError) {
      await clearServiceStateFile(filePath);
      return { service: null, cleanupReason: "invalid" };
    }

    throw error;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (!isProcessAlive(pid)) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, PROCESS_EXIT_POLL_MS));
  }

  return !isProcessAlive(pid);
}

function getServiceEntryScriptPath(): string {
  const scriptPath = process.argv[1];

  if (!scriptPath || scriptPath.trim().length === 0) {
    throw new Error("Failed to resolve CLI entry script path.");
  }

  return path.resolve(scriptPath);
}

async function stopWindowsProcess(pid: number, timeoutMs: number): Promise<void> {
  try {
    await execAsync(`taskkill /PID ${pid} /T`);
  } catch {
    // Continue with forced stop if the process is still alive.
  }

  if (await waitForProcessExit(pid, timeoutMs)) {
    return;
  }

  await execAsync(`taskkill /F /PID ${pid} /T`);
  await waitForProcessExit(pid, timeoutMs);
}

async function stopUnixProcess(pid: number, timeoutMs: number): Promise<void> {
  process.kill(pid, "SIGTERM");

  if (await waitForProcessExit(pid, timeoutMs)) {
    return;
  }

  process.kill(pid, "SIGKILL");
  await waitForProcessExit(pid, timeoutMs);
}

export function getServiceStateFilePath(): string {
  return path.join(getRuntimePaths().runDirPath, SERVICE_STATE_FILE_NAME);
}

export async function clearServiceStateFile(
  filePath: string = getServiceStateFilePath(),
): Promise<void> {
  try {
    await fsPromises.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

export async function getBotServiceStatus(): Promise<BotServiceStatus> {
  const stateFilePath = getServiceStateFilePath();
  const { service, cleanupReason } = await readServiceStateFile(stateFilePath);

  if (!service) {
    return {
      status: "stopped",
      service: null,
      cleanupReason,
    };
  }

  if (!isProcessAlive(service.pid)) {
    await clearServiceStateFile(stateFilePath);
    return {
      status: "stopped",
      service: null,
      cleanupReason: "stale",
    };
  }

  return {
    status: "running",
    service,
    cleanupReason,
  };
}

export async function startBotDaemon(mode?: string): Promise<ServiceOperationResult> {
  const currentStatus = await getBotServiceStatus();
  if (currentStatus.status === "running" && currentStatus.service) {
    return {
      success: false,
      service: currentStatus.service,
      cleanupReason: currentStatus.cleanupReason,
      alreadyRunning: true,
    };
  }

  const runtimePaths = getRuntimePaths();
  await Promise.all([
    fsPromises.mkdir(runtimePaths.runDirPath, { recursive: true }),
    fsPromises.mkdir(runtimePaths.logsDirPath, { recursive: true }),
  ]);

  const stateFilePath = getServiceStateFilePath();
  const logFilePath = createServiceLogFilePath(runtimePaths.logsDirPath);
  const logFileDescriptor = fs.openSync(logFilePath, "a");

  try {
    const childArgs = [getServiceEntryScriptPath(), "start"];
    if (mode) {
      childArgs.push("--mode", mode);
    }

    const childProcess = spawn(process.execPath, childArgs, {
      detached: true,
      stdio: ["ignore", logFileDescriptor, logFileDescriptor],
      windowsHide: true,
      env: buildServiceChildEnv(process.env, stateFilePath),
    });

    if (!childProcess.pid) {
      throw new Error("Failed to start background bot process.");
    }

    childProcess.unref();

    const serviceState: BotServiceState = {
      pid: childProcess.pid,
      startedAt: new Date().toISOString(),
      logFilePath,
      mode: "daemon",
    };

    await writeFileAtomically(stateFilePath, `${JSON.stringify(serviceState, null, 2)}\n`);

    return {
      success: true,
      service: serviceState,
      cleanupReason: currentStatus.cleanupReason,
    };
  } catch (error) {
    await clearServiceStateFile(stateFilePath);
    return {
      success: false,
      service: null,
      cleanupReason: currentStatus.cleanupReason,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    fs.closeSync(logFileDescriptor);
  }
}

export async function stopBotDaemon(
  timeoutMs: number = DEFAULT_STOP_TIMEOUT_MS,
): Promise<ServiceOperationResult> {
  const currentStatus = await getBotServiceStatus();
  if (currentStatus.status !== "running" || !currentStatus.service) {
    return {
      success: true,
      service: null,
      cleanupReason: currentStatus.cleanupReason,
      alreadyStopped: true,
    };
  }

  const { pid } = currentStatus.service;

  try {
    if (process.platform === "win32") {
      await stopWindowsProcess(pid, timeoutMs);
    } else {
      await stopUnixProcess(pid, timeoutMs);
    }

    if (isProcessAlive(pid)) {
      return {
        success: false,
        service: currentStatus.service,
        cleanupReason: currentStatus.cleanupReason,
        error: `Failed to stop background bot process PID=${pid}.`,
      };
    }

    await clearServiceStateFile();

    return {
      success: true,
      service: currentStatus.service,
      cleanupReason: currentStatus.cleanupReason,
    };
  } catch (error) {
    return {
      success: false,
      service: currentStatus.service,
      cleanupReason: currentStatus.cleanupReason,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
