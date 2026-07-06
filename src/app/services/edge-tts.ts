import { createHash, randomBytes, randomUUID } from "crypto";
import { WebSocket } from "ws";
import { logger } from "../../utils/logger.js";

/**
 * Microsoft Edge online text-to-speech client.
 *
 * Speaks the same WebSocket protocol used by Microsoft Edge's Read Aloud
 * feature (wss://speech.platform.bing.com/.../readaloud/edge/v1). No API key
 * is required; access is authenticated through a SHA256 "Sec-MS-GEC" token
 * derived from the current time.
 *
 * Ported from the Python reference implementation at
 * https://github.com/rany2/edge-tts.
 */

const BASE_URL = "speech.platform.bing.com/consumer/speech/synthesize/readaloud";
const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const WSS_URL = `wss://${BASE_URL}/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`;

const CHROMIUM_FULL_VERSION = "143.0.3650.75";
const CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split(".")[0];
export const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;

export const EDGE_DEFAULT_VOICE = "en-US-EmmaMultilingualNeural";

const WIN_EPOCH_SECONDS = 11644473600;
const TICKS_PER_SECOND = 10_000_000;
const ROUND_SECONDS = 300;

const WSS_HEADERS: Record<string, string> = {
  Pragma: "no-cache",
  "Cache-Control": "no-cache",
  Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
  "User-Agent":
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ` +
    `(KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 ` +
    `Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Accept-Language": "en-US,en;q=0.9",
};

const SYNTHESIS_TIMEOUT_MS = 60_000;
const MAX_CHUNK_BYTES = 4096;

let clockSkewSeconds = 0;

/**
 * Generates the Sec-MS-GEC DRM token Microsoft requires on every request.
 *
 * The token is the SHA256 (uppercased hex) of `<ticks><token>` where `ticks`
 * is the current time as Windows file time (100-ns intervals since 1601-01-01)
 * rounded down to the nearest 5 minutes. Rounded to limit token churn; the
 * server accepts any token valid within the current 5-minute window.
 */
export function generateSecMsGec(now: Date = new Date()): string {
  let seconds = now.getTime() / 1000 + clockSkewSeconds + WIN_EPOCH_SECONDS;
  seconds -= seconds % ROUND_SECONDS;
  const ticks = BigInt(Math.round(seconds)) * BigInt(TICKS_PER_SECOND);
  const strToHash = `${ticks}${TRUSTED_CLIENT_TOKEN}`;
  return createHash("sha256").update(strToHash, "ascii").digest("hex").toUpperCase();
}

/** @internal Reset clock skew (for tests only). */
export function _resetClockSkew(): void {
  clockSkewSeconds = 0;
}

function generateMuid(): string {
  return randomBytes(16).toString("hex").toUpperCase();
}

function connectId(): string {
  return randomUUID().replace(/-/g, "");
}

/** Formats like JS `Date.toString()` in UTC, the X-Timestamp shape Edge sends. */
function jsDateString(date: Date = new Date()): string {
  // toUTCString gives "Fri, 01 Jan 2024 00:00:00 GMT"; reorder its tokens.
  const [day, dayNum, month, year, time] = date.toUTCString().replace(",", "").split(" ");
  return `${day} ${month} ${dayNum} ${year} ${time} GMT+0000 (Coordinated Universal Time)`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Escapes a value for interpolation into a single-quoted XML attribute. */
function escapeXmlAttribute(value: string): string {
  return escapeXml(value).replace(/'/g, "&apos;").replace(/"/g, "&quot;");
}

/**
 * Replaces control characters the service rejects (0x00-0x08, 0x0B-0x0C,
 * 0x0E-0x1F) with spaces. Common in OCR'd text; without this the service
 * returns an error.
 */
function removeIncompatibleCharacters(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ");
}

/** Moves a split point back so it does not land inside an XML entity (&amp;). */
function adjustForXmlEntity(buf: Buffer, splitAt: number): number {
  let result = splitAt;
  while (result > 0) {
    const ampersandIndex = buf.subarray(0, result).lastIndexOf("&");
    if (ampersandIndex < 0) break;
    if (buf.subarray(ampersandIndex, result).includes(";")) break;
    result = ampersandIndex;
  }
  return result;
}

/**
 * Splits text into chunks no larger than `byteLength` UTF-8 bytes, preferring
 * to break at newlines or spaces and never inside a multi-byte character or
 * XML entity. Mirrors edge-tts's split_text_by_byte_length.
 */
export function splitTextByByteLength(text: string, byteLength: number): string[] {
  if (byteLength <= 0) {
    throw new Error("byteLength must be greater than 0");
  }
  let rest = Buffer.from(text, "utf-8");
  const chunks: string[] = [];
  while (rest.length > byteLength) {
    let splitAt = rest.lastIndexOf(0x0a, byteLength - 1);
    if (splitAt < 0) splitAt = rest.lastIndexOf(0x20, byteLength - 1);
    if (splitAt < 0) {
      splitAt = byteLength;
      // Back up while the byte at the split is a UTF-8 continuation byte
      // (10xxxxxx) so the cut never lands inside a multi-byte character.
      while (splitAt > 0 && (rest[splitAt] & 0xc0) === 0x80) {
        splitAt--;
      }
    }
    splitAt = adjustForXmlEntity(rest, splitAt);
    if (splitAt <= 0) splitAt = 1;
    const chunk = rest.subarray(0, splitAt).toString("utf-8").trim();
    if (chunk) chunks.push(chunk);
    rest = rest.subarray(splitAt);
  }
  const remaining = rest.toString("utf-8").trim();
  if (remaining) chunks.push(remaining);
  return chunks;
}

function buildSsml(
  voice: string,
  rate: string,
  volume: string,
  pitch: string,
  text: string,
): string {
  return (
    "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
    `<voice name='${escapeXmlAttribute(voice)}'>` +
    `<prosody pitch='${escapeXmlAttribute(pitch)}' rate='${escapeXmlAttribute(rate)}' ` +
    `volume='${escapeXmlAttribute(volume)}'>` +
    text +
    "</prosody></voice></speak>"
  );
}

function parseRfc2616Date(date: string): number | null {
  const parsed = Date.parse(date);
  return Number.isNaN(parsed) ? null : parsed / 1000;
}

class EdgeHttpUpgradeError extends Error {
  readonly statusCode: number;
  readonly serverDate: string | null;
  constructor(statusCode: number, serverDate: string | null) {
    super(`Edge TTS WebSocket upgrade failed: HTTP ${statusCode}`);
    this.name = "EdgeHttpUpgradeError";
    this.statusCode = statusCode;
    this.serverDate = serverDate;
  }
}

interface SynthesisParams {
  voice: string;
  rate: string;
  volume: string;
  pitch: string;
  /** Absolute wall-clock time (ms epoch) the whole synthesis must finish by. */
  deadline: number;
  /** The total budget the deadline was derived from, for error messages. */
  timeoutMs: number;
}

/**
 * Synthesizes one SSML chunk over its own WebSocket connection and resolves
 * with that chunk's MP3 audio bytes. Retries once on HTTP 403 (clock skew) by
 * re-deriving the token against the server's reported time.
 *
 * The upstream edge-tts client also opens a fresh connection per chunk; the
 * service does not reliably accept a second SSML turn on the same socket.
 */
async function synthesizeChunk(chunk: string, params: SynthesisParams): Promise<Buffer> {
  try {
    return await attemptSynthesis(chunk, params);
  } catch (err) {
    if (err instanceof EdgeHttpUpgradeError && err.statusCode === 403 && err.serverDate) {
      const serverTime = parseRfc2616Date(err.serverDate);
      if (serverTime !== null) {
        clockSkewSeconds = serverTime - Date.now() / 1000;
        logger.warn(
          `[EdgeTTS] HTTP 403: adjusted clock skew to ${clockSkewSeconds.toFixed(1)}s, retrying`,
        );
        return await attemptSynthesis(chunk, params);
      }
    }
    throw err;
  }
}

function attemptSynthesis(chunk: string, params: SynthesisParams): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const gec = generateSecMsGec();
    const url =
      `${WSS_URL}&ConnectionId=${connectId()}` +
      `&Sec-MS-GEC=${gec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;
    const headers = { ...WSS_HEADERS, Cookie: `muid=${generateMuid()};` };

    const ws = new WebSocket(url, { headers });
    const audioChunks: Buffer[] = [];
    let audioReceived = false;
    let settled = false;
    let timer: NodeJS.Timeout | null = null;

    const finish = (error: Error | null, result?: Buffer): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      ws.removeAllListeners();
      // Closing a still-connecting socket makes ws emit 'error' on the next
      // tick; with no listener that is an uncaught exception, so keep a sink.
      ws.on("error", () => {});
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      if (error) reject(error);
      else resolve(result ?? Buffer.alloc(0));
    };

    timer = setTimeout(
      () => {
        finish(new Error(`Edge TTS synthesis timed out after ${params.timeoutMs}ms`));
      },
      Math.max(0, params.deadline - Date.now()),
    );

    ws.on("unexpected-response", (_req, res) => {
      const statusCode = res.statusCode ?? 0;
      const serverDate = (res.headers["date"] as string | undefined) ?? null;
      finish(new EdgeHttpUpgradeError(statusCode, serverDate));
    });

    ws.on("error", (err: NodeJS.ErrnoException) => {
      if (!settled) finish(err);
    });

    ws.on("open", () => {
      const configMessage =
        `X-Timestamp:${jsDateString()}\r\n` +
        "Content-Type:application/json; charset=utf-8\r\n" +
        "Path:speech.config\r\n\r\n" +
        '{"context":{"synthesis":{"audio":{"metadataoptions":' +
        '{"sentenceBoundaryEnabled":"true","wordBoundaryEnabled":"false"},' +
        '"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}';
      ws.send(configMessage);

      const ssml = buildSsml(params.voice, params.rate, params.volume, params.pitch, chunk);
      const ssmlMessage =
        `X-RequestId:${connectId()}\r\n` +
        "Content-Type:application/ssml+xml\r\n" +
        `X-Timestamp:${jsDateString()}Z\r\n` +
        "Path:ssml\r\n\r\n" +
        ssml;
      ws.send(ssmlMessage);
    });

    ws.on("message", (data, isBinary) => {
      if (settled) return;
      const buf = Buffer.isBuffer(data)
        ? data
        : Array.isArray(data)
          ? Buffer.concat(data)
          : Buffer.from(data as ArrayBuffer);

      if (isBinary) {
        if (buf.length < 2) {
          finish(new Error("Edge TTS: binary message too short"));
          return;
        }
        // Binary frames: [2-byte big-endian header length][headers + \r\n][audio].
        // The length value includes the trailing \r\n terminator, so audio
        // starts immediately at offset 2 + headerLength.
        const headerLength = buf.readUInt16BE(0);
        if (2 + headerLength > buf.length) {
          finish(new Error("Edge TTS: binary header length exceeds message"));
          return;
        }
        const headersBlock = buf.subarray(2, 2 + headerLength).toString("utf-8");
        if (!headersBlock.includes("Path:audio")) return;
        const audioStart = 2 + headerLength;
        const audio = audioStart < buf.length ? buf.subarray(audioStart) : Buffer.alloc(0);
        if (audio.length > 0) {
          audioChunks.push(audio);
          audioReceived = true;
        }
        return;
      }

      const text = buf.toString("utf-8");
      const sep = text.indexOf("\r\n\r\n");
      const headerBlock = sep >= 0 ? text.slice(0, sep) : text;
      if (!headerBlock.includes("Path:turn.end")) return;

      if (!audioReceived) {
        finish(new Error("Edge TTS: no audio received from service"));
      } else {
        finish(null, Buffer.concat(audioChunks));
      }
    });

    // A close before turn.end means the turn never completed; partial audio
    // must not be returned as success.
    ws.on("close", () => {
      if (!settled) {
        finish(new Error("Edge TTS: connection closed before synthesis completed"));
      }
    });
  });
}

export interface EdgeTtsOptions {
  voice: string;
  rate?: string;
  volume?: string;
  pitch?: string;
  /** Total time budget for the whole synthesis, across all chunks. */
  timeoutMs?: number;
}

/**
 * Synthesizes `text` to an MP3 Buffer using Microsoft Edge's online TTS.
 * Throws on protocol errors, timeouts, or if no audio is returned. The
 * timeout bounds the entire synthesis, however many chunks it spans, so the
 * caller-visible deadline matches the other TTS providers.
 */
export async function synthesizeWithEdgeTts(
  text: string,
  options: EdgeTtsOptions,
): Promise<Buffer> {
  const voice = options.voice || EDGE_DEFAULT_VOICE;
  const rate = options.rate ?? "+0%";
  const volume = options.volume ?? "+0%";
  const pitch = options.pitch ?? "+0Hz";
  const timeoutMs = options.timeoutMs ?? SYNTHESIS_TIMEOUT_MS;

  const cleaned = removeIncompatibleCharacters(text);
  const escaped = escapeXml(cleaned);
  const chunks = splitTextByByteLength(escaped, MAX_CHUNK_BYTES);

  logger.debug(
    `[EdgeTTS] Synthesizing: voice=${voice}, chunks=${chunks.length}, chars=${text.length}`,
  );

  const params: SynthesisParams = {
    voice,
    rate,
    volume,
    pitch,
    deadline: Date.now() + timeoutMs,
    timeoutMs,
  };
  const buffers: Buffer[] = [];
  for (const chunk of chunks) {
    buffers.push(await synthesizeChunk(chunk, params));
  }
  return Buffer.concat(buffers);
}
