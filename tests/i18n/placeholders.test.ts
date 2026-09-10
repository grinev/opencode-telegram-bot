import { describe, expect, it } from "#vitest";
import { ar } from "../../src/i18n/ar.js";
import { de } from "../../src/i18n/de.js";
import { en, type I18nDictionary, type I18nKey } from "../../src/i18n/en.js";
import { es } from "../../src/i18n/es.js";
import { fr } from "../../src/i18n/fr.js";
import { it as itLocale } from "../../src/i18n/it.js";
import { ko } from "../../src/i18n/ko.js";
import { pt } from "../../src/i18n/pt.js";
import { ru } from "../../src/i18n/ru.js";
import { zh } from "../../src/i18n/zh.js";

// Must stay in sync with the interpolation pattern used in src/i18n/index.ts.
const PLACEHOLDER_PATTERN = /\{([a-zA-Z0-9_]+)\}/g;

const LOCALES: Record<string, I18nDictionary> = { ar, de, es, fr, it: itLocale, ko, pt, ru, zh };

function extractPlaceholders(template: string): Set<string> {
  return new Set(template.match(PLACEHOLDER_PATTERN) ?? []);
}

function formatPlaceholders(placeholders: Set<string>): string {
  return [...placeholders].sort().join(", ") || "(none)";
}

describe("i18n placeholder consistency", () => {
  for (const [code, dictionary] of Object.entries(LOCALES)) {
    it(`uses the same placeholders as en for every key (${code})`, () => {
      const mismatches: string[] = [];

      for (const key of Object.keys(en) as I18nKey[]) {
        const expected = extractPlaceholders(en[key]);
        const actual = extractPlaceholders(dictionary[key]);

        if (expected.size !== actual.size || [...expected].some((p) => !actual.has(p))) {
          mismatches.push(
            `${key}: en has ${formatPlaceholders(expected)}, ${code} has ${formatPlaceholders(actual)}`,
          );
        }
      }

      expect(mismatches, `${code} placeholder mismatches`).toEqual([]);
    });
  }
});
