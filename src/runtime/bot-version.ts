import { logger } from "../utils/logger.js";

let cachedVersion: string | undefined;

export async function getBotVersion(): Promise<string> {
  if (cachedVersion !== undefined) {
    return cachedVersion;
  }

  try {
    const packageJsonPath = new URL("../../package.json", import.meta.url);
    const packageJson = (await Bun.file(packageJsonPath).json()) as { version?: string };
    cachedVersion = packageJson.version ?? "unknown";
  } catch (error) {
    logger.warn("[Runtime] Failed to read bot version", error);
    cachedVersion = "unknown";
  }

  return cachedVersion;
}
