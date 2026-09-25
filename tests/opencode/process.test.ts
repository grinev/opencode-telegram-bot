import { describe, expect, it } from "vitest";

import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

import {
  createOpencodeServeSpawnCommand,
  findUnixListeningPidInSs,
  findWindowsListeningPidInNetstat,
  getOpencodeApiVersion,
  parseOpencodeVersionOutput,
  readNpmShimTarget,
} from "../../src/opencode/process.js";

const V2_NPM_SHIM = [
  "@ECHO off",
  "GOTO start",
  ":find_dp0",
  "SET dp0=%~dp0",
  "EXIT /b",
  ":start",
  "SETLOCAL",
  "CALL :find_dp0",
  '"%dp0%\\node_modules\\@opencode\\cli\\bin\\opencode.exe"   %*',
  "",
].join("\r\n");

describe("opencode/process", () => {
  it("matches the exact local port on Windows netstat output", async () => {
    const stdout = [
      "  TCP    127.0.0.1:40960      0.0.0.0:0      LISTENING       1111",
      "  TCP    127.0.0.1:4096       0.0.0.0:0      LISTENING       2222",
    ].join("\r\n");

    expect(findWindowsListeningPidInNetstat(stdout, 4096)).toBe(2222);
  });

  it("matches the exact local port in ss fallback output", async () => {
    const stdout = [
      'LISTEN 0 128 127.0.0.1:40960 0.0.0.0:* users:(("node",pid=1111,fd=17))',
      'LISTEN 0 128 127.0.0.1:4096 0.0.0.0:* users:(("opencode",pid=2222,fd=18))',
    ].join("\n");

    expect(findUnixListeningPidInSs(stdout, 4096)).toBe(2222);
  });

  it("builds opencode serve command with the configured local port", () => {
    const command = createOpencodeServeSpawnCommand({ host: "localhost", port: 4987 }, "v1");

    if (process.platform === "win32") {
      expect(command.windowsHide).toBe(true);

      // If we claim to spawn opencode.exe directly, it must be a real absolute path.
      // Otherwise, spawn() will likely fail with ENOENT on default npm installs where
      // only opencode.cmd is on PATH.
      if (command.command.toLowerCase() === "cmd.exe") {
        expect(command.args).toEqual(["/c", "opencode", "serve", "--port", "4987"]);
      } else {
        expect(path.isAbsolute(command.command)).toBe(true);
        expect(command.command.toLowerCase().endsWith("\\opencode.exe")).toBe(true);
        expect(command.args).toEqual(["serve", "--port", "4987"]);
      }
      return;
    }

    expect(command).toEqual({
      command: "opencode",
      args: ["serve", "--port", "4987"],
      windowsHide: false,
    });
  });

  it("falls back to cmd.exe on Windows when opencode.exe cannot be resolved", () => {
    if (process.platform !== "win32") {
      return;
    }

    const originalPath = process.env.PATH;

    try {
      process.env.PATH = "";

      const command = createOpencodeServeSpawnCommand({ host: "localhost", port: 4987 }, "v1");
      expect(command).toEqual({
        command: "cmd.exe",
        args: ["/c", "opencode", "serve", "--port", "4987"],
        windowsHide: true,
      });
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it("resolves opencode.exe directly from PATH when no .cmd shim exists", () => {
    if (process.platform !== "win32") {
      return;
    }

    const originalPath = process.env.PATH;
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-telegram-bot-"));
    const binDir = path.join(tempRoot, "bin");
    const exePath = path.join(binDir, "opencode.exe");

    try {
      fs.mkdirSync(binDir, { recursive: true });
      fs.writeFileSync(exePath, "", "utf8");

      // Isolate PATH to only the temp dir — no npm .cmd shim on PATH
      process.env.PATH = binDir;

      const command = createOpencodeServeSpawnCommand({ host: "localhost", port: 4987 }, "v1");
      expect(command).toEqual({
        command: exePath,
        args: ["serve", "--port", "4987"],
        windowsHide: true,
      });
    } finally {
      process.env.PATH = originalPath;
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("uses resolved opencode.exe on Windows when opencode.cmd is on PATH and exe exists", () => {
    if (process.platform !== "win32") {
      return;
    }

    const originalPath = process.env.PATH;
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-telegram-bot-"));
    const binDir = path.join(tempRoot, "bin");
    const exePath = path.join(binDir, "node_modules", "opencode-ai", "bin", "opencode.exe");
    const cmdPath = path.join(binDir, "opencode.cmd");

    try {
      fs.mkdirSync(path.dirname(exePath), { recursive: true });
      fs.writeFileSync(exePath, "", "utf8");
      fs.writeFileSync(cmdPath, "@echo off\r\nexit /b 0\r\n", "utf8");

      process.env.PATH = [binDir, originalPath].filter(Boolean).join(path.delimiter);

      const command = createOpencodeServeSpawnCommand({ host: "localhost", port: 4987 }, "v1");
      expect(command).toEqual({
        command: exePath,
        args: ["serve", "--port", "4987"],
        windowsHide: true,
      });
    } finally {
      process.env.PATH = originalPath;
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("starts the registered background server for OpenCode V2", () => {
    const command = createOpencodeServeSpawnCommand({ host: "127.0.0.1", port: 4097 }, "v2");

    expect(command.args.slice(-4)).toEqual(["serve", "--service", "--port", "4097"]);
  });

  it("reads the exe an npm shim runs", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-telegram-bot-"));
    const cmdPath = path.join(tempRoot, "opencode.cmd");

    try {
      fs.writeFileSync(cmdPath, V2_NPM_SHIM, "utf8");

      expect(readNpmShimTarget(cmdPath)).toBe(
        path.join(tempRoot, "node_modules", "@opencode", "cli", "bin", "opencode.exe"),
      );
      expect(readNpmShimTarget(path.join(tempRoot, "missing.cmd"))).toBeNull();
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("follows the opencode shim to V2 on Windows even when V1 is installed next to it", () => {
    if (process.platform !== "win32") {
      return;
    }

    const originalPath = process.env.PATH;
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-telegram-bot-"));
    const binDir = path.join(tempRoot, "bin");
    const v1Exe = path.join(binDir, "node_modules", "opencode-ai", "bin", "opencode.exe");
    const v2Exe = path.join(binDir, "node_modules", "@opencode", "cli", "bin", "opencode.exe");

    try {
      for (const exe of [v1Exe, v2Exe]) {
        fs.mkdirSync(path.dirname(exe), { recursive: true });
        fs.writeFileSync(exe, "", "utf8");
      }
      fs.writeFileSync(path.join(binDir, "opencode.cmd"), V2_NPM_SHIM, "utf8");
      process.env.PATH = binDir;

      const command = createOpencodeServeSpawnCommand({ host: "localhost", port: 4987 }, "v2");
      expect(command.command).toBe(v2Exe);
    } finally {
      process.env.PATH = originalPath;
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("reads the version from opencode --version output of both releases", () => {
    expect(parseOpencodeVersionOutput("opencode v2.0.16\n")).toBe("2.0.16");
    expect(parseOpencodeVersionOutput("1.18.32\r\n")).toBe("1.18.32");
    expect(parseOpencodeVersionOutput("command not found")).toBeNull();
  });

  it("maps OpenCode releases to their API version", () => {
    expect(getOpencodeApiVersion("2.0.16")).toBe("v2");
    expect(getOpencodeApiVersion("1.18.32")).toBe("v1");
    expect(getOpencodeApiVersion("0.15.0")).toBe("v1");
  });
});
