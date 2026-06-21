import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  generateSecMsGec,
  splitTextByByteLength,
  synthesizeWithEdgeTts,
  EDGE_DEFAULT_VOICE,
  SEC_MS_GEC_VERSION,
  _resetClockSkew,
} from "../../../src/app/services/edge-tts.js";

describe("generateSecMsGec", () => {
  beforeEach(() => _resetClockSkew());
  afterEach(() => _resetClockSkew());

  it("produces a 64-char uppercase hex string", () => {
    const token = generateSecMsGec(new Date("2024-01-01T00:00:00Z"));
    expect(token).toMatch(/^[0-9A-F]{64}$/);
  });

  it("matches the reference vector for a fixed time", () => {
    const token = generateSecMsGec(new Date("2024-01-01T00:00:00Z"));
    expect(token).toBe(
      "2AC0A57C1214B9458F8725BB7800499BB594EC29DDA83424BC14661707141F2F",
    );
  });

  it("is stable within the same 5-minute window", () => {
    const start = new Date("2024-06-01T12:02:37Z");
    const later = new Date("2024-06-01T12:04:59Z");
    expect(generateSecMsGec(start)).toBe(generateSecMsGec(later));
  });

  it("changes across 5-minute window boundaries", () => {
    const before = new Date("2024-06-01T12:04:59Z");
    const after = new Date("2024-06-01T12:05:00Z");
    expect(generateSecMsGec(before)).not.toBe(generateSecMsGec(after));
  });
});

describe("SEC_MS_GEC_VERSION / EDGE_DEFAULT_VOICE", () => {
  it("exposes a Chromium-prefixed GEC version", () => {
    expect(SEC_MS_GEC_VERSION).toMatch(/^1-\d+\.\d+\.\d+\.\d+$/);
  });

  it("uses a Neural voice as default", () => {
    expect(EDGE_DEFAULT_VOICE).toMatch(/Neural$/);
  });
});

describe("splitTextByByteLength", () => {
  it("returns a single chunk when text fits", () => {
    expect(splitTextByByteLength("hello world", 100)).toEqual(["hello world"]);
  });

  it("splits at newlines when possible", () => {
    const text = "line one\nline two\nline three";
    const chunks = splitTextByByteLength(text, 15);
    // Newlines act as split boundaries and are trimmed away.
    expect(chunks).toEqual(["line one", "line two", "line three"]);
    for (const chunk of chunks) {
      expect(Buffer.byteLength(chunk, "utf-8")).toBeLessThanOrEqual(15);
    }
  });

  it("splits at spaces when no newline fits", () => {
    const text = "alpha beta gamma delta";
    const chunks = splitTextByByteLength(text, 12);
    expect(chunks.every((c) => Buffer.byteLength(c, "utf-8") <= 12)).toBe(true);
    expect(chunks.join(" ").replace(/\s+/g, " ").trim()).toContain("alpha");
  });

  it("never splits a multi-byte UTF-8 character", () => {
    // Each CJK char is 3 bytes in UTF-8; force splits mid-character.
    const text = "你好世界测试文本".repeat(10);
    const chunks = splitTextByByteLength(text, 8);
    const roundTrip = chunks.join("");
    expect(roundTrip).toBe(text);
    for (const chunk of chunks) {
      expect(Buffer.byteLength(chunk, "utf-8")).toBeLessThanOrEqual(8);
    }
  });

  it("does not split inside an XML entity", () => {
    const text = "foo &amp; bar";
    const chunks = splitTextByByteLength(text, 6);
    // The entity "&amp;" must stay whole within a single chunk.
    expect(chunks).toContain("&amp;");
    expect(
      chunks.some((c) => c.includes("&amp") && !c.includes("&amp;")),
    ).toBe(false);
    expect(chunks.some((c) => c.includes("amp;") && !c.includes("&amp;"))).toBe(false);
  });

  it("throws on non-positive byte length", () => {
    expect(() => splitTextByByteLength("x", 0)).toThrow();
    expect(() => splitTextByByteLength("x", -1)).toThrow();
  });
});

