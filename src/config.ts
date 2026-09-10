import { readFileSync } from "fs";
import { getRuntimePaths } from "./runtime/paths.js";
import { normalizeLocale, type Locale } from "./i18n/index.js";

const runtimePaths = getRuntimePaths();

// Load .env file — synchronous replacement for dotenv.config()
// Uses bun's built-in node:fs compat (no npm dependency needed).
try {
  const envContent = readFileSync(runtimePaths.envFilePath, "utf-8");
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if (
      value.length >= 2 &&
      ((value[0] === '"' && value[value.length - 1] === '"') ||
        (value[0] === "'" && value[value.length - 1] === "'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
} catch {
  // .env file not found or unreadable — proceed with process.env as-is
}

type EnvRecord = Record<string, string | undefined>;

export type MessageFormatMode = "raw" | "markdown";
export type StreamingMode = "edit" | "draft";
export type TtsProvider = "openai" | "google" | "elevenlabs" | "edge";
export type SttRequestFormat = "multipart" | "json";

function getEnvVar(env: EnvRecord, key: string, required: boolean = true): string {
  const value = env[key];
  if (required && !value) {
    throw new Error(
      `Missing required environment variable: ${key} (expected in ${runtimePaths.envFilePath})`,
    );
  }
  return value || "";
}

function getOptionalPathListEnvVar(
  env: EnvRecord,
  key: string,
  delimiter: string = ",",
): string[] {
  const value = getEnvVar(env, key, false);
  if (!value || value.trim() === "") {
    return [];
  }
  return value
    .split(delimiter)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function getOptionalPositiveIntEnvVar(
  env: EnvRecord,
  key: string,
  defaultValue: number,
): number {
  const value = getEnvVar(env, key, false);

  if (!value) {
    return defaultValue;
  }

  const parsedValue = Number.parseInt(value, 10);
  if (Number.isNaN(parsedValue) || parsedValue <= 0) {
    return defaultValue;
  }

  return parsedValue;
}

// Like getOptionalPositiveIntEnvVar, but also accepts 0 (used to disable a feature).
function getOptionalNonNegativeIntEnvVar(
  env: EnvRecord,
  key: string,
  defaultValue: number,
): number {
  const value = getEnvVar(env, key, false);

  if (!value) {
    return defaultValue;
  }

  const parsedValue = Number.parseInt(value, 10);
  if (Number.isNaN(parsedValue) || parsedValue < 0) {
    return defaultValue;
  }

  return parsedValue;
}

function getOptionalLocaleEnvVar(env: EnvRecord, key: string, defaultValue: Locale): Locale {
  const value = getEnvVar(env, key, false);
  return normalizeLocale(value, defaultValue);
}

function getOptionalBooleanEnvVar(
  env: EnvRecord,
  key: string,
  defaultValue: boolean,
): boolean {
  const value = getEnvVar(env, key, false);

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
  env: EnvRecord,
  key: string,
  defaultValue: StreamingMode,
): StreamingMode {
  const value = getEnvVar(env, key, false);

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
  env: EnvRecord,
  key: string,
  defaultValue: MessageFormatMode,
): MessageFormatMode {
  const value = getEnvVar(env, key, false);

  if (!value) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "raw" || normalized === "markdown") {
    return normalized;
  }

  return defaultValue;
}

export function parseInitialSettingsPreset(): Record<string, unknown> {
  const raw = getEnvVar("INITIAL_SETTINGS_PRESET", false).trim();
  if (!raw) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "INITIAL_SETTINGS_PRESET contains invalid JSON. Fix or unset the variable.",
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      "INITIAL_SETTINGS_PRESET must be a JSON object.",
    );
  }
  return parsed as Record<string, unknown>;
}

const VALID_TTS_PROVIDERS: TtsProvider[] = ["openai", "google", "elevenlabs", "edge"];

function getOptionalTtsProviderEnvVar(
  env: EnvRecord,
  key: string,
  defaultValue: TtsProvider,
): TtsProvider {
  const value = getEnvVar(env, key, false);

  if (!value) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (VALID_TTS_PROVIDERS.includes(normalized as TtsProvider)) {
    return normalized as TtsProvider;
  }

  return defaultValue;
}

export function parseInitialSettingsPreset(env: EnvRecord): Record<string, unknown> {
  const raw = getEnvVar(env, "INITIAL_SETTINGS_PRESET", false).trim();
  if (!raw) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "INITIAL_SETTINGS_PRESET contains invalid JSON. Fix or unset the variable.",
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      "INITIAL_SETTINGS_PRESET must be a JSON object.",
    );
  }
  return parsed as Record<string, unknown>;
}

