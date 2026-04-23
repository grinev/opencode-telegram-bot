import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSynthesizeSpeech = vi.hoisted(() => vi.fn());

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@google-cloud/text-to-speech", () => {
  const instance = { synthesizeSpeech: mockSynthesizeSpeech };
  return {
    __esModule: true,
    default: {
      TextToSpeechClient: function () {
        return instance;
      },
    },
    TextToSpeechClient: function () {
      return instance;
    },
  };
});

const mockTts = vi.hoisted(() => ({
  apiUrl: "",
  apiKey: "",
  provider: "openai" as string,
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

import {
  isTtsConfigured,
  synthesizeSpeech,
  stripMarkdownForSpeech,
  extractLanguageCode,
  _resetGoogleClient,
} from "../../src/tts/client.js";

describe("isTtsConfigured", () => {
  beforeEach(() => {
    mockTts.apiUrl = "";
    mockTts.apiKey = "";
    mockTts.provider = "openai";
  });

  it("returns false when OpenAI credentials are missing", () => {
    mockTts.apiUrl = "https://api.openai.com/v1";
    expect(isTtsConfigured()).toBe(false);
  });

  it("returns true when OpenAI credentials are set", () => {
    mockTts.apiUrl = "https://api.openai.com/v1";
    mockTts.apiKey = "sk-test-key";
    expect(isTtsConfigured()).toBe(true);
  });

  it("returns true for google provider (ADC support)", () => {
    mockTts.provider = "google";
    expect(isTtsConfigured()).toBe(true);
  });
});

describe("stripMarkdownForSpeech", () => {
  it("strips bold markers", () => {
    expect(stripMarkdownForSpeech("this is **bold** text")).toBe("this is bold text");
  });

  it("strips italic markers", () => {
    expect(stripMarkdownForSpeech("this is *italic* text")).toBe("this is italic text");
  });

  it("strips bold+italic markers", () => {
    expect(stripMarkdownForSpeech("this is ***both*** text")).toBe("this is both text");
  });

  it("strips inline code backticks", () => {
    expect(stripMarkdownForSpeech("run `npm install` now")).toBe("run npm install now");
  });

  it("strips fenced code blocks but keeps content", () => {
    const input = "before\n```js\nconst x = 1\n```\nafter";
    expect(stripMarkdownForSpeech(input)).toBe("before\nconst x = 1\nafter");
  });

  it("strips strikethrough", () => {
    expect(stripMarkdownForSpeech("this is ~~deleted~~ text")).toBe("this is deleted text");
  });

  it("extracts link text and drops URL", () => {
    expect(stripMarkdownForSpeech("click [here](https://example.com) now")).toBe("click here now");
  });

  it("strips heading markers", () => {
    expect(stripMarkdownForSpeech("## Title")).toBe("Title");
    expect(stripMarkdownForSpeech("### Subtitle")).toBe("Subtitle");
  });

  it("strips blockquote markers", () => {
    expect(stripMarkdownForSpeech("> quoted text")).toBe("quoted text");
  });

  it("strips unordered list markers", () => {
    expect(stripMarkdownForSpeech("- item one\n* item two")).toBe("item one\nitem two");
  });

  it("strips ordered list markers", () => {
    expect(stripMarkdownForSpeech("1. first\n2. second")).toBe("first\nsecond");
  });

  it("strips HTML tags", () => {
    expect(stripMarkdownForSpeech("see <code>this</code>")).toBe("see this");
    expect(stripMarkdownForSpeech("see <em>this</em> now")).toBe("see this now");
  });

  it("preserves angle brackets that are not HTML-like", () => {
    expect(stripMarkdownForSpeech("check 2 < 3")).toBe("check 2 < 3");
  });

  it("collapses excessive whitespace", () => {
    expect(stripMarkdownForSpeech("too   many   spaces")).toBe("too many spaces");
  });

  it("handles complex markdown from LLM output", () => {
    const input =
      "## Result\n\nThe **answer** is `42`. See [docs](https://example.com) for details.\n\n> Important note\n\n- Point one\n- Point two";
    const result = stripMarkdownForSpeech(input);
    expect(result).not.toContain("**");
    expect(result).not.toContain("`");
    expect(result).not.toContain("##");
    expect(result).not.toContain("[docs]");
    expect(result).not.toContain("(https:");
    expect(result).not.toContain("> ");
    expect(result).not.toContain("- ");
    expect(result).toContain("answer");
    expect(result).toContain("42");
    expect(result).toContain("docs");
  });
});

describe("extractLanguageCode", () => {
  it("extracts de-DE from German voice names", () => {
    expect(extractLanguageCode("de-DE-Neural2-B")).toBe("de-DE");
    expect(extractLanguageCode("de-DE-Studio-C")).toBe("de-DE");
    expect(extractLanguageCode("de-DE-Chirp3-HD-Aoede")).toBe("de-DE");
  });

  it("extracts en-US from English voice names", () => {
    expect(extractLanguageCode("en-US-Studio-O")).toBe("en-US");
    expect(extractLanguageCode("en-US-Neural2-F")).toBe("en-US");
  });

  it("falls back to en-US for unrecognized patterns", () => {
    expect(extractLanguageCode("unknown")).toBe("en-US");
  });
});

describe("synthesizeSpeech (OpenAI)", () => {
  beforeEach(() => {
    mockTts.apiUrl = "https://api.openai.com/v1";
    mockTts.apiKey = "sk-test-key";
    mockTts.provider = "openai";
    mockTts.model = "gpt-4o-mini-tts";
    mockTts.voice = "alloy";
    vi.restoreAllMocks();
  });

  it("throws with provider-specific message when not configured", async () => {
    mockTts.apiKey = "";

    await expect(synthesizeSpeech("hello")).rejects.toThrow("TTS_API_URL and TTS_API_KEY");
  });

  it("strips markdown before sending to TTS", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(Uint8Array.from([1, 2, 3]), {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      }),
    );

    await synthesizeSpeech("Hello **bold** world");

    const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(body.input).toBe("Hello bold world");
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

describe("synthesizeSpeech (Google)", () => {
  beforeEach(() => {
    mockTts.provider = "google";
    mockTts.voice = "en-US-Studio-O";
    _resetGoogleClient();
    mockSynthesizeSpeech.mockResolvedValue([{ audioContent: Buffer.from([4, 5, 6]) }]);
  });

  afterEach(() => {
    mockSynthesizeSpeech.mockReset();
  });

  it("sends correct parameters to Google TTS", async () => {
    const result = await synthesizeSpeech("Hello world");

    expect(mockSynthesizeSpeech).toHaveBeenCalledOnce();
    const callArgs = mockSynthesizeSpeech.mock.calls[0];
    expect(callArgs[0].input).toEqual({ text: "Hello world" });
    expect(callArgs[0].voice).toEqual({ languageCode: "en-US", name: "en-US-Studio-O" });
    expect(callArgs[0].audioConfig).toEqual({ audioEncoding: "MP3" });

    expect(result.filename).toBe("assistant-reply.mp3");
    expect(result.mimeType).toBe("audio/mpeg");
    expect(result.buffer).toEqual(Buffer.from([4, 5, 6]));
  });

  it("passes timeout option to Google SDK", async () => {
    await synthesizeSpeech("Hello");

    const callArgs = mockSynthesizeSpeech.mock.calls[0];
    expect(callArgs[1]).toHaveProperty("timeout");
    expect(callArgs[1].timeout).toBe(60_000);
  });

  it("handles Uint8Array audioContent from Google SDK", async () => {
    const uint8 = new Uint8Array([10, 20, 30]);
    mockSynthesizeSpeech.mockResolvedValue([{ audioContent: uint8 }]);

    const result = await synthesizeSpeech("test");

    expect(result.buffer).toEqual(Buffer.from([10, 20, 30]));
  });

  it("throws on empty audio response", async () => {
    mockSynthesizeSpeech.mockResolvedValue([{ audioContent: Buffer.alloc(0) }]);

    await expect(synthesizeSpeech("test")).rejects.toThrow("empty audio response");
  });

  it("strips markdown before sending to Google TTS", async () => {
    await synthesizeSpeech("Hello **bold** and `code`");

    const callArgs = mockSynthesizeSpeech.mock.calls[0];
    expect(callArgs[0].input).toEqual({ text: "Hello bold and code" });
  });
});
