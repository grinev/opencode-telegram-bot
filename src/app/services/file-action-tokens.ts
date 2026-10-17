import { randomBytes } from "node:crypto";

/**
 * Telegram rejects callback_data longer than 64 bytes (BUTTON_DATA_INVALID), and a
 * Telegram file_id alone is already 60-70 characters. Instead of stuffing the file
 * payload into the button, buttons carry a short token that points at an in-memory
 * entry; the payload is looked up when the user taps.
 *
 * The store is intentionally in-memory: a bot restart drops pending actions, and the
 * user gets a "send the file again" answer instead of a dead button.
 */

export interface FileActionPayload {
  fileId: string;
  filename: string;
  mimeType: string;
}

interface StoredPayload extends FileActionPayload {
  createdAt: number;
}

const TTL_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 100;
const ACTION_ID_MAX_LENGTH = 32;

const store = new Map<string, StoredPayload>();

/** Keeps a payload and returns the token that identifies it. */
export function rememberFileAction(payload: FileActionPayload): string {
  evictExpired();

  let token = randomBytes(4).toString("hex");
  while (store.has(token)) {
    token = randomBytes(4).toString("hex");
  }

  store.set(token, { ...payload, createdAt: Date.now() });

  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }

  return token;
}

/** Returns the payload for a token, or null when it expired or never existed. */
export function recallFileAction(token: string): FileActionPayload | null {
  const entry = store.get(token);
  if (!entry) return null;

  if (Date.now() - entry.createdAt > TTL_MS) {
    store.delete(token);
    return null;
  }

  return { fileId: entry.fileId, filename: entry.filename, mimeType: entry.mimeType };
}

/** Normalizes an action id so it always fits the callback_data grammar. */
export function normalizeActionId(actionId: string): string {
  const normalized = actionId
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .slice(0, ACTION_ID_MAX_LENGTH);
  return normalized.length > 0 ? normalized : "action";
}

const CALLBACK_PREFIX = "file_action";
const CALLBACK_DATA_PATTERN = /^file_action:([0-9a-f]{8}):([a-z0-9_]{1,32})$/;

/**
 * Builds `file_action:<token>:<actionId>`, at most 53 bytes (Telegram caps at 64).
 * The `file_action` prefix is what the callback router dispatches on, so it must stay.
 */
export function buildCallbackData(token: string, actionId: string): string {
  return `${CALLBACK_PREFIX}:${token}:${normalizeActionId(actionId)}`;
}

export function parseCallbackData(data: string): { token: string; actionId: string } | null {
  const match = CALLBACK_DATA_PATTERN.exec(data);
  if (!match) return null;
  return { token: match[1]!, actionId: match[2]! };
}

export function __resetFileActionTokensForTests(): void {
  store.clear();
}

function evictExpired(): void {
  const now = Date.now();
  for (const [token, entry] of store) {
    if (now - entry.createdAt > TTL_MS) store.delete(token);
  }
}
