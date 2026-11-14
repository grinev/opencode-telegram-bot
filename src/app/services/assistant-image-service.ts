import path from "node:path";
import { opencodeClient } from "../../opencode/client.js";
import { logger } from "../../utils/logger.js";

export const TELEGRAM_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export type AssistantImageFailure = "unavailable" | "unsupported" | "too_large";
export type AssistantImageResult =
  { bytes: Uint8Array; filename: string } | { reason: AssistantImageFailure };

export function normalizeAssistantImagePath(source: string): string | undefined {
  try {
    const decoded = decodeURIComponent(source).replace(/\\/g, "/");
    if (!decoded || /[\u0000-\u001f:%]/u.test(decoded) || decoded.startsWith("/")) return undefined;
    const relative = path.posix.normalize(decoded);
    if (relative === "." || relative === ".." || relative.startsWith("../")) return undefined;
    return relative;
  } catch {
    return undefined;
  }
}

function photoFormat(bytes: Buffer): string | undefined {
  if (
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "png";
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "jpg";
  if (
    bytes.length >= 30 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP" &&
    !bytes.includes(Buffer.from("ANIM"))
  )
    return "webp";
  return undefined;
}

export async function readAssistantImage(
  directory: string | undefined,
  source: string,
): Promise<AssistantImageResult> {
  const relative = normalizeAssistantImagePath(source);
  if (!directory || !relative) return { reason: "unavailable" };
  try {
    const result = await opencodeClient.file.read({ directory, path: relative });
    if (result.error || !result.data?.content) return { reason: "unavailable" };
    if (result.data.type !== "binary" || result.data.encoding !== "base64")
      return { reason: "unsupported" };
    // Check encoded length before allocating another copy of an oversized image.
    if (result.data.content.length > Math.ceil(TELEGRAM_PHOTO_MAX_BYTES / 3) * 4)
      return { reason: "too_large" };
    const bytes = Buffer.from(result.data.content, "base64");
    if (bytes.length > TELEGRAM_PHOTO_MAX_BYTES) return { reason: "too_large" };
    const format = photoFormat(bytes);
    if (!format)
      return { reason: /\.(?:png|jpe?g|webp)$/i.test(relative) ? "unavailable" : "unsupported" };
    if (format === "png") {
      const width = bytes.readUInt32BE(16);
      const height = bytes.readUInt32BE(20);
      if (!width || !height) return { reason: "unavailable" };
      if (width + height > 10000 || Math.max(width, height) / Math.min(width, height) > 20)
        return { reason: "too_large" };
    }
    return { bytes, filename: `image.${format}` };
  } catch (error) {
    logger.debug("[AssistantImage] Remote image read failed", { directory, path: relative, error });
    return { reason: "unavailable" };
  }
}
