import dotenv from "dotenv";
import * as os from "os";
import * as path from "path";
import { getRuntimePaths } from "./runtime/paths.js";

const runtimePaths = getRuntimePaths();
dotenv.config({ path: runtimePaths.envFilePath });

function getEnvVar(key: string, required: boolean = true): string {
  const value = process.env[key];
  if (required && !value) {
    throw new Error(
      `Missing required environment variable: ${key} (expected in ${runtimePaths.envFilePath})`,
    );
  }
  return value || "";
}

function getOptionalPositiveIntEnvVar(key: string, defaultValue: number): number {
  const value = getEnvVar(key, false);

  if (!value) {
    return defaultValue;
  }

  const parsedValue = Number.parseInt(value, 10);
  if (Number.isNaN(parsedValue) || parsedValue <= 0) {
    return defaultValue;
  }

  return parsedValue;
}

function getOptionalLocaleEnvVar(key: string, defaultValue: "en" | "ru"): "en" | "ru" {
  const value = getEnvVar(key, false);

  if (!value) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase().split("-")[0];
  if (normalized === "ru") {
    return "ru";
  }

  if (normalized === "en") {
    return "en";
  }

  return defaultValue;
}

function getDefaultMediaDir(): string {
  const envMediaDir = getEnvVar("MEDIA_DIR", false);
  if (envMediaDir) {
    return envMediaDir;
  }

  const tmpDir = os.tmpdir();
  return path.join(tmpDir, "opencode-telegram-bot", "media");
}

export const envFilePath = runtimePaths.envFilePath;

export const config = {
  telegram: {
    token: getEnvVar("TELEGRAM_BOT_TOKEN"),
    allowedUserId: parseInt(getEnvVar("TELEGRAM_ALLOWED_USER_ID"), 10),
  },
  opencode: {
    apiUrl: getEnvVar("OPENCODE_API_URL", false) || "http://localhost:4096",
    username: getEnvVar("OPENCODE_SERVER_USERNAME", false) || "opencode",
    password: getEnvVar("OPENCODE_SERVER_PASSWORD", false),
    model: {
      provider: getEnvVar("OPENCODE_MODEL_PROVIDER", true), // Required
      modelId: getEnvVar("OPENCODE_MODEL_ID", true), // Required
    },
  },
  server: {
    logLevel: getEnvVar("LOG_LEVEL", false) || "info",
  },
  bot: {
    sessionsListLimit: getOptionalPositiveIntEnvVar("SESSIONS_LIST_LIMIT", 10),
    locale: getOptionalLocaleEnvVar("BOT_LOCALE", "en"),
  },
  files: {
    maxFileSizeKb: parseInt(getEnvVar("CODE_FILE_MAX_SIZE_KB", false) || "100", 10),
  },
  media: {
    dir: getDefaultMediaDir(),
  },
  transcription: {
    command: getEnvVar("TRANSCRIBE_VOICE_COMMAND", false) || "",
  },
};
