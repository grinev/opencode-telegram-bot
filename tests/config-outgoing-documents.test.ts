import { afterEach, describe, expect, it, vi } from "vitest";

describe("outgoing document maximum", () => {
  afterEach(() => vi.unstubAllEnvs());
  it.each([
    ["", 50],
    ["invalid", 50],
    ["0", 50],
    ["-1", 50],
    ["12", 12],
    ["51", 50],
    ["9999", 50],
  ])("parses %s as effective %s MiB", async (value, expected) => {
    vi.resetModules();
    vi.stubEnv("OUTGOING_DOCUMENT_MAX_SIZE_MB", value);
    const { config } = await import("../src/config.js");
    expect(config.files.outgoingDocumentMaxSizeMb).toBe(expected);
  });
});
