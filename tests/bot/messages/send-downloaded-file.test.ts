import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";

const mocked = vi.hoisted(() => ({ stat: vi.fn(), readFile: vi.fn() }));
vi.mock("node:fs", async (original) => {
  const actual = await original<typeof import("node:fs")>();
  return {
    ...actual,
    promises: { ...actual.promises, stat: mocked.stat, readFile: mocked.readFile },
  };
});
import { config } from "../../../src/config.js";
import { sendDownloadedFile } from "../../../src/bot/messages/send-downloaded-file.js";

describe("explicit download document limit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.files.outgoingDocumentMaxSizeMb = 1;
    config.files.maxFileSizeKb = 1;
    mocked.readFile.mockResolvedValue(Buffer.from("content"));
  });

  it.each([
    [1024 * 1024, true],
    [1024 * 1024 + 1, false],
  ])("checks %s bytes against the outgoing ceiling, not code limit", async (size, allowed) => {
    mocked.stat.mockResolvedValue({ size, isFile: () => true, mtime: new Date("2026-01-01") });
    const reply = vi.fn().mockResolvedValue({});
    const replyWithDocument = vi.fn().mockResolvedValue({});
    expect(
      await sendDownloadedFile({ reply, replyWithDocument } as unknown as Context, "a.txt", {
        announce: false,
      }),
    ).toBe(allowed);
    expect(replyWithDocument).toHaveBeenCalledTimes(allowed ? 1 : 0);
    if (!allowed) expect(reply.mock.calls[0]?.[0]).toContain("1 MiB");
  });
});
