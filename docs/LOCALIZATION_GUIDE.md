# Adding a New Localization

This project already has a centralized i18n structure, so adding a new locale is mostly a registration task.

## 1) Create a new locale dictionary file

Create a new file:

- `src/i18n/<locale>.ts`

Use this template:

```ts
import type { I18nDictionary } from "./en.js";

export const <locale>: I18nDictionary = {
  // Copy all keys from src/i18n/en.ts
  // Fill values for the new language
};
```

Notes:

- `I18nDictionary` enforces that all keys from `en.ts` are present.
- Keep placeholders unchanged (for example: `{title}`, `{count}`, `{language}`).
- Keep formatting tokens unchanged (for example: Markdown markers, `\n`, emoji if needed).

## 2) Register the locale in the central i18n registry

Update:

- `src/i18n/index.ts`

### 2.1 Import the new dictionary

Add an import near existing locale imports:

```ts
import { <locale> } from "./<locale>.js";
```

### 2.2 Add a locale definition entry

In `LOCALE_DEFINITIONS`, add a new object:

```ts
{
  code: "<locale-code>",
  label: "<Human-readable language name>",
  dateLocale: "<BCP-47 date locale>",
  dictionary: <locale>,
},
```

Example fields:

- `code`: short locale code used in `BOT_LOCALE` (for example `en`, `ru`, etc.)
- `label`: display name shown in setup wizard language selection
- `dateLocale`: locale used by `toLocaleDateString` (for example `en-US`, `ru-RU`)
- `dictionary`: the imported translation object

No other type updates are needed: `Locale`, `SUPPORTED_LOCALES`, and locale options are derived automatically from this registry.

## 3) Update docs

Update `README.md` for every new locale:

- language list
- localization section

Update `.env.example` add new language to supported languages list

## 4) Verify behavior

Run quality checks:

```bash
npm run build
npm run lint
npm test
```

Manual checks:

1. Set `BOT_LOCALE=<locale-code>` in `.env` and start the bot.
2. Confirm command descriptions and user-facing texts use the new language.
3. Run the setup wizard (`opencode-telegram config`) and verify:
   - new language appears in selection list
   - selection by number and by locale code works.
4. Check date rendering in session/project related messages.

## 5) Test policy for locale additions

By default, adding a new locale dictionary and registering it does not require new tests if localization logic is unchanged.

Add or update tests only if you change locale resolution/normalization behavior (for example alias handling).

Relevant test files if needed:

- `tests/i18n/index.test.ts`
- `tests/config.test.ts`

## Quick checklist

- [ ] Added `src/i18n/<locale>.ts`
- [ ] Imported locale in `src/i18n/index.ts`
- [ ] Added locale entry to `LOCALE_DEFINITIONS`
- [ ] Updated `README.md` (language list and localization section)
- [ ] Ran `npm run build`, `npm run lint`, `npm test`
- [ ] Manually validated `BOT_LOCALE` and wizard language selection
