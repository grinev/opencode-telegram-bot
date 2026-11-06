import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createTestHome, ensureTestEnvironment } from "./test-environment.js";

async function snapshot(directory: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      for (const [name, content] of Object.entries(await snapshot(file))) {
        result[path.join(entry.name, name)] = content;
      }
      result[entry.name] = "directory";
    } else {
      result[entry.name] = (await fs.readFile(file)).toString("base64");
    }
  }
  return result;
}

describe("test app-home isolation", () => {
  it("replaces inherited homes, admits only owned homes, and survives module resets", async () => {
    const unowned = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-unowned-"));
    const owned = await createTestHome("opencode-owned-");
    try {
      vi.stubEnv("OPENCODE_TELEGRAM_HOME", unowned);
      ensureTestEnvironment();
      expect(process.env.OPENCODE_TELEGRAM_HOME).not.toBe(unowned);

      vi.stubEnv("OPENCODE_TELEGRAM_HOME", owned);
      let paths = await import("../../src/runtime/paths.js");
      expect(paths.getRuntimePaths().appHome).toBe(owned);

      vi.resetModules();
      paths = await import("../../src/runtime/paths.js");
      expect(paths.getRuntimePaths().appHome).toBe(owned);

      vi.stubEnv("OPENCODE_TELEGRAM_HOME", unowned);
      vi.restoreAllMocks();
      expect(paths.getRuntimePaths().appHome).not.toBe(unowned);
      expect(await snapshot(unowned)).toEqual({});
    } finally {
      await fs.rm(unowned, { recursive: true, force: true });
      await fs.rm(owned, { recursive: true, force: true });
    }
  });

  it.each(["win32", "darwin", "linux"] as const)(
    "leaves sandbox user profiles untouched on %s through migrations and env restoration",
    async (platform) => {
      // Deliberately not registered: these stand in for user-owned profiles.
      const profile = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-user-profile-"));
      const actualPlatform = process.platform;
      const appData = path.join(profile, "AppData", "Roaming");
      const xdg = path.join(profile, ".config");
      const sourceHome = path.join(profile, "source");
      const customHome = path.join(profile, "custom");
      const installedHome = path.join(
        platform === "win32"
          ? appData
          : platform === "darwin"
            ? path.join(profile, "Library", "Application Support")
            : xdg,
        "opencode-telegram-bot",
      );
      const owned = await createTestHome("opencode-isolation-migration-");
      for (const home of [installedHome, sourceHome, customHome]) {
        await fs.mkdir(path.join(home, "run"), { recursive: true });
        await fs.mkdir(path.join(home, "logs"), { recursive: true });
        await fs.mkdir(path.join(home, "local-commands"));
        await fs.writeFile(path.join(home, "settings.json"), '{"pinnedMessageId":172}');
        await fs.writeFile(path.join(home, "settings.json.bak"), '{"currentAgent":"build"}');
        await fs.writeFile(path.join(home, ".env"), "CUSTOM_SENTINEL=keep\n");
        await fs.writeFile(path.join(home, "logs", "sentinel.log"), "keep log\n");
        await fs.writeFile(path.join(home, "run", "bot-service.json"), '{"pid":172}');
        await fs.writeFile(path.join(home, "local-commands", "sentinel.md"), "keep command\n");
      }
      const before = await snapshot(profile);
      try {
        Object.defineProperty(process, "platform", { value: platform, configurable: true });
        vi.spyOn(os, "homedir").mockReturnValue(profile);
        vi.spyOn(process, "cwd").mockReturnValue(sourceHome);
        vi.stubEnv("APPDATA", appData);
        vi.stubEnv("XDG_CONFIG_HOME", xdg);
        vi.stubEnv("OPENCODE_TELEGRAM_HOME", customHome);

        for (const oldValue of [false, true]) {
          vi.resetModules();
          const store = await import("../../src/app/stores/settings-store.js");
          vi.stubEnv("OPENCODE_TELEGRAM_HOME", owned);
          await fs.writeFile(
            path.join(owned, "settings.json"),
            JSON.stringify({ ttsEnabled: oldValue }),
          );
          await store.loadSettings();
          await store.flushSettings();
          expect(store.getTtsMode()).toBe(oldValue ? "all" : "off");
          store.__resetSettingsForTests();

          for (const mode of ["installed", "sources"]) {
            vi.stubEnv("OPENCODE_TELEGRAM_RUNTIME_MODE", mode);
            delete process.env.OPENCODE_TELEGRAM_HOME;
            store.setCompactOutputMode(true);
            await store.flushSettings();
          }
          // Restoring an inherited override is not permission to write there.
          vi.stubEnv("OPENCODE_TELEGRAM_HOME", customHome);
          store.setShowThinkingContent(false);
          await store.flushSettings();
          const log = await import("../../src/utils/logger.js");
          await log.initializeLogger();
          log.logger.error("sandbox isolation sentinel");
          await log.flushLogger();
          log.__resetLoggerForTests();
        }
        expect(await snapshot(profile)).toEqual(before);
      } finally {
        Object.defineProperty(process, "platform", { value: actualPlatform, configurable: true });
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
        await fs.rm(profile, { recursive: true, force: true });
        await fs.rm(owned, { recursive: true, force: true });
      }
    },
  );
});
