import { beforeEach, describe, expect, it, vi } from "#vitest";
import { loadSut } from "#helpers/sut-loader.js";
const { buildTelegramConfig, createConfig, parseInitialSettingsPreset } = await loadSut<typeof import("#src/config.js")>(
  "#src/config.ts",
  import.meta.url,
);

describe("config boolean env parsing", () => {
  beforeEach(() => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-telegram-token");
    vi.stubEnv("TELEGRAM_ALLOWED_USER_ID", "123456789");
    vi.stubEnv("OPENCODE_MODEL_PROVIDER", "test-provider");
    vi.stubEnv("OPENCODE_MODEL_ID", "test-model");
    vi.stubEnv("OPENCODE_AUTO_RESTART_ENABLED", "");
    vi.stubEnv("OPENCODE_MONITOR_INTERVAL_SEC", "");
  });

  it("uses false defaults for hide service message flags", () => {
    vi.stubEnv("HIDE_THINKING_MESSAGES", "");
    vi.stubEnv("SHOW_THINKING_CONTENT", "");
    vi.stubEnv("HIDE_TOOL_CALL_MESSAGES", "");
    vi.stubEnv("HIDE_TOOL_FILE_MESSAGES", "");

    const config = createConfig(process.env);

    expect(config.bot.hideThinkingMessages).toBe(false);
    expect(config.bot.showThinkingContent).toBe(false);
    expect(config.bot.hideToolCallMessages).toBe(false);
    expect(config.bot.hideToolFileMessages).toBe(false);
  });

  it("tracks background sessions by default", () => {
    vi.stubEnv("TRACK_BACKGROUND_SESSIONS", "");

    const config = createConfig(process.env);

    expect(config.bot.trackBackgroundSessions).toBe(true);
  });

  it("parses falsy values for background session tracking", () => {
    vi.stubEnv("TRACK_BACKGROUND_SESSIONS", "off");

    const config = createConfig(process.env);

    expect(config.bot.trackBackgroundSessions).toBe(false);
  });

  it("falls back to enabled background session tracking on invalid value", () => {
    vi.stubEnv("TRACK_BACKGROUND_SESSIONS", "banana");

    const config = createConfig(process.env);

    expect(config.bot.trackBackgroundSessions).toBe(true);
  });

  it("parses truthy values for hide service message flags", () => {
    vi.stubEnv("HIDE_THINKING_MESSAGES", "YES");
    vi.stubEnv("SHOW_THINKING_CONTENT", "1");
    vi.stubEnv("HIDE_TOOL_CALL_MESSAGES", "1");
    vi.stubEnv("HIDE_TOOL_FILE_MESSAGES", "true");

    const config = createConfig(process.env);

    expect(config.bot.hideThinkingMessages).toBe(true);
    expect(config.bot.showThinkingContent).toBe(true);
    expect(config.bot.hideToolCallMessages).toBe(true);
    expect(config.bot.hideToolFileMessages).toBe(true);
  });

  it("parses falsy values for hide service message flags", () => {
    vi.stubEnv("HIDE_THINKING_MESSAGES", "off");
    vi.stubEnv("SHOW_THINKING_CONTENT", "false");
    vi.stubEnv("HIDE_TOOL_CALL_MESSAGES", "0");
    vi.stubEnv("HIDE_TOOL_FILE_MESSAGES", "false");

    const config = createConfig(process.env);

    expect(config.bot.hideThinkingMessages).toBe(false);
    expect(config.bot.showThinkingContent).toBe(false);
    expect(config.bot.hideToolCallMessages).toBe(false);
    expect(config.bot.hideToolFileMessages).toBe(false);
  });

  it("falls back to defaults on invalid values", () => {
    vi.stubEnv("HIDE_THINKING_MESSAGES", "banana");
    vi.stubEnv("SHOW_THINKING_CONTENT", "maybe");
    vi.stubEnv("HIDE_TOOL_CALL_MESSAGES", "nope");
    vi.stubEnv("HIDE_TOOL_FILE_MESSAGES", "invalid");

    const config = createConfig(process.env);

    expect(config.bot.hideThinkingMessages).toBe(false);
    expect(config.bot.showThinkingContent).toBe(false);
    expect(config.bot.hideToolCallMessages).toBe(false);
    expect(config.bot.hideToolFileMessages).toBe(false);
  });

  it("uses markdown as default message format mode", () => {
    vi.stubEnv("MESSAGE_FORMAT_MODE", "");

    const config = createConfig(process.env);

    expect(config.bot.messageFormatMode).toBe("markdown");
  });

  it("returns an empty list when PROJECTS_EXCLUDED_PATHS is not set", async () => {
    vi.stubEnv("PROJECTS_EXCLUDED_PATHS", "");

    const config = createConfig(process.env);

    expect(config.bot.excludedProjectPaths).toEqual([]);
  });

  it("parses PROJECTS_EXCLUDED_PATHS as a comma-separated path list", async () => {
    vi.stubEnv(
      "PROJECTS_EXCLUDED_PATHS",
      "/home/user/repo-a,/home/user/repo-b,/home/user/repo-c",
    );

    const config = createConfig(process.env);

    expect(config.bot.excludedProjectPaths).toEqual([
      "/home/user/repo-a",
      "/home/user/repo-b",
      "/home/user/repo-c",
    ]);
  });

  it("trims whitespace and drops empty entries from PROJECTS_EXCLUDED_PATHS", async () => {
    vi.stubEnv("PROJECTS_EXCLUDED_PATHS", "  /home/user/repo-a , ,/home/user/repo-b  ");

    const config = createConfig(process.env);

    expect(config.bot.excludedProjectPaths).toEqual(["/home/user/repo-a", "/home/user/repo-b"]);
  });

  it("parses markdown message format mode", async () => {
    vi.stubEnv("MESSAGE_FORMAT_MODE", "MARKDOWN");

    const config = createConfig(process.env);

    expect(config.bot.messageFormatMode).toBe("markdown");
  });

  it("parses raw message format mode", () => {
    vi.stubEnv("MESSAGE_FORMAT_MODE", "raw");

    const config = createConfig(process.env);

    expect(config.bot.messageFormatMode).toBe("raw");
  });

  it("falls back to markdown on invalid message format mode", () => {
    vi.stubEnv("MESSAGE_FORMAT_MODE", "html");

    const config = createConfig(process.env);

    expect(config.bot.messageFormatMode).toBe("markdown");
  });

  it("disables compact output mode by default", async () => {
    vi.stubEnv("COMPACT_OUTPUT_MODE", "");

    const config = createConfig(process.env);

    expect(config.bot.compactOutputMode).toBe(false);
  });

  it("parses compact output mode as a boolean", async () => {
    vi.stubEnv("COMPACT_OUTPUT_MODE", "true");

    const config = createConfig(process.env);

    expect(config.bot.compactOutputMode).toBe(true);
  });

  it("falls back to disabled compact output mode on invalid value", async () => {
    vi.stubEnv("COMPACT_OUTPUT_MODE", "compact");

    const config = createConfig(process.env);

    expect(config.bot.compactOutputMode).toBe(false);
  });

  it("returns an empty preset when INITIAL_SETTINGS_PRESET is not set", async () => {
    vi.stubEnv("INITIAL_SETTINGS_PRESET", "");

    const config = createConfig(process.env);

    expect(config.bot.initialSettingsPreset).toEqual({});
  });

  it("parses a valid INITIAL_SETTINGS_PRESET JSON object", async () => {
    vi.stubEnv(
      "INITIAL_SETTINGS_PRESET",
      '{"showAssistantRunFooter":false,"compactOutputMode":true}',
    );

    const config = createConfig(process.env);

    expect(config.bot.initialSettingsPreset).toEqual({
      showAssistantRunFooter: false,
      compactOutputMode: true,
    });
  });

  it("throws when INITIAL_SETTINGS_PRESET contains invalid JSON", async () => {
    vi.stubEnv("INITIAL_SETTINGS_PRESET", "{not valid json}");

    expect(() => parseInitialSettingsPreset(process.env)).toThrow(/invalid JSON/);
  });

  it("throws when INITIAL_SETTINGS_PRESET is a JSON array", async () => {
    vi.stubEnv("INITIAL_SETTINGS_PRESET", '["not","an","object"]');

    expect(() => parseInitialSettingsPreset(process.env)).toThrow(/must be a JSON object/);
  });

  it("throws when INITIAL_SETTINGS_PRESET is a JSON scalar", async () => {
    vi.stubEnv("INITIAL_SETTINGS_PRESET", "true");

    expect(() => parseInitialSettingsPreset(process.env)).toThrow(/must be a JSON object/);
  });
  it("parses supported locale from BOT_LOCALE", async () => {
    vi.stubEnv("BOT_LOCALE", "fr");

    const config = createConfig(process.env);

    expect(config.bot.locale).toBe("fr");
  });

  it("normalizes regional locale tags", () => {
    vi.stubEnv("BOT_LOCALE", "ru-RU");

    const config = createConfig(process.env);

    expect(config.bot.locale).toBe("ru");
  });

  it("falls back to default locale on unsupported value", () => {
    vi.stubEnv("BOT_LOCALE", "xx");

    const config = createConfig(process.env);

    expect(config.bot.locale).toBe("en");
  });

  it("uses default task limit when TASK_LIMIT is missing", () => {
    vi.stubEnv("TASK_LIMIT", "");

    const config = createConfig(process.env);

    expect(config.bot.taskLimit).toBe(10);
  });

  it("uses default scheduled task execution timeout when SCHEDULED_TASK_EXECUTION_TIMEOUT_MINUTES is missing", () => {
    vi.stubEnv("SCHEDULED_TASK_EXECUTION_TIMEOUT_MINUTES", "");

    const config = createConfig(process.env);

    expect(config.bot.scheduledTaskExecutionTimeoutMinutes).toBe(120);
  });

  it("uses default bash tool display length when env is missing", async () => {
    vi.stubEnv("BASH_TOOL_DISPLAY_MAX_LENGTH", "");

    const config = createConfig(process.env);

    expect(config.bot.bashToolDisplayMaxLength).toBe(128);
  });

  it("parses BASH_TOOL_DISPLAY_MAX_LENGTH as a positive integer", () => {
    vi.stubEnv("BASH_TOOL_DISPLAY_MAX_LENGTH", "256");

    const config = createConfig(process.env);

    expect(config.bot.bashToolDisplayMaxLength).toBe(256);
  });

  it("falls back to default bash tool display length on invalid value", () => {
    vi.stubEnv("BASH_TOOL_DISPLAY_MAX_LENGTH", "zero");

    const config = createConfig(process.env);

    expect(config.bot.bashToolDisplayMaxLength).toBe(128);
  });

  it("parses TASK_LIMIT as a positive integer", () => {
    vi.stubEnv("TASK_LIMIT", "25");

    const config = createConfig(process.env);

    expect(config.bot.taskLimit).toBe(25);
  });

  it("parses SCHEDULED_TASK_EXECUTION_TIMEOUT_MINUTES as a positive integer", () => {
    vi.stubEnv("SCHEDULED_TASK_EXECUTION_TIMEOUT_MINUTES", "180");

    const config = createConfig(process.env);

    expect(config.bot.scheduledTaskExecutionTimeoutMinutes).toBe(180);
  });

  it("falls back to default task limit on invalid TASK_LIMIT", () => {
    vi.stubEnv("TASK_LIMIT", "zero");

    const config = createConfig(process.env);

    expect(config.bot.taskLimit).toBe(10);
  });

  it("falls back to default scheduled task execution timeout on invalid value", () => {
    vi.stubEnv("SCHEDULED_TASK_EXECUTION_TIMEOUT_MINUTES", "zero");

    const config = createConfig(process.env);

    expect(config.bot.scheduledTaskExecutionTimeoutMinutes).toBe(120);
  });

  it("uses disabled OpenCode auto-restart by default", () => {
    const config = createConfig(process.env);

    expect(config.opencode.autoRestartEnabled).toBe(false);
  });

  it("parses OPENCODE_AUTO_RESTART_ENABLED as a boolean", () => {
    vi.stubEnv("OPENCODE_AUTO_RESTART_ENABLED", "true");

    const config = createConfig(process.env);

    expect(config.opencode.autoRestartEnabled).toBe(true);
  });

  it("uses 300 seconds as default OpenCode monitor interval", () => {
    const config = createConfig(process.env);

    expect(config.opencode.monitorIntervalSec).toBe(300);
  });

  it("parses OPENCODE_MONITOR_INTERVAL_SEC as a positive integer", () => {
    vi.stubEnv("OPENCODE_MONITOR_INTERVAL_SEC", "600");

    const config = createConfig(process.env);

    expect(config.opencode.monitorIntervalSec).toBe(600);
  });

  it("falls back to default OpenCode monitor interval on invalid value", () => {
    vi.stubEnv("OPENCODE_MONITOR_INTERVAL_SEC", "zero");

    const config = createConfig(process.env);

    expect(config.opencode.monitorIntervalSec).toBe(300);
  });

  it("keeps TTS credentials unset when dedicated vars are missing", () => {
    vi.stubEnv("STT_API_URL", "https://api.openai.com/v1");
    vi.stubEnv("STT_API_KEY", "sk-test-key");
    vi.stubEnv("TTS_API_URL", "");
    vi.stubEnv("TTS_API_KEY", "");
    vi.stubEnv("TTS_VOICE", "");

    const config = createConfig(process.env);

    expect(config.tts.apiUrl).toBe("");
    expect(config.tts.apiKey).toBe("");
    expect(config.tts.model).toBe("gpt-4o-mini-tts");
    expect(config.tts.voice).toBe("alloy");
  });

  it("accepts ElevenLabs as a TTS provider", () => {
    vi.stubEnv("TTS_PROVIDER", "elevenlabs");
    vi.stubEnv("TTS_API_URL", "https://api.elevenlabs.io/v1");
    vi.stubEnv("TTS_API_KEY", "xi-test-key");
    vi.stubEnv("TTS_MODEL", "eleven_flash_v2_5");
    vi.stubEnv("TTS_VOICE", "nPczCjzI2devNBz1zQrb");

    const config = createConfig(process.env);

    expect(config.tts.provider).toBe("elevenlabs");
    expect(config.tts.apiUrl).toBe("https://api.elevenlabs.io/v1");
    expect(config.tts.apiKey).toBe("xi-test-key");
    expect(config.tts.model).toBe("eleven_flash_v2_5");
    expect(config.tts.voice).toBe("nPczCjzI2devNBz1zQrb");
  });

  it("uses ElevenLabs defaults for ElevenLabs TTS", () => {
    vi.stubEnv("TTS_PROVIDER", "elevenlabs");
    vi.stubEnv("TTS_MODEL", "");
    vi.stubEnv("TTS_VOICE", "");

    const config = createConfig(process.env);

    expect(config.tts.model).toBe("eleven_flash_v2_5");
    expect(config.tts.voice).toBe("21m00Tcm4TlvDq8ikWAM");
  });
});

