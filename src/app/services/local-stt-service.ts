import { config } from "../../config.js";
import { logger } from "../../utils/logger.js";

export interface LocalSttResult {
  text: string;
}

const LOCAL_STT_TIMEOUT_MS = 60_000;

/**
 * Checks if local STT is configured (using free API like Groq).
 * This is a "local" mode that doesn't require paid API keys.
 */
export function isLocalSttConfigured(): boolean {
  // Check for Groq free API configuration
  return Boolean(config.stt.apiUrl && config.stt.apiKey);
}

/**
 * Transcribes audio using a free Whisper-compatible API (e.g., Groq).
 * This provides "local-like" functionality without requiring local compilation.
 */
export async function transcribeAudioLocal(audioBuffer: Buffer, filename: string): Promise<LocalSttResult> {
  if (!isLocalSttConfigured()) {
    throw new Error(
      "Local STT is not configured. Set STT_API_URL and STT_API_KEY for a free provider like Groq.\n" +
      "Example for Groq (free):\n" +
      "  STT_API_URL=https://api.groq.com/openai/v1\n" +
      "  STT_API_KEY=your_groq_api_key\n" +
      "  STT_MODEL=whisper-large-v3-turbo"
    );
  }

  const url = `${config.stt.apiUrl}/audio/transcriptions`;
  const useJsonFormat = config.stt.requestFormat === "json";

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.stt.apiKey}`,
  };
  let body: FormData | string;

  function getAudioFormat(filename: string): string {
    const extension = (filename.split(".").pop() || "").toLowerCase();
    const formats: Record<string, string> = {
      oga: "ogg",
      ogg: "ogg",
      mp3: "mp3",
      wav: "wav",
      m4a: "m4a",
      flac: "flac",
      aac: "aac",
      webm: "webm",
    };
    return formats[extension] || "ogg";
  }

  if (useJsonFormat) {
    const payload: Record<string, unknown> = {
      model: config.stt.model,
      input_audio: {
        data: Buffer.from(audioBuffer).toString("base64"),
        format: getAudioFormat(filename),
      },
    };

    if (config.stt.language) {
      payload.language = config.stt.language;
    }

    headers["Content-Type"] = "application/json";
    body = JSON.stringify(payload);
  } else {
    const formData = new FormData();
    formData.append("file", new Blob([new Uint8Array(audioBuffer)]), filename);
    formData.append("model", config.stt.model);
    formData.append("response_format", "json");

    if (config.stt.language) {
      formData.append("language", config.stt.language);
    }

    body = formData;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOCAL_STT_TIMEOUT_MS);

  try {
    logger.debug(`[LocalSTT] Transcribing: ${filename} (${audioBuffer.length} bytes)`);

    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(`Local STT API returned HTTP ${response.status}: ${errorBody || response.statusText}`);
    }

    const data = (await response.json()) as { text?: string };

    if (typeof data.text !== "string") {
      throw new Error("Local STT API response does not contain a text field");
    }

    logger.debug(`[LocalSTT] Transcription result: ${data.text.length} chars`);
    return { text: data.text };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`Local STT request timed out after ${LOCAL_STT_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Gets a user-friendly message for when local STT is not configured.
 */
export function getLocalSttNotConfiguredMessage(): string {
  return (
    "Local STT is not configured. To use free voice transcription:\n\n" +
    "1. Get a free API key from Groq: https://console.groq.com/keys\n" +
    "2. Add to your .env:\n" +
    "   STT_API_URL=https://api.groq.com/openai/v1\n" +
    "   STT_API_KEY=your_groq_key\n" +
    "   STT_MODEL=whisper-large-v3-turbo\n\n" +
    "Groq provides a generous free tier for Whisper transcription."
  );
}