import dotenv from "dotenv";
import { getRuntimePaths } from "./runtime/paths.js";
import { normalizeLocale, type Locale } from "./i18n/index.js";

const runtimePaths = getRuntimePaths();
dotenv.config({ path: runtimePaths.envFilePath, quiet: true });

export type MessageFormatMode = "raw" | "markdown";
export type TtsProvider = "openai" | "google" | "elevenlabs" | "edge";
export type SttRequestFormat = "multipart" | "json";

function getEnvVar(key: string, required: boolean = true): string {
  const value = process.env[key];
  if (required && !value) {
    throw new Error(
      `Missing required environment variable: ${key} (expected in ${runtimePaths.envFilePath})`,
    );
  }
  return value || "";
}

function getOptionalPathListEnvVar(key: string, delimiter: string = ","): string[] {
  const value = getEnvVar(key, false);
  if (!value || value.trim() === "") {
    return [];
  }
  return value
    .split(delimiter)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
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

// Like getOptionalPositiveIntEnvVar, but also accepts 0 (used to disable a feature).
function getOptionalNonNegativeIntEnvVar(key: string, defaultValue: number): number {
  const value = getEnvVar(key, false);

  if (!value) {
    return defaultValue;
  }

  const parsedValue = Number.parseInt(value, 10);
  if (Number.isNaN(parsedValue) || parsedValue < 0) {
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

const VALID_STT_REQUEST_FORMATS: SttRequestFormat[] = ["multipart", "json"];

function getOptionalSttRequestFormatEnvVar(
  key: string,
  defaultValue: SttRequestFormat,
): SttRequestFormat {
  const value = getEnvVar(key, false);

  if (!value) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (VALID_STT_REQUEST_FORMATS.includes(normalized as SttRequestFormat)) {
    return normalized as SttRequestFormat;
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
    // OpenCode server URL - can also be set via OPENCODE_PORT (e.g. OPENCODE_PORT=4096)
    apiUrl: getEnvVar("OPENCODE_API_URL", false) || `http://localhost:${getEnvVar("OPENCODE_PORT", false) || "4096"}`,
    username: getEnvVar("OPENCODE_SERVER_USERNAME", false) || "opencode",
    password: getEnvVar("OPENCODE_SERVER_PASSWORD", false),
    autoRestartEnabled: getOptionalBooleanEnvVar("OPENCODE_AUTO_RESTART_ENABLED", false),
    monitorIntervalSec: getOptionalPositiveIntEnvVar("OPENCODE_MONITOR_INTERVAL_SEC", 300),
    // Working directory for the OpenCode server process (default: bot's working directory)
    serverWorkdir: getEnvVar("OPENCODE_SERVER_WORKDIR", false),
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
    modelsListLimit: getOptionalPositiveIntEnvVar("MODELS_LIST_LIMIT", 10),
    taskLimit: getOptionalPositiveIntEnvVar("TASK_LIMIT", 10),
    scheduledTaskExecutionTimeoutMinutes: getOptionalPositiveIntEnvVar(
      "SCHEDULED_TASK_EXECUTION_TIMEOUT_MINUTES",
      120,
    ),
    scheduledTaskNotificationsSilent: getOptionalBooleanEnvVar(
      "SCHEDULED_TASK_DISABLE_NOTIFICATION",
      false,
    ),
    bashToolDisplayMaxLength: getOptionalPositiveIntEnvVar("BASH_TOOL_DISPLAY_MAX_LENGTH", 128),
    locale: getOptionalLocaleEnvVar("BOT_LOCALE", "en"),
    trackBackgroundSessions: getOptionalBooleanEnvVar("TRACK_BACKGROUND_SESSIONS", true),
    messageFormatMode: getOptionalMessageFormatModeEnvVar("MESSAGE_FORMAT_MODE", "markdown"),
    // Buffer near-limit text for this window so Telegram-split chunks can be merged.
    // Short messages are processed immediately; 0 disables merging entirely.
    messageMergeWindowMs: getOptionalNonNegativeIntEnvVar("MESSAGE_MERGE_WINDOW_MS", 1500),
    initialSettingsPreset: parseInitialSettingsPreset(),
    excludedProjectPaths: getOptionalPathListEnvVar("PROJECTS_EXCLUDED_PATHS"),
    // Full-history rendering on session switch: newest N conversation messages,
    // 0 = unlimited. Cleanup wipes previously rendered bot messages first.
    historyRenderLimit: getOptionalNonNegativeIntEnvVar("HISTORY_RENDER_LIMIT", 200),
    cleanupOnSessionSwitch: getOptionalBooleanEnvVar("CLEANUP_ON_SESSION_SWITCH", true),
    // Dynamic model mode: omit the model param on prompts unless the user
    // explicitly picked a model via the in-bot picker, so OpenCode uses
    // whatever model is currently active on the server.
    dynamicModel: getOptionalBooleanEnvVar("OPENCODE_DYNAMIC_MODEL", true),
    // Auto-follow: when a session in the current project starts running while
    // the bot is idle on a different session, switch the bot to the active
    // session so progress/questions/permissions mirror live.
    autoFollowActiveSession: getOptionalBooleanEnvVar("AUTO_FOLLOW_ACTIVE_SESSION", true),
    alwaysAllowPermissions: getOptionalBooleanEnvVar("ALLOW_PERMISSIONS_ALWAYS", false),
    // Global real-time: subscribe to events from ALL projects simultaneously,
    // enabling real-time sync of prompts from OpenCode CLI/TUI to Telegram
    // regardless of which project/session is currently selected in the bot.
    globalRealTime: getOptionalBooleanEnvVar("GLOBAL_REAL_TIME", true),
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
    // "multipart" (default) = standard OpenAI/Groq Whisper form-data upload.
    // "json" = base64 audio in an `input_audio` JSON body (e.g. OpenRouter).
    requestFormat: getOptionalSttRequestFormatEnvVar("STT_REQUEST_FORMAT", "multipart"),
  },
  docExtractor: {
    apiUrl: getEnvVar("DOC_EXTRACTOR_URL", false),
    apiKey: getEnvVar("DOC_EXTRACTOR_API_KEY", false),
  },
  tts: (() => {
    const provider = getOptionalTtsProviderEnvVar("TTS_PROVIDER", "openai");
    const defaultVoice =
      provider === "google"
        ? "en-US-Studio-O"
        : provider === "elevenlabs"
          ? "21m00Tcm4TlvDq8ikWAM"
          : provider === "edge"
            ? "en-US-EmmaMultilingualNeural"
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
  voiceCli: {
    // Enable voice CLI mode (local STT + opencode CLI + Edge TTS)
    enabled: getOptionalBooleanEnvVar("VOICE_CLI_ENABLED", false),
    // Working directory for opencode CLI (default: bot's working directory)
    workdir: getEnvVar("VOICE_CLI_WORKDIR", false),
    // Default model for opencode CLI (optional, uses config default if not set)
    model: getEnvVar("VOICE_CLI_MODEL", false),
    // Default agent for opencode CLI (optional)
    agent: getEnvVar("VOICE_CLI_AGENT", false),
    // STT mode: "api" (Whisper API like Groq), "vosk" (fully offline Vosk), or "whisper" (local Whisper via transformers.js)
    sttMode: getEnvVar("VOICE_CLI_STT_MODE", false) || "api",
  },
  vosk: {
    // Path to Vosk model directory (for fully offline STT)
    modelPath: getEnvVar("VOSK_MODEL_PATH", false),
  },
  whisper: {
    // Transformers.js Whisper model ID (local ONNX, downloaded once, then offline)
    model: getEnvVar("WHISPER_MODEL", false) || "onnx-community/whisper-small",
  },
};
