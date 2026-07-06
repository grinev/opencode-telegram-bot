import { config } from "../../config.js";
import { logger } from "../../utils/logger.js";
import textToSpeech from "@google-cloud/text-to-speech";
import { synthesizeWithEdgeTts, EDGE_DEFAULT_VOICE } from "./edge-tts.js";

const TTS_REQUEST_TIMEOUT_MS = 60_000;
const MAX_TTS_INPUT_CHARS = 4_000;

export interface TtsResult {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

type PromptResponseMode = "text_only" | "text_and_tts";

interface PrepareTtsResponseParams {
  sessionId: string;
  text: string;
  consumeResponseMode: (sessionId: string) => PromptResponseMode | null;
  isTtsConfigured?: () => boolean;
  synthesizeSpeech?: (text: string) => Promise<TtsResult>;
}

export type PreparedTtsResponse =
  | { shouldSend: false }
  | { shouldSend: true; speech: TtsResult };

export function isTtsConfigured(): boolean {
  if (config.tts.provider === "google") {
    return Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  }
  if (config.tts.provider === "edge") {
    return true;
  }
  return Boolean(config.tts.apiUrl && config.tts.apiKey);
}

/**
 * Removes markdown syntax that TTS engines would read aloud
 * (asterisks, backticks, heading markers, etc.).
 */
export function stripMarkdownForSpeech(text: string): string {
  let clean = text;

  // fenced code blocks → inline content
  clean = clean.replace(/```[\s\S]*?```/g, (match) => {
    const inner = match.replace(/^```\w*\n?/, "").replace(/\n?```$/, "");
    return inner.replace(/\n/g, " ");
  });

  clean = clean.replace(/`([^`]+)`/g, "$1");
  clean = clean.replace(/\*\*\*(.+?)\*\*\*/g, "$1");
  clean = clean.replace(/\*\*(.+?)\*\*/g, "$1");
  clean = clean.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "$1");
  clean = clean.replace(/~~(.+?)~~/g, "$1");
  clean = clean.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  clean = clean.replace(/^#{1,6}\s+/gm, "");
  clean = clean.replace(/^>\s?/gm, "");
  clean = clean.replace(/^[-*]\s+/gm, "");
  clean = clean.replace(/^\d+\.\s+/gm, "");
  clean = clean.replace(/^[-*_]{3,}\s*$/gm, "");
  clean = clean.replace(/<\/?[A-Za-z][^>]*>/g, "");
  clean = clean.replace(/[ \t]+/g, " ");
  clean = clean.replace(/\n{3,}/g, "\n\n");

  return clean.trim();
}

/** Extracts "ll-CC" from Google voice names like "de-DE-Neural2-B". */
export function extractLanguageCode(voiceName: string): string {
  const match = voiceName.match(/^([a-z]{2,3}-[A-Z]{2})/);
  return match ? match[1] : "en-US";
}

// --- Provider implementations ---

let googleClient: textToSpeech.TextToSpeechClient | null = null;

function getGoogleClient(): textToSpeech.TextToSpeechClient {
  if (!googleClient) {
    googleClient = new textToSpeech.TextToSpeechClient();
  }
  return googleClient;
}

/** @internal Reset Google client singleton (for tests only). */
export function _resetGoogleClient(): void {
  googleClient = null;
}

async function synthesizeWithGoogle(text: string): Promise<TtsResult> {
  const client = getGoogleClient();
  const voiceName = config.tts.voice || "en-US-Studio-O";
  const languageCode = extractLanguageCode(voiceName);

  logger.debug(
    `[TTS] Google Cloud TTS: voice=${voiceName}, languageCode=${languageCode}, chars=${text.length}`,
  );

  const [response] = await client.synthesizeSpeech(
    {
      input: { text },
      voice: { languageCode, name: voiceName },
      audioConfig: { audioEncoding: "MP3" },
    },
    { timeout: TTS_REQUEST_TIMEOUT_MS },
  );

  const raw = response.audioContent;
  const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as Uint8Array);
  if (buffer.length === 0) {
    throw new Error("Google TTS API returned an empty audio response");
  }

  return { buffer, filename: "assistant-reply.mp3", mimeType: "audio/mpeg" };
}

async function synthesizeWithOpenAi(text: string): Promise<TtsResult> {
  const url = `${config.tts.apiUrl}/audio/speech`;

  logger.debug(
    `[TTS] OpenAI-compatible: url=${url}, model=${config.tts.model}, voice=${config.tts.voice}, chars=${text.length}`,
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TTS_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.tts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.tts.model,
        voice: config.tts.voice,
        input: text,
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

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) {
      throw new Error("TTS API returned an empty audio response");
    }

    logger.debug(`[TTS] Generated speech audio: ${buffer.length} bytes`);
    return { buffer, filename: "assistant-reply.mp3", mimeType: "audio/mpeg" };
  } finally {
    clearTimeout(timeout);
  }
}

async function synthesizeWithElevenLabs(text: string): Promise<TtsResult> {
  const apiUrl = config.tts.apiUrl.replace(/\/+$/, "");
  const voiceId = config.tts.voice || "21m00Tcm4TlvDq8ikWAM";
  const url = `${apiUrl}/text-to-speech/${encodeURIComponent(voiceId)}`;

  logger.debug(
    `[TTS] ElevenLabs: url=${url}, model=${config.tts.model}, voice=${voiceId}, chars=${text.length}`,
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TTS_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": config.tts.apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: config.tts.model || "eleven_flash_v2_5",
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(
        `TTS API returned HTTP ${response.status}: ${errorBody || response.statusText}`,
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) {
      throw new Error("ElevenLabs TTS API returned an empty audio response");
    }

    logger.debug(`[TTS] Generated ElevenLabs speech audio: ${buffer.length} bytes`);
    return { buffer, filename: "assistant-reply.mp3", mimeType: "audio/mpeg" };
  } finally {
    clearTimeout(timeout);
  }
}

async function synthesizeWithEdge(text: string): Promise<TtsResult> {
  const voice = config.tts.voice || EDGE_DEFAULT_VOICE;

  logger.debug(
    `[TTS] Edge: voice=${voice}, chars=${text.length}`,
  );

  const buffer = await synthesizeWithEdgeTts(text, {
    voice,
    timeoutMs: TTS_REQUEST_TIMEOUT_MS,
  });
  if (buffer.length === 0) {
    throw new Error("Edge TTS returned an empty audio response");
  }

  logger.debug(`[TTS] Generated Edge speech audio: ${buffer.length} bytes`);
  return { buffer, filename: "assistant-reply.mp3", mimeType: "audio/mpeg" };
}

// --- Public API ---

function getNotConfiguredMessage(): string {
  if (config.tts.provider === "google") {
    return "TTS is not configured: set GOOGLE_APPLICATION_CREDENTIALS for Google Cloud TTS";
  }
  if (config.tts.provider === "elevenlabs") {
    return "TTS is not configured: set TTS_API_URL and TTS_API_KEY for ElevenLabs";
  }
  // No "edge" branch: isTtsConfigured() is always true for edge, so this
  // function is unreachable for that provider.
  return "TTS is not configured: set TTS_API_URL and TTS_API_KEY";
}

export async function synthesizeSpeech(text: string): Promise<TtsResult> {
  if (!isTtsConfigured()) {
    throw new Error(getNotConfiguredMessage());
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
    if (config.tts.provider === "elevenlabs") {
      return await synthesizeWithElevenLabs(input);
    }
    if (config.tts.provider === "edge") {
      return await synthesizeWithEdge(input);
    }
    return await synthesizeWithOpenAi(input);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`TTS request timed out after ${TTS_REQUEST_TIMEOUT_MS}ms`);
    }
    throw err;
  }
}

export async function prepareTtsResponseForSession({
  sessionId,
  text,
  consumeResponseMode,
  isTtsConfigured: isTtsConfiguredImpl = isTtsConfigured,
  synthesizeSpeech: synthesizeSpeechImpl = synthesizeSpeech,
}: PrepareTtsResponseParams): Promise<PreparedTtsResponse> {
  const responseMode = consumeResponseMode(sessionId);
  if (responseMode !== "text_and_tts") {
    return { shouldSend: false };
  }

  const normalizedText = text.trim();
  if (!normalizedText) {
    return { shouldSend: false };
  }

  if (!isTtsConfiguredImpl()) {
    logger.info(`[TTS] Skipping audio reply for session ${sessionId}: TTS is not configured`);
    return { shouldSend: false };
  }

  if (normalizedText.length > MAX_TTS_INPUT_CHARS) {
    logger.warn(
      `[TTS] Skipping audio reply for session ${sessionId}: text length ${normalizedText.length} exceeds limit ${MAX_TTS_INPUT_CHARS}`,
    );
    return { shouldSend: false };
  }

  return { shouldSend: true, speech: await synthesizeSpeechImpl(normalizedText) };
}
