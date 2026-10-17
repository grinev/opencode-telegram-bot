import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetFileActionTokensForTests,
  buildCallbackData,
  normalizeActionId,
  parseCallbackData,
  recallFileAction,
  rememberFileAction,
} from "../../../src/app/services/file-action-tokens.js";

// Telegram rejects callback_data longer than 64 bytes (BUTTON_DATA_INVALID).
const TELEGRAM_CALLBACK_DATA_LIMIT = 64;
// A real Telegram document file_id is 55-70 characters long.
const LONG_FILE_ID = "AgACAgEAAxkBAAIBc2Z0Xk9Q9YQ2k0v8m1s2n3b4c5d6e7f8AAL9xGxsAAAA";

function remember() {
  return rememberFileAction({
    fileId: LONG_FILE_ID,
    filename: "archive.zip",
    mimeType: "application/zip",
  });
}

describe("app/services/file-action-tokens", () => {
  beforeEach(() => {
    __resetFileActionTokensForTests();
    vi.useRealTimers();
  });

  it("keeps callback_data within the Telegram 64-byte limit", () => {
    const data = buildCallbackData(remember(), "save_default");
    expect(Buffer.byteLength(data, "utf-8")).toBeLessThanOrEqual(TELEGRAM_CALLBACK_DATA_LIMIT);
    expect(data.startsWith("file_action:")).toBe(true);
  });

  it("round-trips the token and the action id", () => {
    const token = remember();
    expect(parseCallbackData(buildCallbackData(token, "open"))).toEqual({ token, actionId: "open" });
  });

  it("returns the stored payload", () => {
    const token = remember();
    expect(recallFileAction(token)).toEqual({
      fileId: LONG_FILE_ID,
      filename: "archive.zip",
      mimeType: "application/zip",
    });
  });

  it("returns null for unknown tokens", () => {
    expect(recallFileAction("deadbeef")).toBeNull();
  });

  it("expires tokens after one hour", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-17T20:00:00Z"));
    const token = remember();

    vi.setSystemTime(new Date("2026-10-17T20:59:00Z"));
    expect(recallFileAction(token)).not.toBeNull();

    vi.setSystemTime(new Date("2026-10-17T21:01:00Z"));
    expect(recallFileAction(token)).toBeNull();
  });

  it("normalizes action ids that would break the callback grammar", () => {
    expect(normalizeActionId("Save File:2")).toBe("save_file_2");
    const data = buildCallbackData(remember(), "Save File:2");
    expect(parseCallbackData(data)?.actionId).toBe("save_file_2");
  });

  it("rejects malformed callback data", () => {
    expect(parseCallbackData("file_action:zzzz:open")).toBeNull();
    expect(parseCallbackData("file_action:deadbeef:OPEN")).toBeNull();
    expect(parseCallbackData("file_action:deadbeef")).toBeNull();
    expect(parseCallbackData("open:deadbeef:save")).toBeNull();
  });

  it("never returns an empty action id", () => {
    expect(normalizeActionId("!!!")).toBe("___");
    expect(normalizeActionId("")).toBe("action");
  });
});