const VALID_STT_REQUEST_FORMATS: SttRequestFormat[] = ["multipart", "json"];

function getOptionalSttRequestFormatEnvVar(
  env: EnvRecord,
  key: string,
  defaultValue: SttRequestFormat,
): SttRequestFormat {
  const value = getEnvVar(env, key, false);

  if (!value) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (VALID_STT_REQUEST_FORMATS.includes(normalized as SttRequestFormat)) {
    return normalized as SttRequestFormat;
  }

  return defaultValue;
}

export interface TelegramConfig {
  token: string;
  allowedUserId: number;
  proxyUrl: string;
  apiRoot: string;
  proxySecret: string;
  forceIpv4: boolean;
}

export function buildTelegramConfig(env: EnvRecord): TelegramConfig {
  const proxyUrl = getEnvVar(env, "TELEGRAM_PROXY_URL", false);
  // grammY rejects an apiRoot ending with `/`, so normalize once at config
  // load instead of leaking the concern into every consumer.
  const apiRoot = getEnvVar(env, "TELEGRAM_API_ROOT", false).replace(/\/+$/, "");
  const proxySecret = getEnvVar(env, "TELEGRAM_PROXY_SECRET", false);
  const forceIpv4 = getOptionalBooleanEnvVar(env, "TELEGRAM_FORCE_IPV4", false);

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
    token: getEnvVar(env, "TELEGRAM_BOT_TOKEN"),
    allowedUserId: parseInt(getEnvVar(env, "TELEGRAM_ALLOWED_USER_ID"), 10),
    proxyUrl,
    apiRoot,
    proxySecret,
    forceIpv4,
  };
}

