import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "#vitest";
import { ar } from "../../src/i18n/ar.js";
import { de } from "../../src/i18n/de.js";
import { en, type I18nDictionary, type I18nKey } from "../../src/i18n/en.js";
import { es } from "../../src/i18n/es.js";
import { fr } from "../../src/i18n/fr.js";
import { it as itLocale } from "../../src/i18n/it.js";
import { pt } from "../../src/i18n/pt.js";
import { ru } from "../../src/i18n/ru.js";
import { zh } from "../../src/i18n/zh.js";
import { defined } from "../helpers/defined.js";

// Must stay in sync with CALLBACK_ANSWER_MAX_LENGTH in src/bot/callbacks/feedback.ts.
const CALLBACK_ANSWER_MAX_LENGTH = 200;

const LOCALES: Record<string, I18nDictionary> = {
  en,
  ar,
  de,
  es,
  fr,
  it: itLocale,
  pt,
  ru,
  zh,
};

const BOT_SOURCE_ROOT = path.resolve(__dirname, "../../src/bot");

// Keys passed as literals: `notify(ctx, "key")`, `alert(ctx, "key")`,
// `failure(ctx, "key")`, `cancelPrompt(ctx, "key")` and direct
// `answerCallbackQuery({ text: t("key") })`. Keys built at runtime (view.error in
// the file browser, replyLabels[reply] in the permission handler) are out of
// reach for a static scan and are deliberately not covered here.
const HELPER_CALL_PATTERN = /\b(?:notify|alert|failure|cancelPrompt)\(\s*ctx\s*,\s*"([^"]+)"/g;
const DIRECT_ANSWER_PATTERN = /answerCallbackQuery\(\{[^}]*text:\s*t\(\s*"([^"]+)"/g;

function collectSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return collectSourceFiles(fullPath);
    }
    return entry.name.endsWith(".ts") ? [fullPath] : [];
  });
}

function collectCallbackAnswerKeys(): Set<string> {
  const keys = new Set<string>();

  for (const file of collectSourceFiles(BOT_SOURCE_ROOT)) {
    const source = fs.readFileSync(file, "utf8");

    for (const pattern of [HELPER_CALL_PATTERN, DIRECT_ANSWER_PATTERN]) {
      pattern.lastIndex = 0;
      let match = pattern.exec(source);
      while (match !== null) {
        keys.add(defined(match[1]));
        match = pattern.exec(source);
      }
    }
  }

  return keys;
}

describe("callback answer length", () => {
  const keys = collectCallbackAnswerKeys();

  it("finds the keys used in callback answers", () => {
    expect(keys.size).toBeGreaterThan(0);
    expect(keys.has("common.cancelled")).toBe(true);
  });

  it("keeps every callback answer within the Telegram limit in every locale", () => {
    const violations: string[] = [];

    for (const key of keys) {
      if (!(key in en)) {
        violations.push(`${key}: not a known i18n key`);
        continue;
      }

      for (const [code, dictionary] of Object.entries(LOCALES)) {
        const text = dictionary[key as I18nKey];
        if (text.length > CALLBACK_ANSWER_MAX_LENGTH) {
          violations.push(
            `${key} (${code}): ${text.length} chars > ${CALLBACK_ANSWER_MAX_LENGTH}`,
          );
        }
      }
    }

    expect(violations, "callback answers exceeding the Telegram limit").toEqual([]);
  });
});
