import { config } from "../../config.js";
import { logger } from "../../utils/logger.js";

const VIDEO_MIME_EXTENSIONS: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
  "video/3gpp": "3gp",
  "video/x-msvideo": "avi",
};

/**
 * Picks a safe extension for a saved video: the MIME mapping wins, the Telegram
 * filename (when it carries a sane extension) is the fallback, mp4 the last resort.
 */
export function videoExtensionFor(mimeType?: string, filename?: string): string {
  const mapped = mimeType ? VIDEO_MIME_EXTENSIONS[mimeType] : undefined;
  if (mapped) {
    return mapped;
  }

  const extension = filename?.split(".").pop()?.toLowerCase();
  return extension && /^[a-z0-9]{1,5}$/.test(extension) ? extension : "mp4";
}

/**
 * Saves a downloaded video to the agent upload directory (LOCAL_VISION_UPLOAD_DIR,
 * same one used for photos) so the opencode agent can process the ORIGINAL file
 * itself (e.g. extract frames with ffmpeg) while working on the user's prompt.
 *
 * Returns the absolute path of the saved file.
 */
export async function saveVideoForAgent(
  buffer: Buffer,
  extension: string = "mp4",
  dir: string = config.vision.uploadDir,
): Promise<string> {
  const result = Bun.spawnSync(["mkdir", "-p", dir], { stdout: "ignore", stderr: "ignore" });
  if (result.exitCode !== 0) {
    throw new Error(`Failed to create upload directory ${dir} (exit ${result.exitCode})`);
  }
  const videoPath = `${dir}/video-${Date.now()}.${extension}`;
  await Bun.write(videoPath, buffer);
  logger.info(`[Bot] Video saved for agent inspection: ${videoPath}`);
  return videoPath;
}

/**
 * Agent-facing note appended to the prompt so the model knows the file is on
 * disk and can inspect it locally.
 */
export function buildVideoSavedNote(videoPath: string): string {
  return `[The original video is available on disk at: ${videoPath} — use ffmpeg to extract frames whenever you need visual details (layout, dimensions, existing materials).]`;
}