export function createConfig(env: EnvRecord) {
  const provider = getOptionalTtsProviderEnvVar(env, "TTS_PROVIDER", "openai");
  const defaultVoice =
    provider === "google"
      ? "en-US-Studio-O"
      : provider === "elevenlabs"
        ? "21m00Tcm4TlvDq8ikWAM"
        : provider === "edge"
          ? "en-US-EmmaMultilingualNeural"
          : "alloy";
  const defaultModel = provider === "elevenlabs" ? "eleven_flash_v2_5" : "gpt-4o-mini-tts";

  return {
    telegram: buildTelegramConfig(env),
    opencode: {
      apiUrl: getEnvVar(env, "OPENCODE_API_URL", false) || "http://localhost:4096",
      username: getEnvVar(env, "OPENCODE_SERVER_USERNAME", false) || "opencode",
      password: getEnvVar(env, "OPENCODE_SERVER_PASSWORD", false),
      autoRestartEnabled: getOptionalBooleanEnvVar(env, "OPENCODE_AUTO_RESTART_ENABLED", false),
      monitorIntervalSec: getOptionalPositiveIntEnvVar(env, "OPENCODE_MONITOR_INTERVAL_SEC", 300),
      model: {
        provider: getEnvVar(env, "OPENCODE_MODEL_PROVIDER", true), // Required
        modelId: getEnvVar(env, "OPENCODE_MODEL_ID", true), // Required
      },
    },
    server: {
      logLevel: getEnvVar(env, "LOG_LEVEL", false) || "info",
    },
    bot: {
      sessionsListLimit: getOptionalPositiveIntEnvVar(env, "SESSIONS_LIST_LIMIT", 10),
      messagesListLimit: getOptionalPositiveIntEnvVar(env, "MESSAGES_LIST_LIMIT", 10),
      projectsListLimit: getOptionalPositiveIntEnvVar(env, "PROJECTS_LIST_LIMIT", 10),
      commandsListLimit: getOptionalPositiveIntEnvVar(env, "COMMANDS_LIST_LIMIT", 10),
      modelsListLimit: getOptionalPositiveIntEnvVar(env, "MODELS_LIST_LIMIT", 10),
      taskLimit: getOptionalPositiveIntEnvVar(env, "TASK_LIMIT", 10),
      scheduledTaskExecutionTimeoutMinutes: getOptionalPositiveIntEnvVar(
        env,
        "SCHEDULED_TASK_EXECUTION_TIMEOUT_MINUTES",
        120,
      ),
      scheduledTaskNotificationsSilent: getOptionalBooleanEnvVar(
        env,
        "SCHEDULED_TASK_DISABLE_NOTIFICATION",
        false,
      ),
      responseStreamingMode: getOptionalStreamingModeEnvVar(env, "RESPONSE_STREAMING_MODE", "edit"),
      bashToolDisplayMaxLength: getOptionalPositiveIntEnvVar(env, "BASH_TOOL_DISPLAY_MAX_LENGTH", 128),
      locale: getOptionalLocaleEnvVar(env, "BOT_LOCALE", "en"),
      hideThinkingMessages: getOptionalBooleanEnvVar(env, "HIDE_THINKING_MESSAGES", false),
      showThinkingContent: getOptionalBooleanEnvVar(env, "SHOW_THINKING_CONTENT", false),
      hideToolCallMessages: getOptionalBooleanEnvVar(env, "HIDE_TOOL_CALL_MESSAGES", false),
      hideToolFileMessages: getOptionalBooleanEnvVar(env, "HIDE_TOOL_FILE_MESSAGES", false),
      trackBackgroundSessions: getOptionalBooleanEnvVar(env, "TRACK_BACKGROUND_SESSIONS", true),
      messageFormatMode: getOptionalMessageFormatModeEnvVar(env, "MESSAGE_FORMAT_MODE", "markdown"),
      compactOutputMode: getOptionalBooleanEnvVar(env, "COMPACT_OUTPUT_MODE", false),
      // Buffer near-limit text for this window so Telegram-split chunks can be merged.
      // Short messages are processed immediately; 0 disables merging entirely.
      messageMergeWindowMs: getOptionalNonNegativeIntEnvVar(env, "MESSAGE_MERGE_WINDOW_MS", 1500),
      initialSettingsPreset: parseInitialSettingsPreset(env),
      excludedProjectPaths: getOptionalPathListEnvVar(env, "PROJECTS_EXCLUDED_PATHS"),
    },
    files: {
      maxFileSizeKb: parseInt(getEnvVar(env, "CODE_FILE_MAX_SIZE_KB", false) || "100", 10),
    },
    open: {
      browserRoots: getEnvVar(env, "OPEN_BROWSER_ROOTS", false),
    },
    stt: {
      apiUrl: getEnvVar(env, "STT_API_URL", false),
      apiKey: getEnvVar(env, "STT_API_KEY", false),
      model: getEnvVar(env, "STT_MODEL", false) || "whisper-large-v3-turbo",
      language: getEnvVar(env, "STT_LANGUAGE", false),
      notePrompt: getEnvVar(env, "STT_NOTE_PROMPT", false),
      // "multipart" (default) = standard OpenAI/Groq Whisper form-data upload.
      // "json" = base64 audio in an `input_audio` JSON body (e.g. OpenRouter).
      requestFormat: getOptionalSttRequestFormatEnvVar(env, "STT_REQUEST_FORMAT", "multipart"),
    },
    vision: {
      // Local vision fallback: when the active model doesn't support image
      // input, photos are described by the LOCAL vision model (LFM2.5-VL-3B
      // via llama.cpp on 127.0.0.1:8082) and the description is sent as text.
      apiUrl: getEnvVar(env, "LOCAL_VISION_API_URL", false) || "http://127.0.0.1:8082/v1",
      model: getEnvVar(env, "LOCAL_VISION_MODEL", false) || "lfm2.5-vl-3b",
      // Photos are also saved here so the opencode agent can inspect the
      // original image itself (e.g. with the describe_image tool) while
      // working on the prompt — "implement the web with this style".
      uploadDir:
        getEnvVar(env, "LOCAL_VISION_UPLOAD_DIR", false) ||
        (process.env.HOME ?? process.env.USERPROFILE ?? "") + "/.opencode/uploads",
    },
    docExtractor: {
      apiUrl: getEnvVar(env, "DOC_EXTRACTOR_URL", false),
      apiKey: getEnvVar(env, "DOC_EXTRACTOR_API_KEY", false),
    },
    tts: {
      apiUrl: getEnvVar(env, "TTS_API_URL", false),
      apiKey: getEnvVar(env, "TTS_API_KEY", false),
      provider,
      model: getEnvVar(env, "TTS_MODEL", false) || defaultModel,
      voice: getEnvVar(env, "TTS_VOICE", false) || defaultVoice,
    },
  };
}

export const config = createConfig(process.env);
export type Config = ReturnType<typeof createConfig>;
