import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setRuntimeMode } from "../../src/runtime/mode.js";

// Resolver contracts are read-only; application modules keep the isolation boundary.
const { getRuntimePaths } = await vi.importActual<typeof import("../../src/runtime/paths.js")>(
  "../../src/runtime/paths.js",
);

function setPlatform(platform: NodeJS.Platform): () => void {
  const originalPlatform = process.platform;
  Object.defineProperty(process, "platform", { value: platform, configurable: true });

  return () => {
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  };
}

describe("runtime/paths", () => {
  beforeEach(() => {
    delete process.env.OPENCODE_TELEGRAM_HOME;
    delete process.env.APPDATA;
    setRuntimeMode("sources");
  });

  afterEach(() => {
    delete process.env.OPENCODE_TELEGRAM_RUNTIME_MODE;
    vi.unstubAllEnvs();
  });

  it("uses process cwd in sources mode", () => {
    setRuntimeMode("sources");

    const runtimePaths = getRuntimePaths();

    expect(runtimePaths.mode).toBe("sources");
    expect(runtimePaths.appHome).toBe(process.cwd());
    expect(runtimePaths.envFilePath).toBe(path.join(process.cwd(), ".env"));
    expect(runtimePaths.settingsFilePath).toBe(path.join(process.cwd(), "settings.json"));
    expect(runtimePaths.logsDirPath).toBe(path.join(process.cwd(), "logs"));
  });

  it("uses OPENCODE_TELEGRAM_HOME when override is set", () => {
    const customHome = path.join(process.cwd(), ".tmp", "runtime-home");
    setRuntimeMode("installed");
    vi.stubEnv("OPENCODE_TELEGRAM_HOME", customHome);

    const runtimePaths = getRuntimePaths();

    expect(runtimePaths.mode).toBe("installed");
    expect(runtimePaths.appHome).toBe(path.resolve(customHome));
    expect(runtimePaths.runDirPath).toBe(path.join(path.resolve(customHome), "run"));
  });

  it("resolves windows installed home via APPDATA", () => {
    const restorePlatform = setPlatform("win32");
    vi.stubEnv("APPDATA", "C:\\Users\\test\\AppData\\Roaming");
    setRuntimeMode("installed");

    try {
      const runtimePaths = getRuntimePaths();

      expect(runtimePaths.mode).toBe("installed");
      expect(runtimePaths.appHome).toBe(
        path.join("C:\\Users\\test\\AppData\\Roaming", "opencode-telegram-bot"),
      );
      expect(runtimePaths.logsDirPath).toBe(path.join(runtimePaths.appHome, "logs"));
    } finally {
      restorePlatform();
    }
  });
});
