export function isExpectedOpencodeUnavailableError(error: unknown): boolean {
  if (!error) {
    return false;
  }

  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  return (
    normalized.includes("fetch failed") ||
    normalized.includes("failed to fetch") ||
    normalized.includes("econnrefused") ||
    normalized.includes("econnreset") ||
    normalized.includes("enotfound") ||
    normalized.includes("connectex")
  );
}