describe("config telegram reverse-proxy", () => {
  beforeEach(() => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-telegram-token");
    vi.stubEnv("TELEGRAM_ALLOWED_USER_ID", "123456789");
    vi.stubEnv("OPENCODE_MODEL_PROVIDER", "test-provider");
    vi.stubEnv("OPENCODE_MODEL_ID", "test-model");
    delete process.env.TELEGRAM_PROXY_URL;
    delete process.env.TELEGRAM_API_ROOT;
    delete process.env.TELEGRAM_PROXY_SECRET;
    delete process.env.TELEGRAM_FORCE_IPV4;
  });

  it("leaves apiRoot and proxySecret empty when neither env var is set", () => {
    const telegram = buildTelegramConfig(process.env);

    expect(telegram.apiRoot).toBe("");
    expect(telegram.proxySecret).toBe("");
  });

  it("disables forced IPv4 by default", () => {
    expect(buildTelegramConfig(process.env).forceIpv4).toBe(false);
  });

  it("parses TELEGRAM_FORCE_IPV4 as a boolean", () => {
    vi.stubEnv("TELEGRAM_FORCE_IPV4", "true");
    expect(buildTelegramConfig(process.env).forceIpv4).toBe(true);
  });

  it("allows TELEGRAM_FORCE_IPV4 together with reverse proxy settings", () => {
    vi.stubEnv("TELEGRAM_API_ROOT", "https://tg-proxy.example.com");
    vi.stubEnv("TELEGRAM_PROXY_SECRET", "shared-secret");
    vi.stubEnv("TELEGRAM_FORCE_IPV4", "true");

    const telegram = buildTelegramConfig(process.env);
    expect(telegram.apiRoot).toBe("https://tg-proxy.example.com");
    expect(telegram.proxySecret).toBe("shared-secret");
    expect(telegram.forceIpv4).toBe(true);
  });

  it("strips a trailing slash from TELEGRAM_API_ROOT", () => {
    vi.stubEnv("TELEGRAM_API_ROOT", "https://tg-proxy.example.com/");

    expect(buildTelegramConfig(process.env).apiRoot).toBe("https://tg-proxy.example.com");
  });

  it("strips multiple trailing slashes from TELEGRAM_API_ROOT", () => {
    vi.stubEnv("TELEGRAM_API_ROOT", "https://tg-proxy.example.com///");

    expect(buildTelegramConfig(process.env).apiRoot).toBe("https://tg-proxy.example.com");
  });

  it("preserves TELEGRAM_API_ROOT that has no trailing slash", () => {
    vi.stubEnv("TELEGRAM_API_ROOT", "https://tg-proxy.example.com");

    expect(buildTelegramConfig(process.env).apiRoot).toBe("https://tg-proxy.example.com");
  });

  it("accepts TELEGRAM_API_ROOT together with TELEGRAM_PROXY_SECRET", () => {
    vi.stubEnv("TELEGRAM_API_ROOT", "https://tg-proxy.example.com");
    vi.stubEnv("TELEGRAM_PROXY_SECRET", "shared-secret");

    const telegram = buildTelegramConfig(process.env);
    expect(telegram.apiRoot).toBe("https://tg-proxy.example.com");
    expect(telegram.proxySecret).toBe("shared-secret");
  });

  it("allows TELEGRAM_PROXY_URL alone without TELEGRAM_API_ROOT", () => {
    vi.stubEnv("TELEGRAM_PROXY_URL", "socks5://forward.example.com:1080");

    const telegram = buildTelegramConfig(process.env);
    expect(telegram.proxyUrl).toBe("socks5://forward.example.com:1080");
    expect(telegram.apiRoot).toBe("");
  });

  it("rejects TELEGRAM_PROXY_URL combined with TELEGRAM_API_ROOT", () => {
    vi.stubEnv("TELEGRAM_PROXY_URL", "socks5://forward.example.com:1080");
    vi.stubEnv("TELEGRAM_API_ROOT", "https://tg-proxy.example.com");

    expect(() => buildTelegramConfig(process.env)).toThrow(/cannot be used together/i);
  });

  it("rejects TELEGRAM_PROXY_SECRET without TELEGRAM_API_ROOT", () => {
    vi.stubEnv("TELEGRAM_PROXY_SECRET", "shared-secret");

    expect(() => buildTelegramConfig(process.env)).toThrow(
      /TELEGRAM_PROXY_SECRET requires TELEGRAM_API_ROOT/,
    );
  });
});
