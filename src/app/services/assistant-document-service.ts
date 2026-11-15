import path from "node:path";
import { config } from "../../config.js";
import { opencodeClient, opencodeServerVersion, opencodeV2Client } from "../../opencode/client.js";
import { logger } from "../../utils/logger.js";

export type AssistantDocumentFailure = "unavailable" | "too_large";
export type AssistantDocumentResult = { bytes: Buffer } | { reason: AssistantDocumentFailure };
export type AssistantDocumentKind = "file" | "directory" | "missing" | "unknown";

export function isDocumentSizeError(error: unknown): boolean {
  if (error && typeof error === "object") {
    const record = error as { status?: number; cause?: { status?: number }; response?: { status?: number } };
    if (record.status === 413 || record.cause?.status === 413 || record.response?.status === 413) return true;
  }
  const detail = error instanceof Error ? error.message : (JSON.stringify(error) ?? "");
  return /too (?:large|big)|FILE_TOO_BIG|entity too large|size.?limit|413/iu.test(detail);
}

/** Classify via metadata, not by treating a failed read as evidence of a directory. */
export async function classifyAssistantDocuments(
  directory: string | undefined,
  paths: string[],
): Promise<Map<string, AssistantDocumentKind>> {
  const kinds = new Map<string, AssistantDocumentKind>();
  if (!directory) return kinds;
  const style = /^[a-z]:[\\/]|^\\\\/iu.test(directory) ? path.win32 : path.posix;
  for (const parent of new Set(paths.map((file) => path.posix.dirname(file)))) {
    try {
      const result =
        opencodeServerVersion === "v2"
          ? await opencodeV2Client.file.entries({ path: style.resolve(directory, parent) })
          : await opencodeClient.file.list({ directory, path: parent });
      if (result.error || !result.data) continue;
      for (const file of paths.filter((candidate) => path.posix.dirname(candidate) === parent)) {
        const entry = result.data.find((item) => {
          const basename = path.posix.basename(item.path.replace(/\\/g, "/"));
          const name = path.posix.basename(file);
          return style === path.win32
            ? basename.toLowerCase() === name.toLowerCase()
            : basename === name;
        });
        kinds.set(file, entry?.type ?? "missing");
      }
    } catch (error) {
      logger.debug("[AssistantDocument] Directory listing failed", { directory, parent, error });
    }
  }
  return kinds;
}

export async function readAssistantDocument(
  directory: string | undefined,
  file: string,
  kind: AssistantDocumentKind = "unknown",
): Promise<AssistantDocumentResult> {
  if (!directory || kind === "missing") return { reason: "unavailable" };
  const maxBytes = config.files.outgoingDocumentMaxSizeMb * 1024 * 1024;
  try {
    const result = await opencodeClient.file.read({ directory, path: file });
    if (result.error)
      return { reason: isDocumentSizeError(result.error) ? "too_large" : "unavailable" };
    const data = result.data;
    if (!data || (data.type === "text" && data.content === "" && kind !== "file"))
      return { reason: "unavailable" };
    let bytes: Buffer;
    if (data.encoding === "base64") {
      if (data.content.length > Math.ceil(maxBytes / 3) * 4) return { reason: "too_large" };
      bytes = Buffer.from(data.content, "base64");
    } else if (data.type === "text") {
      // V1 intentionally returns trimmed text; missing whitespace cannot be reconstructed.
      if (Buffer.byteLength(data.content, "utf8") > maxBytes) return { reason: "too_large" };
      bytes = Buffer.from(data.content, "utf8");
    } else return { reason: "unavailable" };
    return bytes.length > maxBytes ? { reason: "too_large" } : { bytes };
  } catch (error) {
    logger.debug("[AssistantDocument] Remote read failed", { directory, file, error });
    return { reason: isDocumentSizeError(error) ? "too_large" : "unavailable" };
  }
}
