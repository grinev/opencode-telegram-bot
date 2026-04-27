import { exec, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
const DEFAULT_OPENCODE_PORT = 4096;
const PROCESS_EXIT_POLL_MS = 100;

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

export function createOpencodeServeSpawnCommand(
  target: LocalOpencodeTarget,
): OpencodeServeSpawnCommand {
  const isWindows = process.platform === "win32";
  const port = target.port.toString();

  return {
    command: isWindows ? "cmd.exe" : "opencode",
    args: isWindows ? ["/c", "opencode", "serve", "--port", port] : ["serve", "--port", port],
    windowsHide: isWindows,
  };
}

export function startLocalOpencodeServer(target: LocalOpencodeTarget): ChildProcess {
  const spawnCommand = createOpencodeServeSpawnCommand(target);

  return spawn(spawnCommand.command, spawnCommand.args, {
    detached: true,
    stdio: "ignore",
    windowsHide: spawnCommand.windowsHide,
  });
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

  const port = Number.parseInt(match[1], 10);
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
    const pid = pidMatch ? parsePid(pidMatch[1]) : null;
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
