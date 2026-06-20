import dotenv from "dotenv";
import { getRuntimePaths } from "./runtime/paths.js";
import { normalizeLocale, type Locale } from "./i18n/index.js";

const runtimePaths = getRuntimePaths();
dotenv.config({ path: runtimePaths.envFilePath, quiet: true });

export type MessageFormatMode = "raw" | "markdown";
export type StreamingMode = "edit" | "draft";
export type TtsProvider = "openai" | "google" | "elevenlabs";

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

function getOptionalLocaleEnvVar(key: string, defaultValue: Locale): Locale {
  const value = getEnvVar(key, false);
  return normalizeLocale(value, defaultValue);
}

function getOptionalBooleanEnvVar(key: string, defaultValue: boolean): boolean {
  const value = getEnvVar(key, false);

  if (!value) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

function getOptionalStreamingModeEnvVar(
  key: string,
  defaultValue: StreamingMode,
): StreamingMode {
  const value = getEnvVar(key, false);

  if (!value) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "edit" || normalized === "draft") {
    return normalized;
  }

  return defaultValue;
}

function getOptionalMessageFormatModeEnvVar(
  key: string,
  defaultValue: MessageFormatMode,
): MessageFormatMode {
  const value = getEnvVar(key, false);

  if (!value) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "raw" || normalized === "markdown") {
    return normalized;
  }

  return defaultValue;
}

const VALID_TTS_PROVIDERS: TtsProvider[] = ["openai", "google", "elevenlabs"];

function getOptionalTtsProviderEnvVar(key: string, defaultValue: TtsProvider): TtsProvider {
  const value = getEnvVar(key, false);

  if (!value) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (VALID_TTS_PROVIDERS.includes(normalized as TtsProvider)) {
    return normalized as TtsProvider;
  }

  return defaultValue;
}

export function buildTelegramConfig(): {
  token: string;
  allowedUserId: number;
  proxyUrl: string;
  apiRoot: string;
  proxySecret: string;
  forceIpv4: boolean;
} {
  const proxyUrl = getEnvVar("TELEGRAM_PROXY_URL", false);
  // grammY rejects an apiRoot ending with `/`, so normalize once at config
  // load instead of leaking the concern into every consumer.
  const apiRoot = getEnvVar("TELEGRAM_API_ROOT", false).replace(/\/+$/, "");
  const proxySecret = getEnvVar("TELEGRAM_PROXY_SECRET", false);
  const forceIpv4 = getOptionalBooleanEnvVar("TELEGRAM_FORCE_IPV4", false);

  if (proxyUrl && apiRoot) {
    throw new Error(
      "TELEGRAM_PROXY_URL and TELEGRAM_API_ROOT are alternative connectivity modes and cannot be used together. " +
        "TELEGRAM_PROXY_URL tunnels TCP through a SOCKS/HTTP forward proxy; " +
        "TELEGRAM_API_ROOT routes API calls through an HTTPS reverse proxy. Pick one.",
    );
  }
  if (proxySecret && !apiRoot) {
    throw new Error(
      "TELEGRAM_PROXY_SECRET requires TELEGRAM_API_ROOT to be set. " +
        "Without a custom API root, the secret header would be sent to api.telegram.org.",
    );
  }

  return {
    token: getEnvVar("TELEGRAM_BOT_TOKEN"),
    allowedUserId: parseInt(getEnvVar("TELEGRAM_ALLOWED_USER_ID"), 10),
    proxyUrl,
    apiRoot,
    proxySecret,
    forceIpv4,
  };
}

export const config = {
  telegram: buildTelegramConfig(),
  opencode: {
    apiUrl: getEnvVar("OPENCODE_API_URL", false) || "http://localhost:4096",
    username: getEnvVar("OPENCODE_SERVER_USERNAME", false) || "opencode",
    password: getEnvVar("OPENCODE_SERVER_PASSWORD", false),
    autoRestartEnabled: getOptionalBooleanEnvVar("OPENCODE_AUTO_RESTART_ENABLED", false),
    monitorIntervalSec: getOptionalPositiveIntEnvVar("OPENCODE_MONITOR_INTERVAL_SEC", 300),
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
    messagesListLimit: getOptionalPositiveIntEnvVar("MESSAGES_LIST_LIMIT", 10),
    projectsListLimit: getOptionalPositiveIntEnvVar("PROJECTS_LIST_LIMIT", 10),
    commandsListLimit: getOptionalPositiveIntEnvVar("COMMANDS_LIST_LIMIT", 10),
    taskLimit: getOptionalPositiveIntEnvVar("TASK_LIMIT", 10),
    scheduledTaskExecutionTimeoutMinutes: getOptionalPositiveIntEnvVar(
      "SCHEDULED_TASK_EXECUTION_TIMEOUT_MINUTES",
      120,
    ),
    scheduledTaskNotificationsSilent: getOptionalBooleanEnvVar(
      "SCHEDULED_TASK_DISABLE_NOTIFICATION",
      false,
    ),
    responseStreamThrottleMs: getOptionalPositiveIntEnvVar("RESPONSE_STREAM_THROTTLE_MS", 1000),
    responseStreamingMode: getOptionalStreamingModeEnvVar("RESPONSE_STREAMING_MODE", "edit"),
    bashToolDisplayMaxLength: getOptionalPositiveIntEnvVar("BASH_TOOL_DISPLAY_MAX_LENGTH", 128),
    locale: getOptionalLocaleEnvVar("BOT_LOCALE", "en"),
    hideThinkingMessages: getOptionalBooleanEnvVar("HIDE_THINKING_MESSAGES", false),
    showThinkingContent: getOptionalBooleanEnvVar("SHOW_THINKING_CONTENT", false),
    hideToolCallMessages: getOptionalBooleanEnvVar("HIDE_TOOL_CALL_MESSAGES", false),
    hideToolFileMessages: getOptionalBooleanEnvVar("HIDE_TOOL_FILE_MESSAGES", false),
    trackBackgroundSessions: getOptionalBooleanEnvVar("TRACK_BACKGROUND_SESSIONS", true),
    messageFormatMode: getOptionalMessageFormatModeEnvVar("MESSAGE_FORMAT_MODE", "markdown"),
  },
  files: {
    maxFileSizeKb: parseInt(getEnvVar("CODE_FILE_MAX_SIZE_KB", false) || "100", 10),
  },
  open: {
    browserRoots: getEnvVar("OPEN_BROWSER_ROOTS", false),
  },
  stt: {
    apiUrl: getEnvVar("STT_API_URL", false),
    apiKey: getEnvVar("STT_API_KEY", false),
    model: getEnvVar("STT_MODEL", false) || "whisper-large-v3-turbo",
    language: getEnvVar("STT_LANGUAGE", false),
    notePrompt: getEnvVar("STT_NOTE_PROMPT", false),
  },
  tts: (() => {
    const provider = getOptionalTtsProviderEnvVar("TTS_PROVIDER", "openai");
    const defaultVoice =
      provider === "google"
        ? "en-US-Studio-O"
        : provider === "elevenlabs"
          ? "21m00Tcm4TlvDq8ikWAM"
          : "alloy";
    const defaultModel =
      provider === "elevenlabs" ? "eleven_flash_v2_5" : "gpt-4o-mini-tts";
    return {
      apiUrl: getEnvVar("TTS_API_URL", false),
      apiKey: getEnvVar("TTS_API_KEY", false),
      provider,
      model: getEnvVar("TTS_MODEL", false) || defaultModel,
      voice: getEnvVar("TTS_VOICE", false) || defaultVoice,
    };
  })(),
};
