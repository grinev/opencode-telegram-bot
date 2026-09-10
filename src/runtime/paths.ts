import path from "bun:path";
import { getRuntimeMode, type RuntimeMode } from "./mode.js";

export interface RuntimePaths {
  mode: RuntimeMode;
  appHome: string;
  envFilePath: string;
  settingsFilePath: string;
  logsDirPath: string;
  runDirPath: string;
  localCommandsDirPath: string;
}

const APP_DIR_NAME = "opencode-telegram-bot";

function getHomeDirectory(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? "";
}

function getInstalledAppHome(): string {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(getHomeDirectory(), "AppData", "Roaming");
    return path.join(appData, APP_DIR_NAME);
  }

  if (process.platform === "darwin") {
    return path.join(getHomeDirectory(), "Library", "Application Support", APP_DIR_NAME);
  }

  const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(getHomeDirectory(), ".config");
  return path.join(xdgConfigHome, APP_DIR_NAME);
}

function resolveAppHome(mode: RuntimeMode): string {
  const homeOverride = process.env.OPENCODE_TELEGRAM_HOME;
  if (homeOverride && homeOverride.trim().length > 0) {
    return path.resolve(homeOverride);
  }

  if (mode === "sources") {
    return process.cwd();
  }

  return getInstalledAppHome();
}

export function getRuntimePaths(): RuntimePaths {
  const mode = getRuntimeMode();
  const appHome = resolveAppHome(mode);

  return {
    mode,
    appHome,
    envFilePath: path.join(appHome, ".env"),
    settingsFilePath: path.join(appHome, "settings.json"),
    logsDirPath: path.join(appHome, "logs"),
    runDirPath: path.join(appHome, "run"),
    localCommandsDirPath: path.join(appHome, "local-commands"),
  };
}
