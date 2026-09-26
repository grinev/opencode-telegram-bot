import { exec, execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import type { OpencodeServerVersion } from "../config.js";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const DEFAULT_OPENCODE_PORT = 4096;
const PROCESS_EXIT_POLL_MS = 100;
const VERSION_READ_TIMEOUT_MS = 10_000;

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

/** The exe an npm `.cmd` shim runs, e.g. `"%dp0%\node_modules\@opencode\cli\bin\opencode.exe"`. */
export function readNpmShimTarget(shimPath: string): string | null {
  try {
    const match = /"%~?dp0%?\\([^"]+?\.exe)"/i.exec(readFileSync(shimPath, "utf8"));
    const relativeTarget = match?.[1];
    return relativeTarget ? path.join(path.dirname(shimPath), ...relativeTarget.split("\\")) : null;
  } catch {
    return null;
  }
}

function resolveWindowsOpencodeExe(): string {
  const pathEnv = process.env.PATH ?? "";
  const pathEntries = pathEnv.split(path.delimiter).filter(Boolean);

  // First pass: look for opencode.exe directly on PATH.
  // Covers non-npm installations (install script, scoop, choco, manual download, etc.).
  for (const entry of pathEntries) {
    const candidateExe = path.join(entry, "opencode.exe");
    if (existsSync(candidateExe)) {
      return candidateExe;
    }
  }

  // Second pass: look for opencode.cmd (npm global install).
  // Follow the shim to the exe it runs: V1 (opencode-ai) and V2 (@opencode/cli) both
  // install an `opencode` shim, so the package cannot be guessed from the name.
  for (const entry of pathEntries) {
    const opencodeCmd = path.join(entry, "opencode.cmd");
    if (!existsSync(opencodeCmd)) {
      continue;
    }

    const shimTarget = readNpmShimTarget(opencodeCmd);
    if (shimTarget && existsSync(shimTarget)) {
      return shimTarget;
    }

    const candidateExe = path.join(entry, "node_modules", "opencode-ai", "bin", "opencode.exe");
    if (existsSync(candidateExe)) {
      return candidateExe;
    }

    // Found the shim but not the exe where it usually lives. Stop searching.
    break;
  }

  return "";
}

/** The local `opencode` executable with the given arguments, resolved per platform. */
function createOpencodeCommand(args: string[]): OpencodeServeSpawnCommand {
  if (process.platform === "win32") {
    const resolvedExe = resolveWindowsOpencodeExe();

    if (resolvedExe) {
      return { command: resolvedExe, args, windowsHide: true };
    }

    // Safe fallback: works with default npm installs where only opencode.cmd is on PATH.
    return { command: "cmd.exe", args: ["/c", "opencode", ...args], windowsHide: true };
  }

  return { command: "opencode", args, windowsHide: false };
}

/**
 * V1 runs a plain server; V2 runs the registered background server (`--service`) so a
 * regular V2 CLI connects to it. The port applies to this launch only.
 */
export function createOpencodeServeSpawnCommand(
  target: LocalOpencodeTarget,
  version: OpencodeServerVersion,
): OpencodeServeSpawnCommand {
  const port = target.port.toString();
  const serveArgs = version === "v2" ? ["serve", "--service"] : ["serve"];
  return createOpencodeCommand([...serveArgs, "--port", port]);
}

export function parseOpencodeVersionOutput(stdout: string): string | null {
  return /(\d+\.\d+\.\d+)/.exec(stdout)?.[1] ?? null;
}

/** OpenCode 2.x serves the V2 API; earlier releases serve V1. */
export function getOpencodeApiVersion(version: string): OpencodeServerVersion {
  const major = Number.parseInt(version, 10);
  return major >= 2 ? "v2" : "v1";
}

/** Version of the local `opencode` executable, or null when it cannot be read. */
export async function readLocalOpencodeVersion(): Promise<string | null> {
  const versionCommand = createOpencodeCommand(["--version"]);
  try {
    const { stdout } = await execFileAsync(versionCommand.command, versionCommand.args, {
      timeout: VERSION_READ_TIMEOUT_MS,
      windowsHide: versionCommand.windowsHide,
    });
    return parseOpencodeVersionOutput(stdout);
  } catch {
    return null;
  }
}

export function startLocalOpencodeServer(
  target: LocalOpencodeTarget,
  version: OpencodeServerVersion,
): ChildProcess {
  const spawnCommand = createOpencodeServeSpawnCommand(target, version);

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
