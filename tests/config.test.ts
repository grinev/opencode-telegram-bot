import { beforeEach, describe, expect, it, vi } from "vitest";

async function loadConfig() {
  vi.resetModules();
  const module = await import("../src/config.js");
  return module.config;
}

describe("config boolean env parsing", () => {
  beforeEach(() => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-telegram-token");
    vi.stubEnv("TELEGRAM_ALLOWED_USER_ID", "123456789");
    vi.stubEnv("OPENCODE_MODEL_PROVIDER", "test-provider");
    vi.stubEnv("OPENCODE_MODEL_ID", "test-model");
  });

  it("uses false defaults for hide service message flags", async () => {
    vi.stubEnv("HIDE_THINKING_MESSAGES", "");
    vi.stubEnv("HIDE_TOOL_CALL_MESSAGES", "");

    const config = await loadConfig();

    expect(config.bot.hideThinkingMessages).toBe(false);
    expect(config.bot.hideToolCallMessages).toBe(false);
  });

  it("parses truthy values for hide service message flags", async () => {
    vi.stubEnv("HIDE_THINKING_MESSAGES", "YES");
    vi.stubEnv("HIDE_TOOL_CALL_MESSAGES", "1");

    const config = await loadConfig();

    expect(config.bot.hideThinkingMessages).toBe(true);
    expect(config.bot.hideToolCallMessages).toBe(true);
  });

  it("parses falsy values for hide service message flags", async () => {
    vi.stubEnv("HIDE_THINKING_MESSAGES", "off");
    vi.stubEnv("HIDE_TOOL_CALL_MESSAGES", "0");

    const config = await loadConfig();

    expect(config.bot.hideThinkingMessages).toBe(false);
    expect(config.bot.hideToolCallMessages).toBe(false);
  });

  it("falls back to defaults on invalid values", async () => {
    vi.stubEnv("HIDE_THINKING_MESSAGES", "banana");
    vi.stubEnv("HIDE_TOOL_CALL_MESSAGES", "nope");

    const config = await loadConfig();

    expect(config.bot.hideThinkingMessages).toBe(false);
    expect(config.bot.hideToolCallMessages).toBe(false);
  });

  it("uses markdown as default message format mode", async () => {
    vi.stubEnv("MESSAGE_FORMAT_MODE", "");

    const config = await loadConfig();

    expect(config.bot.messageFormatMode).toBe("markdown");
  });

  it("parses markdown message format mode", async () => {
    vi.stubEnv("MESSAGE_FORMAT_MODE", "MARKDOWN");

    const config = await loadConfig();

    expect(config.bot.messageFormatMode).toBe("markdown");
  });

  it("falls back to markdown on invalid message format mode", async () => {
    vi.stubEnv("MESSAGE_FORMAT_MODE", "html");

    const config = await loadConfig();

    expect(config.bot.messageFormatMode).toBe("markdown");
  });

  it("parses supported locale from BOT_LOCALE", async () => {
    vi.stubEnv("BOT_LOCALE", "ru");

    const config = await loadConfig();

    expect(config.bot.locale).toBe("ru");
  });

  it("normalizes regional locale tags", async () => {
    vi.stubEnv("BOT_LOCALE", "ru-RU");

    const config = await loadConfig();

    expect(config.bot.locale).toBe("ru");
  });

  it("falls back to default locale on unsupported value", async () => {
    vi.stubEnv("BOT_LOCALE", "fr");

    const config = await loadConfig();

    expect(config.bot.locale).toBe("en");
  });
});
