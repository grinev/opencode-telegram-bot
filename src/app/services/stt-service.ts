import { config } from "../../config.js";
import { logger } from "../../utils/logger.js";
import { applySttCorrections, buildSttPrompt, loadSttDomain } from "./stt-domain.js";

const STT_REQUEST_TIMEOUT_MS = 60_000;

export interface SttResult {
  text: string;
}

const AUDIO_FORMAT_BY_EXTENSION: Record<string, string> = {
  oga: "ogg",
  ogg: "ogg",
  mp3: "mp3",
  wav: "wav",
  m4a: "m4a",
  flac: "flac",
  aac: "aac",
  webm: "webm",
};

/**
 * Returns true if STT is configured (API URL and API key are set).
 */
export function isSttConfigured(): boolean {
  return Boolean(config.stt.apiUrl && config.stt.apiKey);
}

function getAudioFormat(filename: string): string {
  const extension = (filename.split(".").pop() || "").toLowerCase();
  return AUDIO_FORMAT_BY_EXTENSION[extension] || "ogg";
}

/**
 * Transcribes an audio buffer using a Whisper-compatible API.
 *
 * Two request formats are supported via `STT_REQUEST_FORMAT`:
 * - `multipart` (default): standard OpenAI/Groq `multipart/form-data` upload.
 * - `json`: base64 audio in an `input_audio` JSON body (e.g. OpenRouter).
 *
 * @param audioBuffer - Raw audio file bytes (ogg, mp3, wav, m4a, webm, etc.)
 * @param filename    - Original filename with extension (used to detect format)
 * @returns Transcribed text
 * @throws Error if STT is not configured, the request fails, or the response is invalid
 */
export async function transcribeAudio(audioBuffer: Buffer, filename: string): Promise<SttResult> {
  if (!isSttConfigured()) {
    throw new Error("STT is not configured: STT_API_URL and STT_API_KEY are required");
  }

  const url = `${config.stt.apiUrl}/audio/transcriptions`;
  const useJsonFormat = config.stt.requestFormat === "json";
  const domain = await loadSttDomain(config.stt.domainFile);
  const hotwordPrompt = buildSttPrompt(domain.hotwords);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.stt.apiKey}`,
  };
  let body: FormData | string;

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

    logger.debug(
      `[STT] Sending transcription request (json): url=${url}, model=${config.stt.model}, format=${getAudioFormat(filename)}, size=${audioBuffer.length} bytes`,
    );
  } else {
    // Convert non-WAV audio (e.g. Telegram OGG/OPUS) to 16kHz mono WAV for
    // compatibility with Whisper servers that reject other containers.
    let uploadBuffer = audioBuffer;
    let uploadFilename = filename;
    if (!filename.endsWith(".wav") && !filename.endsWith(".WAV")) {
      const tmpIn = `/tmp/stt-convert-${Date.now()}.ogg`;
      const tmpOut = `/tmp/stt-convert-${Date.now()}.wav`;
      try {
        await Bun.write(tmpIn, audioBuffer);
        const proc = Bun.spawnSync(
          ["ffmpeg", "-i", tmpIn, "-f", "wav", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", "-y", tmpOut],
          {},
        );
        if (proc.exitCode === 0) {
          const wavBuf = await Bun.file(tmpOut).arrayBuffer();
          uploadBuffer = Buffer.from(wavBuf);
          uploadFilename = filename.replace(/\.[^.]+$/, ".wav");
          logger.debug(
            `[STT] Converted audio to WAV: ${uploadBuffer.length} bytes (was ${audioBuffer.length})`,
          );
        } else {
          logger.warn(`[STT] ffmpeg conversion failed (${proc.exitCode}), sending original format`);
        }
      } catch (err) {
        logger.warn(`[STT] ffmpeg conversion error: ${err}, sending original format`);
      } finally {
        try {
          await Bun.file(tmpIn).delete();
        } catch {}
        try {
          await Bun.file(tmpOut).delete();
        } catch {}
      }
    }

    const formData = new FormData();
    formData.append("file", new Blob([new Uint8Array(uploadBuffer)]), uploadFilename);
    formData.append("model", config.stt.model);
    formData.append("response_format", "json");

    if (config.stt.language) {
      formData.append("language", config.stt.language);
    }

    if (hotwordPrompt) {
      // `prompt` is a standard field for Whisper-compatible APIs; llama.cpp
      // forwards it to Qwen3-ASR as vocabulary/context biasing.
      formData.append("prompt", hotwordPrompt);
      logger.debug(`[STT] Biasing prompt: ${hotwordPrompt.length} chars`);
    }

    body = formData;

    logger.debug(
      `[STT] Sending transcription request (multipart): url=${url}, model=${config.stt.model}, filename=${uploadFilename}, size=${uploadBuffer.length} bytes`,
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STT_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(
        `STT API returned HTTP ${response.status}: ${errorBody || response.statusText}`,
      );
    }

    const data = (await response.json()) as { text?: string };

    if (typeof data.text !== "string") {
      throw new Error("STT API response does not contain a text field");
    }

    // Strip ASR formatting tags (llama.cpp Qwen3-ASR outputs "language X<asr_text>...")
    const cleanText = data.text
      .replace(/^language \w+<asr_text>\s*/, "")
      .replace(/<\|im_end\|>\s*$/, "")
      .trim();

    const text = applySttCorrections(cleanText, domain.corrections);

    logger.debug(
      `[STT] Transcription result: ${text.length} chars (raw: ${data.text.length}, corrected: ${text !== cleanText})`,
    );

    return { text };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`STT request timed out after ${STT_REQUEST_TIMEOUT_MS}ms`);
    }

    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
