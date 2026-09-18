import { config } from "../../config.js";
import { logger } from "../../utils/logger.js";
import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";

let vosk: typeof import("vosk") | null = null;

async function loadVosk(): Promise<typeof import("vosk")> {
  if (!vosk) {
    vosk = await import("vosk");
  }
  return vosk;
}

export interface VoskSttResult {
  text: string;
}

/**
 * Checks if Vosk local STT is configured (model path exists).
 */
export function isVoskSttConfigured(): boolean {
  const modelPath = config.vosk?.modelPath;
  if (!modelPath) return false;

  const resolvedPath = path.resolve(modelPath);
  return fs.existsSync(resolvedPath);
}

/**
 * Gets the Vosk model path from config or default location.
 */
function getVoskModelPath(): string | null {
  if (config.vosk?.modelPath) {
    return path.resolve(config.vosk.modelPath);
  }

  // Check default locations
  const defaultPaths = [
    path.join(process.cwd(), "vosk-model"),
    path.join(process.cwd(), "models", "vosk-model"),
    path.join(process.env.HOME || process.env.USERPROFILE || "", ".vosk", "model"),
    path.join(process.env.APPDATA || "", "vosk", "model"),
  ];

  for (const p of defaultPaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

/**
 * Gets ffmpeg path from @ffmpeg-installer/ffmpeg package.
 */
let cachedFfmpegPath: string = "";

async function getFfmpegPath(): Promise<string> {
  if (cachedFfmpegPath) {
    logger.debug(`[VoskSTT] Using cached ffmpeg path: ${cachedFfmpegPath}`);
    return cachedFfmpegPath;
  }
  
  try {
    // Use dynamic import for ESM compatibility
    const ffmpegInstaller = await import("@ffmpeg-installer/ffmpeg");
    const resolvedPath = ffmpegInstaller.default?.path || ffmpegInstaller.path;
    
    if (!resolvedPath || resolvedPath === "ffmpeg") {
      throw new Error("ffmpeg-installer returned invalid path: " + resolvedPath);
    }
    
    cachedFfmpegPath = resolvedPath;
    logger.debug(`[VoskSTT] Resolved ffmpeg path: ${cachedFfmpegPath}`);
    return cachedFfmpegPath;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[VoskSTT] Failed to load @ffmpeg-installer/ffmpeg: ${msg}`);
    // Fallback to system PATH - DON'T cache this
    return "ffmpeg";
  }
}

/**
 * Converts audio buffer to PCM 16kHz mono using ffmpeg.
 */
async function convertToPcm16kHz(audioBuffer: Buffer, filename: string): Promise<Buffer> {
  // Check if it's already a WAV file with correct format
  const isWav = filename.toLowerCase().endsWith(".wav");
  
  if (isWav && audioBuffer.length > 44) {
    const sampleRate = audioBuffer.readUInt32LE(24);
    const channels = audioBuffer.readUInt16LE(22);
    const bitsPerSample = audioBuffer.readUInt16LE(34);
    
    if (sampleRate === 16000 && channels === 1 && bitsPerSample === 16) {
      return audioBuffer.subarray(44);
    }
  }

  // Convert using ffmpeg
  const ffmpegPath = await getFfmpegPath();
  logger.debug(`[VoskSTT] Converting audio using ffmpeg: ${ffmpegPath}`);

return new Promise((resolve, reject) => {
    const args = [
      "-i", "pipe:0",
      "-ar", "16000",
      "-ac", "1",
      "-c:a", "pcm_s16le",
      "-f", "wav",
      "pipe:1"
    ];

    logger.debug(`[VoskSTT] Spawning ffmpeg: ${ffmpegPath} ${args.join(" ")}`);
    
    const child = spawn(ffmpegPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsVerbatimArguments: true,
    });

    const outputChunks: Buffer[] = [];
    let stderr = "";

    child.stdout.on("data", (chunk) => outputChunks.push(chunk));
    child.stderr.on("data", (chunk) => stderr += chunk.toString());

    child.on("error", (err) => {
      reject(new Error(`Failed to start ffmpeg: ${err.message}. Make sure @ffmpeg-installer/ffmpeg is installed.`));
    });

    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg conversion failed (code ${code}): ${stderr}`));
        return;
      }

      const wavBuffer = Buffer.concat(outputChunks);
      
      // Skip WAV header (44 bytes) to get raw PCM data
      if (wavBuffer.length > 44) {
        const sampleRate = wavBuffer.readUInt32LE(24);
        const channels = wavBuffer.readUInt16LE(22);
        const bitsPerSample = wavBuffer.readUInt16LE(34);
        
        logger.debug(`[VoskSTT] Converted WAV: ${sampleRate}Hz, ${channels}ch, ${bitsPerSample}bit`);
        
        if (sampleRate === 16000 && channels === 1 && bitsPerSample === 16) {
          resolve(wavBuffer.subarray(44));
          return;
        }
      }
      
      reject(new Error("ffmpeg output is not valid 16kHz mono PCM WAV"));
    });

    // Write input audio to ffmpeg stdin
    child.stdin.write(audioBuffer);
    child.stdin.end();
  });
}

