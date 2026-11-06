import { describe, expect, it, vi } from "vitest";

import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

import {
  clearStandServerPid,
  createOpencodeServeSpawnCommand,
  findUnixListeningPidInSs,
  findWindowsListeningPidInNetstat,
  getOpencodeApiVersion,
  parseOpencodeVersionOutput,
  readNpmShimTarget,
  recordStandServerPid,
  resolvePosixOpencodeExecutable,
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

function withTempOpencodeEnv(
  run: (paths: { pathDir: string; homeExe: string; homeDir: string; tempRoot: string }) => void,
): void {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-telegram-bot-"));
  const pathDir = path.join(tempRoot, "path-bin");
  const homeDir = path.join(tempRoot, "home");
  const homeExe = path.join(homeDir, ".opencode", "bin", "opencode");

  try {
    fs.mkdirSync(pathDir, { recursive: true });
    fs.mkdirSync(path.dirname(homeExe), { recursive: true });
    vi.stubEnv("PATH", pathDir);
    vi.stubEnv("HOME", homeDir);
    vi.stubEnv("OPENCODE_BIN_PATH", "");
    run({ pathDir, homeExe, homeDir, tempRoot });
  } finally {
    vi.unstubAllEnvs();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

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
    if (process.platform === "win32") {
      const command = createOpencodeServeSpawnCommand({ host: "localhost", port: 4987 }, "v1");

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

    withTempOpencodeEnv(({ pathDir }) => {
      fs.writeFileSync(path.join(pathDir, "opencode"), "#!/bin/sh\n", { mode: 0o755 });

      const command = createOpencodeServeSpawnCommand({ host: "localhost", port: 4987 }, "v1");

      expect(command).toEqual({
        command: "opencode",
        args: ["serve", "--port", "4987"],
        windowsHide: false,
      });
    });
  });

  it.skipIf(process.platform === "win32")(
    "resolves opencode from PATH before the installer fallback",
    () => {
      withTempOpencodeEnv(({ pathDir, homeExe }) => {
        fs.writeFileSync(path.join(pathDir, "opencode"), "#!/bin/sh\n", { mode: 0o755 });
        fs.writeFileSync(homeExe, "#!/bin/sh\n", { mode: 0o755 });

        expect(resolvePosixOpencodeExecutable()).toBe("opencode");
      });
    },
  );

  it.skipIf(process.platform === "win32")(
    "falls back to the OpenCode installer directory when PATH has no opencode",
    () => {
      withTempOpencodeEnv(({ homeExe }) => {
        fs.writeFileSync(homeExe, "#!/bin/sh\n", { mode: 0o755 });

        expect(resolvePosixOpencodeExecutable()).toBe(homeExe);
      });
    },
  );

  it.skipIf(process.platform === "win32")(
    "skips a non-executable opencode file on PATH and uses the installer fallback",
    () => {
      withTempOpencodeEnv(({ pathDir, homeExe }) => {
        fs.writeFileSync(path.join(pathDir, "opencode"), "not executable\n", { mode: 0o644 });
        fs.writeFileSync(homeExe, "#!/bin/sh\n", { mode: 0o755 });

        expect(resolvePosixOpencodeExecutable()).toBe(homeExe);
      });
    },
  );

  it.skipIf(process.platform === "win32")(
    "uses OPENCODE_BIN_PATH before PATH and the installer fallback",
    () => {
      withTempOpencodeEnv(({ pathDir, homeExe, tempRoot }) => {
        const customExe = path.join(tempRoot, "custom", "opencode");
        fs.mkdirSync(path.dirname(customExe), { recursive: true });
        fs.writeFileSync(customExe, "#!/bin/sh\n", { mode: 0o755 });
        fs.writeFileSync(path.join(pathDir, "opencode"), "#!/bin/sh\n", { mode: 0o755 });
        fs.writeFileSync(homeExe, "#!/bin/sh\n", { mode: 0o755 });
        vi.stubEnv("OPENCODE_BIN_PATH", customExe);

        expect(resolvePosixOpencodeExecutable()).toBe(customExe);
      });
    },
  );

  it.skipIf(process.platform === "win32")(
    "ignores a non-executable OPENCODE_BIN_PATH and searches the usual places",
    () => {
      withTempOpencodeEnv(({ homeExe, tempRoot }) => {
        const brokenExe = path.join(tempRoot, "custom", "opencode");
        fs.mkdirSync(path.dirname(brokenExe), { recursive: true });
        fs.writeFileSync(brokenExe, "not executable\n", { mode: 0o644 });
        fs.writeFileSync(homeExe, "#!/bin/sh\n", { mode: 0o755 });
        vi.stubEnv("OPENCODE_BIN_PATH", brokenExe);

        expect(resolvePosixOpencodeExecutable()).toBe(homeExe);
      });
    },
  );

  it.skipIf(process.platform === "win32")(
    "ignores a relative OPENCODE_BIN_PATH so spawn cannot pick another executable",
    () => {
      withTempOpencodeEnv(({ homeExe }) => {
        fs.writeFileSync(homeExe, "#!/bin/sh\n", { mode: 0o755 });
        const relativeExe = path.relative(process.cwd(), process.execPath);
        vi.stubEnv("OPENCODE_BIN_PATH", relativeExe);

        expect(resolvePosixOpencodeExecutable()).toBe(homeExe);
      });
    },
  );

  it.skipIf(process.platform === "win32")(
    "finds opencode in the package managers' global bin directories",
    () => {
      const packageManagerDirs = [
        path.join(".bun", "bin"),
        path.join(".local", "share", "pnpm"),
        path.join("Library", "pnpm"),
        path.join(".yarn", "bin"),
        path.join(".config", "yarn", "global", "bin"),
      ];

      withTempOpencodeEnv(({ homeDir }) => {
        for (const relativeDir of packageManagerDirs) {
          const candidate = path.join(homeDir, relativeDir, "opencode");
          fs.mkdirSync(path.dirname(candidate), { recursive: true });
          fs.writeFileSync(candidate, "#!/bin/sh\n", { mode: 0o755 });

          try {
            expect(resolvePosixOpencodeExecutable()).toBe(candidate);
          } finally {
            fs.rmSync(candidate);
          }
        }
      });
    },
  );

  it.skipIf(process.platform === "win32")(
    "builds the serve command from the installer fallback when PATH has no opencode",
    () => {
      withTempOpencodeEnv(({ homeExe }) => {
        fs.writeFileSync(homeExe, "#!/bin/sh\n", { mode: 0o755 });

        const command = createOpencodeServeSpawnCommand({ host: "localhost", port: 4987 }, "v1");

        expect(command).toEqual({
          command: homeExe,
          args: ["serve", "--port", "4987"],
          windowsHide: false,
        });
      });
    },
  );

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

  it("starts the registered background server for OpenCode V2 service mode", () => {
    const command = createOpencodeServeSpawnCommand(
      { host: "127.0.0.1", port: 4097 },
      "v2",
      "service",
    );

    expect(command.args.slice(-4)).toEqual(["serve", "--service", "--port", "4097"]);
  });

  it("starts a plain server for OpenCode V2 standalone mode", () => {
    const command = createOpencodeServeSpawnCommand(
      { host: "127.0.0.1", port: 4097 },
      "v2",
      "standalone",
    );

    expect(command.args.slice(-3)).toEqual(["serve", "--port", "4097"]);
    expect(command.args).not.toContain("--service");
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

  it("records and clears only the stand server pid the launcher asked for", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-telegram-bot-"));
    const pidFile = path.join(tempRoot, "opencode-server.pid");
    const previous = process.env.OPENCODE_STAND_PID_FILE;

    try {
      process.env.OPENCODE_STAND_PID_FILE = pidFile;
      recordStandServerPid(4242);
      expect(fs.readFileSync(pidFile, "utf8").trim()).toBe("4242");

      clearStandServerPid(111);
      expect(fs.existsSync(pidFile)).toBe(true);

      clearStandServerPid(4242);
      expect(fs.existsSync(pidFile)).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env.OPENCODE_STAND_PID_FILE;
      } else {
        process.env.OPENCODE_STAND_PID_FILE = previous;
      }
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
