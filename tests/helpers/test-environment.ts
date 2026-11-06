import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RuntimePaths } from "../../src/runtime/paths.js";

const state = globalThis as typeof globalThis & {
  __opencodeTestHomes?: { defaultHome: string; homes: Set<string> };
};
// Module resets must not forget ownership or adopt a restored user environment.
const homes = (state.__opencodeTestHomes ??= {
  defaultHome: fs.mkdtempSync(path.join(os.tmpdir(), "opencode-telegram-tests-")),
  homes: new Set<string>(),
});
homes.homes.add(homes.defaultHome);

export async function createTestHome(prefix: string): Promise<string> {
  const home = await fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
  homes.homes.add(home);
  return home;
}

export function isolateRuntimePaths(paths: RuntimePaths): RuntimePaths {
  if (homes.homes.has(paths.appHome)) {
    return paths;
  }
  const appHome = homes.defaultHome;
  return {
    ...paths,
    appHome,
    envFilePath: path.join(appHome, ".env"),
    settingsFilePath: path.join(appHome, "settings.json"),
    logsDirPath: path.join(appHome, "logs"),
    runDirPath: path.join(appHome, "run"),
    localCommandsDirPath: path.join(appHome, "local-commands"),
  };
}

const TEST_ENV_DEFAULTS: Record<string, string> = {
  TELEGRAM_BOT_TOKEN: "test-telegram-token",
  TELEGRAM_ALLOWED_USER_ID: "123456789",
  OPENCODE_API_URL: "http://localhost:4096",
  OPENCODE_MODEL_PROVIDER: "test-provider",
  OPENCODE_MODEL_ID: "test-model",
  LOG_LEVEL: "error",
  LOG_RETENTION: "10",
  OPENCODE_TELEGRAM_HOME: homes.defaultHome,
};

export function ensureTestEnvironment(): void {
  process.env.OPENCODE_TELEGRAM_HOME = homes.defaultHome;
  for (const [key, value] of Object.entries(TEST_ENV_DEFAULTS)) {
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}
