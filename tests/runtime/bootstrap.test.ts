import { describe, expect, it } from "vitest";
import { buildEnvFileContent, validateRuntimeEnvValues } from "../../src/runtime/bootstrap.js";

describe("runtime/bootstrap", () => {
  it("validates required runtime env values", () => {
    const result = validateRuntimeEnvValues({
      TELEGRAM_BOT_TOKEN: "123456:abcdef",
      TELEGRAM_ALLOWED_USER_ID: "123456789",
      OPENCODE_MODEL_PROVIDER: "opencode",
      OPENCODE_MODEL_ID: "big-pickle",
    });

    expect(result).toEqual({ isValid: true });
  });

  it("fails validation when required model values are missing", () => {
    const result = validateRuntimeEnvValues({
      TELEGRAM_BOT_TOKEN: "123456:abcdef",
      TELEGRAM_ALLOWED_USER_ID: "123456789",
    });

    expect(result.isValid).toBe(false);
    expect(result.reason).toContain("OPENCODE_MODEL_PROVIDER");
  });

  it("fails validation for invalid user id", () => {
    const result = validateRuntimeEnvValues({
      TELEGRAM_BOT_TOKEN: "123456:abcdef",
      TELEGRAM_ALLOWED_USER_ID: "0",
      OPENCODE_MODEL_PROVIDER: "opencode",
      OPENCODE_MODEL_ID: "big-pickle",
    });

    expect(result.isValid).toBe(false);
    expect(result.reason).toContain("TELEGRAM_ALLOWED_USER_ID");
  });

  it("updates only wizard keys and preserves custom keys", () => {
    const existingContent = [
      "CUSTOM_FLAG=enabled",
      "BOT_LOCALE=en",
      "OPENCODE_SERVER_USERNAME=opencode",
      "TELEGRAM_BOT_TOKEN=old",
      "TELEGRAM_ALLOWED_USER_ID=1",
      "OPENCODE_API_URL=http://localhost:4096",
      "OPENCODE_MODEL_PROVIDER=old-provider",
      "OPENCODE_MODEL_ID=old-model",
      "",
    ].join("\n");

    const updated = buildEnvFileContent(existingContent, {
      BOT_LOCALE: "ru",
      TELEGRAM_BOT_TOKEN: "new-token:value",
      TELEGRAM_ALLOWED_USER_ID: "777",
      OPENCODE_MODEL_PROVIDER: "old-provider",
      OPENCODE_MODEL_ID: "old-model",
    });

    expect(updated).toContain("CUSTOM_FLAG=enabled");
    expect(updated).toContain("OPENCODE_SERVER_USERNAME=opencode");
    expect(updated).toContain("BOT_LOCALE=ru");
    expect(updated).toContain("TELEGRAM_BOT_TOKEN=new-token:value");
    expect(updated).toContain("TELEGRAM_ALLOWED_USER_ID=777");
    expect(updated).not.toContain("OPENCODE_API_URL=");
    expect(updated).toContain("OPENCODE_MODEL_PROVIDER=old-provider");
    expect(updated).toContain("OPENCODE_MODEL_ID=old-model");
  });

  it("adds missing required model keys", () => {
    const updated = buildEnvFileContent("", {
      BOT_LOCALE: "en",
      TELEGRAM_BOT_TOKEN: "token:value",
      TELEGRAM_ALLOWED_USER_ID: "42",
      OPENCODE_MODEL_PROVIDER: "opencode",
      OPENCODE_MODEL_ID: "big-pickle",
      OPENCODE_API_URL: "https://localhost:4096",
    });

    expect(updated).toContain("BOT_LOCALE=en");
    expect(updated).toContain("TELEGRAM_BOT_TOKEN=token:value");
    expect(updated).toContain("TELEGRAM_ALLOWED_USER_ID=42");
    expect(updated).toContain("OPENCODE_API_URL=https://localhost:4096");
    expect(updated).toContain("OPENCODE_MODEL_PROVIDER=opencode");
    expect(updated).toContain("OPENCODE_MODEL_ID=big-pickle");
  });
});
