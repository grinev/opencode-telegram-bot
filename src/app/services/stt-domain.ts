import { logger } from "../../utils/logger.js";

/**
 * STT domain glossary: hotwords bias the ASR provider towards domain-specific
 * vocabulary (product names, technical terms), while corrections fix recurring
 * misheard tokens after transcription.
 *
 * Loaded from a JSON file (`STT_DOMAIN_FILE`):
 *
 * ```json
 * {
 *   "hotwords": ["rudabook", "mergea", "schedules"],
 *   "corrections": { "rutabug": "rudabook", "esquetules": "schedules" }
 * }
 * ```
 */
export interface SttDomain {
  /** Words/phrases sent to the ASR provider as a biasing prompt. */
  hotwords: string[];
  /** Post-transcription replacements: misheard token -> canonical token. */
  corrections: Record<string, string>;
}

export const EMPTY_STT_DOMAIN: SttDomain = { hotwords: [], corrections: {} };

/** Vowel (and ñ) variants so corrections also match accented ASR output. */
const DIACRITICS: Record<string, string> = {
  a: "[aáàäâ]",
  e: "[eéèëê]",
  i: "[iíìïî]",
  o: "[oóòöô]",
  u: "[uúùüû]",
  n: "[nñ]",
};

function escapeLiteralChar(char: string): string {
  return char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildKeyPattern(key: string): RegExp {
  const body = [...key.toLowerCase()]
    .map((char) => DIACRITICS[char] ?? escapeLiteralChar(char))
    .join("");
  return new RegExp(`\\b${body}\\b`, "gi");
}

export function applySttCorrections(text: string, corrections: Record<string, string>): string {
  const keys = Object.keys(corrections).sort((a, b) => b.length - a.length);
  let result = text;
  for (const key of keys) {
    if (!key) continue;
    result = result.replace(buildKeyPattern(key), corrections[key]);
  }
  return result;
}

export function buildSttPrompt(hotwords: string[]): string {
  const cleaned = hotwords.map((word) => word.trim()).filter((word) => word.length > 0);
  if (cleaned.length === 0) {
    return "";
  }
  return `Technical terms: ${cleaned.join(", ")}.`;
}

export function parseSttDomain(data: unknown): SttDomain {
  if (typeof data !== "object" || data === null) {
    return EMPTY_STT_DOMAIN;
  }

  const raw = data as Record<string, unknown>;

  const hotwords = Array.isArray(raw.hotwords)
    ? raw.hotwords.filter(
        (word): word is string => typeof word === "string" && word.trim().length > 0,
      )
    : [];

  const corrections: Record<string, string> = {};
  if (typeof raw.corrections === "object" && raw.corrections !== null) {
    for (const [from, to] of Object.entries(raw.corrections as Record<string, unknown>)) {
      if (typeof to === "string" && to.length > 0 && from.length > 0) {
        corrections[from] = to;
      }
    }
  }

  return { hotwords, corrections };
}

/**
 * Loads the STT domain file. Returns an empty domain (and logs a warning)
 * when the path is unset, the file is missing, or its content is invalid.
 */
export async function loadSttDomain(path: string | undefined): Promise<SttDomain> {
  if (!path) {
    return EMPTY_STT_DOMAIN;
  }

  try {
    const file = Bun.file(path);
    if (!(await file.exists())) {
      logger.warn(`[STT] Domain file not found: ${path}`);
      return EMPTY_STT_DOMAIN;
    }
    return parseSttDomain(await file.json());
  } catch (err) {
    logger.warn(`[STT] Failed to load domain file ${path}: ${err}`);
    return EMPTY_STT_DOMAIN;
  }
}
