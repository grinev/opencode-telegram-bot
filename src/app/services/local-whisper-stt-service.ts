import { config } from "../../config.js";
import { logger } from "../../utils/logger.js";
import { spawn } from "child_process";

export interface WhisperSttResult {
  text: string;
}

type AsrPipeline = (
  audio: Float32Array,
  options?: Record<string, unknown>,
) => Promise<{ text?: string }>;

let transcriberPromise: Promise<AsrPipeline> | null = null;

/**
 * Lazily loads the transformers.js ASR pipeline (Whisper ONNX).
 * The model is downloaded from the Hugging Face Hub on the first run and
 * cached locally, so subsequent transcriptions work fully offline.
 */
async function loadTranscriber(): Promise<AsrPipeline> {
  if (!transcriberPromise) {
    transcriberPromise = (async () => {
      const model = config.whisper.model;
      logger.info(
        `[WhisperSTT] Loading whisper model ${model} (first run downloads the model, then runs offline)`,
      );
      const { pipeline } = await import("@huggingface/transformers");
      const transcriber = await pipeline("automatic-speech-recognition", model, {
        dtype: "q8",
      });
      logger.info("[WhisperSTT] Whisper model loaded");
      return transcriber as unknown as AsrPipeline;
    })().catch((err) => {
      transcriberPromise = null;
      throw err;
    });
  }
  return transcriberPromise;
}

/**
 * Checks if local Whisper STT is configured.
 * Transformers.js is a hard dependency, so this is always true.
 */
export function isWhisperSttConfigured(): boolean {
  return true;
}

/**
 * Gets ffmpeg path from @ffmpeg-installer/ffmpeg package.
 */
let cachedFfmpegPath: string = "";

async function getFfmpegPath(): Promise<string> {
  if (cachedFfmpegPath) {
    return cachedFfmpegPath;
  }

  try {
    const ffmpegInstaller = await import("@ffmpeg-installer/ffmpeg");
    const resolvedPath = ffmpegInstaller.default?.path || ffmpegInstaller.path;

    if (!resolvedPath || resolvedPath === "ffmpeg") {
      throw new Error("ffmpeg-installer returned invalid path: " + resolvedPath);
    }

    cachedFfmpegPath = resolvedPath;
    return resolvedPath;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[WhisperSTT] Failed to load @ffmpeg-installer/ffmpeg: ${msg}`);
    return "ffmpeg";
  }
}

/**
 * Converts audio buffer to mono 16kHz float32 PCM using ffmpeg.
 * Transformers.js Whisper expects a Float32Array sampled at 16kHz.
 */
async function convertToFloat32Pcm(
  audioBuffer: Buffer,
): Promise<Float32Array> {
  const ffmpegPath = await getFfmpegPath();

  return new Promise((resolve, reject) => {
    const args = [
      "-i", "pipe:0",
      "-ar", "16000",
      "-ac", "1",
      "-c:a", "pcm_f32le",
      "-f", "f32le",
      "pipe:1",
    ];

    const child = spawn(ffmpegPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsVerbatimArguments: true,
    });

    const outputChunks: Buffer[] = [];
    let stderr = "";

    child.stdout.on("data", (chunk) => outputChunks.push(chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));

    child.on("error", (err) => {
      reject(
        new Error(
          `Failed to start ffmpeg: ${err.message}. Make sure @ffmpeg-installer/ffmpeg is installed.`,
        ),
      );
    });

    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg conversion failed (code ${code}): ${stderr}`));
        return;
      }

      const f32Buffer = Buffer.concat(outputChunks);
      const samples = new Float32Array(
        f32Buffer.buffer,
        f32Buffer.byteOffset,
        f32Buffer.byteLength / 4,
      );

      if (samples.length === 0) {
        reject(new Error("ffmpeg produced no audio samples"));
        return;
      }

      resolve(samples);
    });

    child.stdin.write(audioBuffer);
    child.stdin.end();
  });
}

/**
 * Transcribes audio using local Whisper (transformers.js / onnxruntime-node).
 * Fully offline after the one-time model download, no API key required.
 */
export async function transcribeAudioWhisper(
  audioBuffer: Buffer,
  filename: string,
): Promise<WhisperSttResult> {
  const transcriber = await loadTranscriber();

  const audio = await convertToFloat32Pcm(audioBuffer);
  const durationSec = audio.length / 16000;

  logger.debug(
    `[WhisperSTT] Transcribing ${filename} (${durationSec.toFixed(1)}s audio)`,
  );

  const options: Record<string, unknown> = {
    task: "transcribe",
    language: config.stt.language || "id",
  };

  // Whisper handles 30s chunks; chunk long voice notes to avoid truncation.
  if (durationSec > 28) {
    options.chunk_length_s = 30;
    options.stride_length_s = 5;
  }

  const output = await transcriber(audio, options);
  const text = (output?.text ?? "").trim();

  if (!text) {
    logger.warn("[WhisperSTT] Whisper returned empty transcription");
  }

  logger.debug(`[WhisperSTT] Transcription result: ${text.length} chars`);
  return { text };
}

/**
 * Gets a user-friendly message for when Whisper STT is not configured.
 */
export function getWhisperSttNotConfiguredMessage(): string {
  return (
    "🎙️ Local Whisper STT requires the @huggingface/transformers package.\n\n" +
    "Run: npm install @huggingface/transformers\n\n" +
    "The whisper model is downloaded once on first voice message, " +
    "then runs fully offline. No API key required.\n\n" +
    "Optional .env:\n" +
    "   WHISPER_MODEL=onnx-community/whisper-small\n" +
    "   STT_LANGUAGE=id"
  );
}