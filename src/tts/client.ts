import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import textToSpeech from "@google-cloud/text-to-speech";

const TTS_REQUEST_TIMEOUT_MS = 60_000;

export interface TtsResult {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

export function isTtsConfigured(): boolean {
  if (config.tts.provider === "google") {
    return Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  }
  return Boolean(config.tts.apiUrl && config.tts.apiKey);
}

/**
 * Strip markdown formatting from text before sending to TTS.
 * Removes: **bold**, *italic*, `code`, ```code blocks```, ~~strikethrough~~,
 *          [link text](url), # headings, > blockquotes, - / * list markers,
 *          bare URLs, HTML tags.
 */
function stripMarkdownForSpeech(text: string): string {
  let clean = text;

  // Code blocks (```...```) — replace with content on one line
  clean = clean.replace(/```[\s\S]*?```/g, (match) => {
    const inner = match.replace(/^```\w*\n?/, "").replace(/\n?```$/, "");
    return inner.replace(/\n/g, " ");
  });

  // Inline code (`...`) — just remove backticks
  clean = clean.replace(/`([^`]+)`/g, "$1");

  // Bold + italic (***) — remove markers only
  clean = clean.replace(/\*\*\*(.+?)\*\*\*/g, "$1");

  // Bold (**) — remove markers only
  clean = clean.replace(/\*\*(.+?)\*\*/g, "$1");

  // Italic (*) — remove markers only
  clean = clean.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "$1");

  // Strikethrough (~~)
  clean = clean.replace(/~~(.+?)~~/g, "$1");

  // Links [text](url) → text
  clean = clean.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // Headings (# at start of line)
  clean = clean.replace(/^#{1,6}\s+/gm, "");

  // Blockquotes (> at start of line)
  clean = clean.replace(/^>\s?/gm, "");

  // Unordered list markers (- or * at start of line) — keep the text
  clean = clean.replace(/^[\-\*]\s+/gm, "");

  // Ordered list markers (1. at start of line)
  clean = clean.replace(/^\d+\.\s+/gm, "");

  // Horizontal rules (---, ***, ___)
  clean = clean.replace(/^[\-\*\_]{3,}\s*$/gm, "");

  // HTML tags
  clean = clean.replace(/<[^>]+>/g, "");

  // Collapse multiple whitespace into single space
  clean = clean.replace(/[ \t]+/g, " ");

  // Collapse multiple newlines into max one
  clean = clean.replace(/\n{3,}/g, "\n\n");

  return clean.trim();
}

function extractLanguageCode(voiceName: string): string {
  // Voice names follow the pattern: ll-CC-Type-Gender (e.g. "de-DE-Neural2-B")
  const match = voiceName.match(/^([a-z]{2}-[A-Z]{2})/);
  return match ? match[1] : "en-US";
}

async function synthesizeWithGoogle(text: string): Promise<TtsResult> {
  const client = new textToSpeech.TextToSpeechClient();

  const voiceName = config.tts.voice || "de-DE-Neural2-B";
  const languageCode = extractLanguageCode(voiceName);

  logger.debug(
    `[TTS] Google Cloud TTS: voice=${voiceName}, languageCode=${languageCode}, chars=${text.length}`,
  );

  const [response] = await client.synthesizeSpeech({
    input: { text },
    voice: {
      languageCode,
      name: voiceName,
    },
    audioConfig: { audioEncoding: "MP3" },
  });

  const buffer = response.audioContent as Buffer;
  if (!buffer || buffer.length === 0) {
    throw new Error("Google TTS API returned an empty audio response");
  }

  return {
    buffer,
    filename: "assistant-reply.mp3",
    mimeType: "audio/mpeg",
  };
}

async function synthesizeWithOpenAi(text: string): Promise<TtsResult> {
  const input = text.trim();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TTS_REQUEST_TIMEOUT_MS);

  try {
    const url = `${config.tts.apiUrl}/audio/speech`;

    logger.debug(
      `[TTS] Sending speech synthesis request: url=${url}, model=${config.tts.model}, voice=${config.tts.voice}, chars=${input.length}`,
    );

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.tts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.tts.model,
        voice: config.tts.voice,
        input,
        response_format: "mp3",
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(
        `TTS API returned HTTP ${response.status}: ${errorBody || response.statusText}`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length === 0) {
      throw new Error("TTS API returned an empty audio response");
    }

    logger.debug(`[TTS] Generated speech audio: ${buffer.length} bytes`);

    return {
      buffer,
      filename: "assistant-reply.mp3",
      mimeType: "audio/mpeg",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function synthesizeSpeech(text: string): Promise<TtsResult> {
  if (!isTtsConfigured()) {
    throw new Error("TTS is not configured: set TTS API credentials");
  }

  const raw = text.trim();
  if (!raw) {
    throw new Error("TTS input text is empty");
  }

  const input = stripMarkdownForSpeech(raw);

  try {
    if (config.tts.provider === "google") {
      return await synthesizeWithGoogle(input);
    }
    return await synthesizeWithOpenAi(input);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`TTS request timed out after ${TTS_REQUEST_TIMEOUT_MS}ms`);
    }

    throw err;
  }
}