/**
 * Transcribes audio using Vosk (completely offline, no API key).
 * Requires a Vosk model to be downloaded and configured.
 */
export async function transcribeAudioVosk(audioBuffer: Buffer, filename: string): Promise<VoskSttResult> {
  const modelPath = getVoskModelPath();
  
  if (!modelPath) {
    throw new Error(
      "Vosk model not found. Please download a model and set VOSK_MODEL_PATH.\n" +
      "Download models from: https://alphacephei.com/vosk/models\n" +
      "Recommended small model (~50MB): vosk-model-small-en-us-0.15\n" +
      "Indonesian model: vosk-model-id-0.4\n" +
      "Then set in .env: VOSK_MODEL_PATH=./vosk-model"
    );
  }

  const voskLib = await loadVosk();
  
  // Convert audio to PCM 16kHz mono
  const pcmBuffer = await convertToPcm16kHz(audioBuffer, filename);
  
  logger.debug(`[VoskSTT] Using model: ${modelPath}, audio size: ${pcmBuffer.length} bytes`);

  return new Promise((resolve, reject) => {
    try {
      const model = new voskLib.Model(modelPath);
      const recognizer = new voskLib.Recognizer({ model, sampleRate: 16000 });
      
      let resultText = "";
      
      // Feed audio data in chunks
      const chunkSize = 4000; // bytes
      for (let i = 0; i < pcmBuffer.length; i += chunkSize) {
        const chunk = pcmBuffer.subarray(i, Math.min(i + chunkSize, pcmBuffer.length));
        
        if (recognizer.acceptWaveform(chunk)) {
          // Got a final result for this chunk
          const result = recognizer.result();
          if (result && typeof result === 'object' && result.text) {
            resultText += (resultText ? " " : "") + result.text;
          }
        }
      }
      
      // Signal end of audio and get final result
      const finalResult = recognizer.finalResult();
      if (finalResult && typeof finalResult === 'object' && finalResult.text) {
        resultText += (resultText ? " " : "") + finalResult.text;
      }
      
      model.free();
      recognizer.free();
      
      logger.debug(`[VoskSTT] Final transcription: ${resultText.trim()}`);
      resolve({ text: resultText.trim() });
      
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Gets a user-friendly message for when Vosk STT is not configured.
 */
export function getVoskSttNotConfiguredMessage(): string {
  return (
    "🎙️ Local Vosk STT is not configured.\n\n" +
    "To use completely offline speech recognition (no API key, no internet):\n\n" +
    "1. Download a Vosk model:\n" +
    "   • English (small, ~50MB): https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip\n" +
    "   • Indonesian (~1.5GB): https://alphacephei.com/vosk/models/vosk-model-id-0.4.zip\n" +
    "   • More models: https://alphacephei.com/vosk/models\n\n" +
    "2. Extract and place in your project:\n" +
    "   mkdir -p ./vosk-model\n" +
    "   unzip vosk-model-small-en-us-0.15.zip -d ./vosk-model\n\n" +
    "3. Add to .env:\n" +
    "   VOSK_MODEL_PATH=./vosk-model\n\n" +
    "4. Restart the bot.\n\n" +
    "Note: Vosk requires 16kHz mono WAV audio. Telegram sends OGG/Opus.\n" +
    "Conversion is now handled automatically using ffmpeg.\n\n" +
    "Alternative: Use free API STT (Groq) by setting STT_API_URL and STT_API_KEY instead."
  );
}