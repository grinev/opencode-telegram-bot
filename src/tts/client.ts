import { config } from "../config.js";
import { logger } from "../utils/logger.js";

const TTS_REQUEST_TIMEOUT_MS = 60_000;

export interface TtsResult {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

export function isTtsConfigured(): boolean {
  return Boolean(config.tts.apiUrl && config.tts.apiKey);
}

export async function synthesizeSpeech(text: string): Promise<TtsResult> {
  if (!isTtsConfigured()) {
    throw new Error("TTS is not configured: set TTS API credentials");
  }

  const input = text.trim();
  if (!input) {
    throw new Error("TTS input text is empty");
  }

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
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`TTS request timed out after ${TTS_REQUEST_TIMEOUT_MS}ms`);
    }

    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
