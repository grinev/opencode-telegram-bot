import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// vi.hoisted() ensures the variable is declared before vi.mock factories run.
const mockStt = vi.hoisted(() => ({
  apiUrl: "",
  apiKey: "",
  model: "whisper-large-v3-turbo",
  language: "",
  requestFormat: "multipart" as "multipart" | "json",
}));

vi.mock("../../../src/config.js", () => ({
  config: {
    stt: mockStt,
    // Provide minimal stubs for properties that other modules read at import time
    // (e.g., opencode/client.ts reads config.opencode during module initialization
    // and may get loaded via the test setup's resetSingletonState).
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
      locale: "en",
    },
    files: { maxFileSizeKb: 100 },
  },
}));

import { isSttConfigured, transcribeAudio } from "../../../src/app/services/stt-service.js";

describe("isSttConfigured", () => {
  beforeEach(() => {
    mockStt.apiUrl = "";
    mockStt.apiKey = "";
    mockStt.model = "whisper-large-v3-turbo";
    mockStt.language = "";
    mockStt.requestFormat = "multipart";
  });

  it("returns false when both apiUrl and apiKey are empty", () => {
    expect(isSttConfigured()).toBe(false);
  });

  it("returns false when only apiUrl is set", () => {
    mockStt.apiUrl = "https://api.groq.com/openai/v1";
    expect(isSttConfigured()).toBe(false);
  });

  it("returns false when only apiKey is set", () => {
    mockStt.apiKey = "sk-test-key";
    expect(isSttConfigured()).toBe(false);
  });

  it("returns true when both apiUrl and apiKey are set", () => {
    mockStt.apiUrl = "https://api.groq.com/openai/v1";
    mockStt.apiKey = "sk-test-key";
    expect(isSttConfigured()).toBe(true);
  });
});

describe("transcribeAudio", () => {
  beforeEach(() => {
    mockStt.apiUrl = "https://api.groq.com/openai/v1";
    mockStt.apiKey = "sk-test-key";
    mockStt.model = "whisper-large-v3-turbo";
    mockStt.language = "";
    mockStt.requestFormat = "multipart";
    vi.restoreAllMocks();
  });

  it("throws when STT is not configured", async () => {
    mockStt.apiUrl = "";
    mockStt.apiKey = "";

    const audioBuffer = Buffer.from("fake-audio-data");
    await expect(transcribeAudio(audioBuffer, "test.ogg")).rejects.toThrow("STT is not configured");
  });

  it("sends correct request and returns transcription text", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ text: "Hello world" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const audioBuffer = Buffer.from("fake-audio-data");
    const result = await transcribeAudio(audioBuffer, "voice.oga");

    expect(result).toEqual({ text: "Hello world" });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(options?.method).toBe("POST");
    expect((options?.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer sk-test-key",
    );
    expect(options?.body).toBeInstanceOf(FormData);
  });

  it("includes language in form data when configured", async () => {
    mockStt.language = "en";

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ text: "Hello" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const audioBuffer = Buffer.from("fake-audio-data");
    await transcribeAudio(audioBuffer, "voice.oga");

    const formData = fetchSpy.mock.calls[0][1]?.body as FormData;
    expect(formData.get("language")).toBe("en");
    expect(formData.get("model")).toBe("whisper-large-v3-turbo");
    expect(formData.get("response_format")).toBe("json");
  });

  it("does not include language when not configured", async () => {
    mockStt.language = "";

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ text: "Bonjour" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const audioBuffer = Buffer.from("fake-audio-data");
    await transcribeAudio(audioBuffer, "voice.oga");

    const formData = fetchSpy.mock.calls[0][1]?.body as FormData;
    expect(formData.get("language")).toBeNull();
  });

  it("throws on non-OK HTTP response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Rate limit exceeded", {
        status: 429,
        statusText: "Too Many Requests",
      }),
    );

    const audioBuffer = Buffer.from("fake-audio-data");
    await expect(transcribeAudio(audioBuffer, "voice.oga")).rejects.toThrow(
      "STT API returned HTTP 429: Rate limit exceeded",
    );
  });

  it("throws when response has no text field", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ duration: 3.5 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const audioBuffer = Buffer.from("fake-audio-data");
    await expect(transcribeAudio(audioBuffer, "voice.oga")).rejects.toThrow(
      "STT API response does not contain a text field",
    );
  });

  it("sends a base64 input_audio JSON body when requestFormat is json", async () => {
    mockStt.requestFormat = "json";

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ text: "Hello world" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const audioBuffer = Buffer.from("fake-audio-data");
    const result = await transcribeAudio(audioBuffer, "voice.oga");

    expect(result).toEqual({ text: "Hello world" });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(options?.method).toBe("POST");
    const headers = options?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk-test-key");
    expect(headers["Content-Type"]).toBe("application/json");

    const parsedBody = JSON.parse(options?.body as string) as {
      model: string;
      input_audio: { data: string; format: string };
      language?: string;
    };
    expect(parsedBody.model).toBe("whisper-large-v3-turbo");
    expect(parsedBody.input_audio.format).toBe("ogg");
    expect(parsedBody.input_audio.data).toBe(audioBuffer.toString("base64"));
    expect(parsedBody.language).toBeUndefined();
  });

  it("includes language in the JSON body when requestFormat is json and language is set", async () => {
    mockStt.requestFormat = "json";
    mockStt.language = "ru";

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ text: "Привет" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await transcribeAudio(Buffer.from("fake-audio-data"), "voice.mp3");

    const parsedBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string) as {
      input_audio: { format: string };
      language: string;
    };
    expect(parsedBody.input_audio.format).toBe("mp3");
    expect(parsedBody.language).toBe("ru");
  });
});