describe("synthesizeWithEdgeTts (WebSocket flow)", () => {
  const fakeWs = {
    on: vi.fn(),
    send: vi.fn(),
    close: vi.fn(),
    removeAllListeners: vi.fn(),
    readyState: 1,
  };

  function emit(event: string, ...args: unknown[]): void {
    const handler = fakeWs.on.mock.calls.find((c) => c[0] === event)?.[1];
    if (handler) (handler as (...a: unknown[]) => void)(...args);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    fakeWs.on.mockClear();
    fakeWs.send.mockClear();
    fakeWs.close.mockClear();
    fakeWs.removeAllListeners.mockClear();
    fakeWs.readyState = 1;
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function installMockWs(): void {
    vi.doMock("ws", () => ({
      WebSocket: vi.fn(() => fakeWs),
    }));
  }

  it("sends config + SSML and concatenates binary audio on turn.end", async () => {
    installMockWs();
    const { synthesizeWithEdgeTts } = await import(
      "../../../src/app/services/edge-tts.js"
    );

    const promise = synthesizeWithEdgeTts("Hello world", {
      voice: "en-US-AriaNeural",
    });

    // Allow the constructor + listeners to register.
    await Promise.resolve();

    emit("open");

    // Two messages sent on open: speech.config then first ssml.
    expect(fakeWs.send).toHaveBeenCalledTimes(2);
    expect(fakeWs.send.mock.calls[0][0]).toContain("Path:speech.config");
    const ssml = String(fakeWs.send.mock.calls[1][0]);
    expect(ssml).toContain("Path:ssml");
    expect(ssml).toContain("<voice name='en-US-AriaNeural'>");
    expect(ssml).toContain("Hello world");

    // Simulate a binary audio frame from the service.
    // Format: [2-byte header length][headers + \r\n][audio data]
    const headers = Buffer.from("Path:audio\r\nContent-Type:audio/mpeg\r\n", "utf-8");
    const prefix = Buffer.alloc(2);
    prefix.writeUInt16BE(headers.length, 0);
    const audioBytes = Buffer.from([0xff, 0xf3, 0x90, 0x00]);
    emit("message", Buffer.concat([prefix, headers, audioBytes]), true);

    // Simulate turn.end on the text channel.
    emit("message", "X-RequestId:abc\r\nPath:turn.end\r\n\r\n", false);

    const result = await promise;
    expect(result).toEqual(audioBytes);
  });

  it("rejects when no audio is received before turn.end", async () => {
    installMockWs();
    const { synthesizeWithEdgeTts } = await import(
      "../../../src/app/services/edge-tts.js"
    );

    const promise = synthesizeWithEdgeTts("Hello", { voice: "en-US-AriaNeural" });
    await Promise.resolve();
    emit("open");
    emit("message", "Path:turn.end\r\n\r\n", false);

    await expect(promise).rejects.toThrow("no audio received");
  });

  it("rejects on connection close before audio", async () => {
    installMockWs();
    const { synthesizeWithEdgeTts } = await import(
      "../../../src/app/services/edge-tts.js"
    );

    const promise = synthesizeWithEdgeTts("Hello", { voice: "en-US-AriaNeural" });
    await Promise.resolve();
    emit("open");
    emit("close");

    await expect(promise).rejects.toThrow("connection closed");
  });

  it("rejects on WebSocket error", async () => {
    installMockWs();
    const { synthesizeWithEdgeTts } = await import(
      "../../../src/app/services/edge-tts.js"
    );

    const promise = synthesizeWithEdgeTts("Hello", { voice: "en-US-AriaNeural" });
    await Promise.resolve();
    emit("error", new Error("connect ECONNREFUSED"));

    await expect(promise).rejects.toThrow("ECONNREFUSED");
  });
});
