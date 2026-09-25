import { isRecord } from "./type-guards.js";

const SERVER_UNAVAILABLE_ERROR_MARKERS = [
  "fetch failed",
  "econnrefused",
  "connection refused",
  "connect refused",
];

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

/** A "not found" answer from OpenCode (V1 body, or the V2 adapter's equivalent). */
export function isOpencodeNotFoundError(error: unknown): boolean {
  return isRecord(error) && error.name === "NotFoundError";
}

function hasServerUnavailableMarker(value: string): boolean {
  const lower = value.toLowerCase();
  return SERVER_UNAVAILABLE_ERROR_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * Walks the error `cause` chain looking for a "server unavailable" marker
 * (fetch failures, connection refused, ...). Mirrors the previous per-service
 * implementations in session-cache-service and model-selection-service.
 */
export function isServerUnavailableError(error: unknown): boolean {
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.pop();

    if (!current || seen.has(current)) {
      continue;
    }

    seen.add(current);

    if (typeof current === "string") {
      if (hasServerUnavailableMarker(current)) {
        return true;
      }

      continue;
    }

    if (current instanceof Error) {
      if (hasServerUnavailableMarker(`${current.name}: ${current.message}`)) {
        return true;
      }

      if (current.cause) {
        queue.push(current.cause);
      }

      continue;
    }

    if (isRecord(current)) {
      if (typeof current.code === "string" && hasServerUnavailableMarker(current.code)) {
        return true;
      }

      if (typeof current.message === "string" && hasServerUnavailableMarker(current.message)) {
        return true;
      }

      if (current.cause) {
        queue.push(current.cause);
      }
    }
  }

  return false;
}

/**
 * Extracts a human-readable message from an unknown error value:
 * Error instance -> message, string -> itself, object -> data.message / message / name.
 * Whitespace-only values fall through to the next candidate; returns null when
 * nothing usable is found.
 */
export function extractErrorMessage(error: unknown): string | null {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  if (!isRecord(error)) {
    return null;
  }

  const data = error.data;
  if (isRecord(data)) {
    const message = data.message;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  }

  if (typeof error.message === "string" && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error.name === "string" && error.name.trim()) {
    return error.name.trim();
  }

  return null;
}
