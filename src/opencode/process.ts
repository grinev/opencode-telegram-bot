import { exec, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

const execAsync = promisify(exec);
const DEFAULT_OPENCODE_PORT = 4096;
const PROCESS_EXIT_POLL_MS = 100;
const SERVER_STOP_TIMEOUT_MS = 5000;

/**
 * PIDs of local OpenCode servers spawned by this bot instance via
 * `startLocalOpencodeServer`. They are detached by design, so without this
 * registry they would keep running and hold the port after the bot exits.
 */
const managedServerPids = new Set<number>();

export interface LocalOpencodeTarget {
  host: string;
  port: number;
}

export interface OpencodeServeSpawnCommand {
  command: string;
  args: string[];
  windowsHide: boolean;
}

function isLocalHostname(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(hostname.toLowerCase());
}

export function resolveLocalOpencodeTarget(apiUrl: string): LocalOpencodeTarget | null {
  try {
    const parsedUrl = new URL(apiUrl);

    if (!isLocalHostname(parsedUrl.hostname)) {
      return null;
    }

    const port = parsedUrl.port ? Number.parseInt(parsedUrl.port, 10) : DEFAULT_OPENCODE_PORT;

    if (!Number.isInteger(port) || port <= 0) {
      return null;
    }

    return {
      host: parsedUrl.hostname,
      port,
    };
  } catch {
    return null;
  }
}

function resolveWindowsOpencodeExe(): string {
  const pathEnv = process.env.PATH ?? "";
  const pathEntries = pathEnv.split(path.delimiter).filter(Boolean);

  // First pass: look for opencode.exe directly on PATH.
  // Covers non-npm installations (install script, scoop, choco, manual download, etc.).
  let directExe = "";
  for (const entry of pathEntries) {
    const candidateExe = path.join(entry, "opencode.exe");
    if (existsSync(candidateExe)) {
      directExe = candidateExe;
      break;
    }
  }

  // Second pass: look for opencode.cmd (npm global install).
  // Derive the real exe path from the shim location.
  for (const entry of pathEntries) {
    const opencodeCmd = path.join(entry, "opencode.cmd");
    if (!existsSync(opencodeCmd)) {
      continue;
    }

    const candidateExe = path.join(entry, "node_modules", "opencode-ai", "bin", "opencode.exe");
    if (existsSync(candidateExe)) {
      return candidateExe;
    }

    // Found the shim but not the exe where it usually lives. Stop searching.
    break;
  }

  // Return direct exe if found, otherwise empty string
  return directExe;
}

export function createOpencodeServeSpawnCommand(
  target: LocalOpencodeTarget,
): OpencodeServeSpawnCommand {
  const isWindows = process.platform === "win32";
  const port = target.port.toString();

  if (isWindows) {
    const resolvedExe = resolveWindowsOpencodeExe();

    if (resolvedExe) {
      return {
        command: resolvedExe,
        args: ["serve", "--port", port],
        windowsHide: true,
      };
    }

    // Safe fallback: works with default npm installs where only opencode.cmd is on PATH.
    return {
      command: "cmd.exe",
      args: ["/c", "opencode", "serve", "--port", port],
      windowsHide: true,
    };
  }

  return {
    command: "opencode",
    args: ["serve", "--port", port],
    windowsHide: false,
  };
}

export function startLocalOpencodeServer(target: LocalOpencodeTarget): ChildProcess {
  const spawnCommand = createOpencodeServeSpawnCommand(target);

  // Use configured server workdir, or fall back to current working directory
  const serverWorkdir = config.opencode.serverWorkdir;

  const childProcess = spawn(spawnCommand.command, spawnCommand.args, {
    detached: true,
    stdio: "ignore",
    windowsHide: spawnCommand.windowsHide,
    cwd: serverWorkdir || process.cwd(),
  });

  if (childProcess.pid) {
    managedServerPids.add(childProcess.pid);
  }

  return childProcess;
}

/** Stop the local OpenCode servers this bot spawned so they do not outlive the bot and keep the port busy. */
export async function stopManagedServers(timeoutMs: number = SERVER_STOP_TIMEOUT_MS): Promise<void> {
  if (managedServerPids.size === 0) {
    return;
  }

  logger.info(`[Process] Stopping ${managedServerPids.size} managed OpenCode server(s)`);

  for (const pid of [...managedServerPids]) {
    managedServerPids.delete(pid);
    try {
      const stopped = await killServerProcess(pid, timeoutMs);
      if (stopped) {
        logger.info(`[Process] Managed OpenCode server stopped: pid=${pid}`);
      } else {
        logger.warn(`[Process] Managed OpenCode server still running: pid=${pid}`);
      }
    } catch (error) {
      logger.warn(`[Process] Failed to stop managed OpenCode server: pid=${pid}`, error);
    }
  }
}

/** Stop the process holding the port, if any, so a stale process cannot block `opencode serve`. */
export async function freeLocalOpencodePort(target: LocalOpencodeTarget): Promise<boolean> {
  const pid = await findServerPid(target.port);
  if (pid === null) {
    return true;
  }

  logger.warn(
    `[Process] Port ${target.port} is held by PID ${pid}, stopping it before starting OpenCode server`,
  );
  return killServerProcess(pid);
}

function parsePid(value: string): number | null {
  const pid = Number.parseInt(value.trim(), 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function parseSocketPort(value: string): number | null {
  const trimmedValue = value.trim();
  const match = trimmedValue.match(/:(\d+)$/);
  if (!match) {
    return null;
  }

  const portText = match[1];
  if (!portText) {
    return null;
  }
  const port = Number.parseInt(portText, 10);
  return Number.isInteger(port) && port > 0 ? port : null;
}

export function findWindowsListeningPidInNetstat(stdout: string, port: number): number | null {
  for (const line of stdout.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (!trimmedLine) {
      continue;
    }

    const columns = trimmedLine.split(/\s+/);
    const localAddress = columns[1] ?? "";
    const localPort = parseSocketPort(localAddress);
    if (localPort !== port) {
      continue;
    }

    const pid = parsePid(columns[columns.length - 1] ?? "");
    if (pid !== null) {
      return pid;
    }
  }

  return null;
}

export function findUnixListeningPidInSs(stdout: string, port: number): number | null {
  for (const line of stdout.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (!trimmedLine) {
      continue;
    }

    const columns = trimmedLine.split(/\s+/);
    const localAddress = columns[3] ?? "";
    const localPort = parseSocketPort(localAddress);
    if (localPort !== port) {
      continue;
    }

    const pidMatch = trimmedLine.match(/pid=(\d+)/);
    const pidText = pidMatch?.[1];
    const pid = pidText ? parsePid(pidText) : null;
    if (pid !== null) {
      return pid;
    }
  }

  return null;
}

async function findWindowsServerPid(port: number): Promise<number | null> {
  try {
    const { stdout } = await execAsync("netstat -ano | findstr LISTENING");
    return findWindowsListeningPidInNetstat(stdout, port);
  } catch {
    return null;
  }
}

function parseUnixPidList(stdout: string): number | null {
  for (const line of stdout.split(/\r?\n/)) {
    const pid = parsePid(line);
    if (pid !== null) {
      return pid;
    }
  }

  return null;
}

async function findUnixServerPid(port: number): Promise<number | null> {
  try {
    const { stdout } = await execAsync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`);
    const pid = parseUnixPidList(stdout);
    if (pid !== null) {
      return pid;
    }
  } catch {
    // Fall back to ss when lsof is unavailable.
  }

  try {
    const { stdout } = await execAsync("ss -ltnp");
    return findUnixListeningPidInSs(stdout, port);
  } catch {
    return null;
  }
}

export async function findServerPid(port: number): Promise<number | null> {
  return process.platform === "win32" ? findWindowsServerPid(port) : findUnixServerPid(port);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another session/user
    // (e.g. an elevated shell). Treat it as alive so the caller still tries
    // to stop it instead of silently reporting success.
    return (error as NodeJS.ErrnoException).code === "EPERM";
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

async function killWindowsProcess(pid: number, timeoutMs: number): Promise<boolean> {
  try {
    await execAsync(`taskkill /PID ${pid} /T`);
  } catch {
    // Continue with forced stop if the process is still alive.
  }

  if (await waitForProcessExit(pid, timeoutMs)) {
    return true;
  }

  try {
    await execAsync(`taskkill /F /PID ${pid} /T`);
  } catch {
    return !isProcessAlive(pid);
  }

  return waitForProcessExit(pid, timeoutMs);
}

async function killUnixProcess(pid: number, timeoutMs: number): Promise<boolean> {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return !isProcessAlive(pid);
  }

  if (await waitForProcessExit(pid, timeoutMs)) {
    return true;
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return !isProcessAlive(pid);
  }

  return waitForProcessExit(pid, timeoutMs);
}

export async function killServerProcess(pid: number, timeoutMs: number = 5000): Promise<boolean> {
  if (!isProcessAlive(pid)) {
    return true;
  }

  return process.platform === "win32"
    ? killWindowsProcess(pid, timeoutMs)
    : killUnixProcess(pid, timeoutMs);
}
