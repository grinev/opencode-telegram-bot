import { en, type I18nKey } from "./en.js";
import { de } from "./de.js";
import { es } from "./es.js";
import { fr } from "./fr.js";
import { ru } from "./ru.js";
import { zh } from "./zh.js";

interface LocaleDefinition {
  code: string;
  label: string;
  dateLocale: string;
  dictionary: Record<I18nKey, string>;
}

const LOCALE_DEFINITIONS = [
  {
    code: "en",
    label: "English",
    dateLocale: "en-US",
    dictionary: en,
  },
  {
    code: "de",
    label: "Deutsch",
    dateLocale: "de-DE",
    dictionary: de,
  },
  {
    code: "es",
    label: "Español",
    dateLocale: "es-ES",
    dictionary: es,
  },
  {
    code: "fr",
    label: "Français",
    dateLocale: "fr-FR",
    dictionary: fr,
  },
  {
    code: "ru",
    label: "Русский",
    dateLocale: "ru-RU",
    dictionary: ru,
  },
  {
    code: "zh",
    label: "简体中文",
    dateLocale: "zh-CN",
    dictionary: zh,
  },
] as const satisfies readonly LocaleDefinition[];

export type Locale = (typeof LOCALE_DEFINITIONS)[number]["code"];

export interface LocaleOption {
  code: Locale;
  label: string;
}

type TranslationParams = Record<string, string | number | boolean | null | undefined>;

const DEFAULT_LOCALE: Locale = "en";

export const SUPPORTED_LOCALES: readonly Locale[] = LOCALE_DEFINITIONS.map(
  (definition) => definition.code,
);

const localeDefinitionByCode = Object.fromEntries(
  LOCALE_DEFINITIONS.map((definition) => [definition.code, definition]),
) as Record<Locale, (typeof LOCALE_DEFINITIONS)[number]>;

let runtimeLocaleOverride: Locale | null = null;

export function resolveSupportedLocale(locale: string | null | undefined): Locale | null {
  const normalized = locale?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (Object.hasOwn(localeDefinitionByCode, normalized)) {
    return normalized as Locale;
  }

  const baseLocale = normalized.split("-")[0];
  if (Object.hasOwn(localeDefinitionByCode, baseLocale)) {
    return baseLocale as Locale;
  }

  return null;
}

export function normalizeLocale(
  locale: string | null | undefined,
  fallback: Locale = DEFAULT_LOCALE,
): Locale {
  return resolveSupportedLocale(locale) ?? fallback;
}

export function isSupportedLocale(locale: string): locale is Locale {
  return resolveSupportedLocale(locale) !== null;
}

export function getLocaleOptions(): LocaleOption[] {
  return LOCALE_DEFINITIONS.map(({ code, label }) => ({ code, label }));
}

export function getDateLocale(locale?: Locale): string {
  const activeLocale = locale ?? getLocale();
  return localeDefinitionByCode[activeLocale].dateLocale;
}

function interpolate(template: string, params?: TranslationParams): string {
  if (!params) {
    return template;
  }

  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (fullMatch, key: string) => {
    const value = params[key];
    if (value === undefined || value === null) {
      return fullMatch;
    }

    return String(value);
  });
}

export function getLocale(): Locale {
  if (runtimeLocaleOverride) {
    return runtimeLocaleOverride;
  }

  const localeFromEnv = process.env.BOT_LOCALE;
  return normalizeLocale(localeFromEnv, DEFAULT_LOCALE);
}

export function setRuntimeLocale(locale: Locale): void {
  runtimeLocaleOverride = locale;
}

export function resetRuntimeLocale(): void {
  runtimeLocaleOverride = null;
}

export function t(key: I18nKey, params?: TranslationParams, locale?: Locale): string {
  const activeLocale = locale ?? getLocale();
  const dictionary = localeDefinitionByCode[activeLocale].dictionary;
  const template = dictionary[key] ?? en[key];

  if (!template) {
    return key;
  }

  return interpolate(template, params);
}
