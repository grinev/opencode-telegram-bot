import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockTts = vi.hoisted(() => ({
  apiUrl: "",
  apiKey: "",
  model: "gpt-4o-mini-tts",
  voice: "alloy",
}));

vi.mock("../../src/config.js", () => ({
  config: {
    tts: mockTts,
    telegram: { token: "test", allowedUserId: 0, proxyUrl: "" },
    opencode: {
      apiUrl: "http://localhost:4096",
      username: "opencode",
      password: "",
      model: { provider: "test", modelId: "test" },
    },
    server: { logLevel: "error" },
    bot: {
      sessionsListLimit: 10,
      projectsListLimit: 10,
      commandsListLimit: 10,
      taskLimit: 10,
      locale: "en",
      serviceMessagesIntervalSec: 5,
      hideThinkingMessages: false,
      hideToolCallMessages: false,
      responseStreaming: true,
      messageFormatMode: "markdown",
    },
    files: { maxFileSizeKb: 100 },
    stt: {
      apiUrl: "",
      apiKey: "",
      model: "whisper-large-v3-turbo",
      language: "",
    },
  },
}));

import { isTtsConfigured, synthesizeSpeech } from "../../src/tts/client.js";

describe("isTtsConfigured", () => {
  beforeEach(() => {
    mockTts.apiUrl = "";
    mockTts.apiKey = "";
    mockTts.model = "gpt-4o-mini-tts";
    mockTts.voice = "alloy";
  });

  it("returns false when credentials are missing", () => {
    mockTts.apiUrl = "https://api.openai.com/v1";
    expect(isTtsConfigured()).toBe(false);
  });

  it("returns true when credentials are set", () => {
    mockTts.apiUrl = "https://api.openai.com/v1";
    mockTts.apiKey = "sk-test-key";
    expect(isTtsConfigured()).toBe(true);
  });
});

describe("synthesizeSpeech", () => {
  beforeEach(() => {
    mockTts.apiUrl = "https://api.openai.com/v1";
    mockTts.apiKey = "sk-test-key";
    mockTts.model = "gpt-4o-mini-tts";
    mockTts.voice = "alloy";
    vi.restoreAllMocks();
  });

  it("throws when TTS is not configured", async () => {
    mockTts.apiKey = "";

    await expect(synthesizeSpeech("hello")).rejects.toThrow("TTS is not configured");
  });

  it("sends correct request and returns audio bytes", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(Uint8Array.from([1, 2, 3]), {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      }),
    );

    const result = await synthesizeSpeech("Hello world");

    expect(result.filename).toBe("assistant-reply.mp3");
    expect(result.mimeType).toBe("audio/mpeg");
    expect(result.buffer).toEqual(Buffer.from([1, 2, 3]));

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/audio/speech");
    expect(options?.method).toBe("POST");
    expect((options?.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer sk-test-key",
    );
    expect((options?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(String(options?.body))).toEqual({
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      input: "Hello world",
      response_format: "mp3",
    });
  });

  it("throws on non-OK HTTP response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Bad request", {
        status: 400,
        statusText: "Bad Request",
      }),
    );

    await expect(synthesizeSpeech("Hello world")).rejects.toThrow(
      "TTS API returned HTTP 400: Bad request",
    );
  });
});
