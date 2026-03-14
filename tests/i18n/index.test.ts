import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getDateLocale,
  getLocale,
  getLocaleOptions,
  normalizeLocale,
  resetRuntimeLocale,
  resolveSupportedLocale,
  setRuntimeLocale,
  SUPPORTED_LOCALES,
} from "../../src/i18n/index.js";

describe("i18n/index locale helpers", () => {
  afterEach(() => {
    resetRuntimeLocale();
    vi.unstubAllEnvs();
  });

  it("resolves exact and regional locale values", () => {
    expect(resolveSupportedLocale("ru")).toBe("ru");
    expect(resolveSupportedLocale("ru-RU")).toBe("ru");
    expect(resolveSupportedLocale("en-US")).toBe("en");
    expect(resolveSupportedLocale("de")).toBe("de");
    expect(resolveSupportedLocale("fr")).toBe("fr");
    expect(resolveSupportedLocale("fr-FR")).toBe("fr");
  });

  it("normalizes unsupported locale values with fallback", () => {
    expect(normalizeLocale("pt", "en")).toBe("en");
    expect(normalizeLocale(undefined, "ru")).toBe("ru");
  });

  it("returns date locale from locale definition", () => {
    expect(getDateLocale("ru")).toBe("ru-RU");
    expect(getDateLocale("en")).toBe("en-US");
    expect(getDateLocale("de")).toBe("de-DE");
    expect(getDateLocale("fr")).toBe("fr-FR");
  });

  it("returns locale options from a single registry", () => {
    const optionCodes = getLocaleOptions().map((option) => option.code);
    expect(optionCodes).toEqual(SUPPORTED_LOCALES);
  });

  it("prefers runtime locale override over env locale", () => {
    vi.stubEnv("BOT_LOCALE", "en");
    setRuntimeLocale("ru");

    expect(getLocale()).toBe("ru");
  });
});
