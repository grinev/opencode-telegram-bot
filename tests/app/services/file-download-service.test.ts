import { beforeEach, describe, expect, it, vi } from "#vitest";
import type { Api } from "grammy";
import { loadSut } from "#helpers/sut-loader.js";
import { defined } from "#helpers/defined.js";

let fetchMock: ReturnType<typeof vi.fn>;

const configMock = {
  telegram: {
    token: "bot-token-xyz",
    allowedUserId: 123456789,
    apiRoot: "",
    proxyUrl: "",
    proxySecret: "",
    forceIpv4: false,
  },
  opencode: {
    apiUrl: "http://localhost:4096",
    username: "opencode",
    password: "",
    autoRestartEnabled: false,
    monitorIntervalSec: 300,
    model: {
      provider: "test-provider",
      modelId: "test-model",
    },
  },
  server: {
    logLevel: "info",
  },
  bot: {
    sessionsListLimit: 10,
    messagesListLimit: 10,
    projectsListLimit: 10,
    commandsListLimit: 10,
    taskLimit: 10,
    scheduledTaskExecutionTimeoutMinutes: 120,
    scheduledTaskNotificationsSilent: false,
    responseStreamThrottleMs: 1000,
    responseStreamingMode: "edit",
    bashToolDisplayMaxLength: 128,
    locale: "en",
    hideThinkingMessages: false,
    hideToolCallMessages: false,
    hideToolFileMessages: false,
    trackBackgroundSessions: true,
    messageFormatMode: "markdown",
  },
  files: {
    maxFileSizeKb: 100,
  },
  open: {
    browserRoots: "",
  },
  stt: {
    apiUrl: "",
    apiKey: "",
    model: "whisper-large-v3-turbo",
    language: "",
    notePrompt: "",
  },
  tts: {
    apiUrl: "",
    apiKey: "",
    provider: "openai",
    model: "gpt-4o-mini-tts",
    voice: "alloy",
  },
};

vi.mock("#src/config.ts", () => ({
  config: configMock,
}));

// ---- Load SUT (only now that config + node-fetch are mocked) ----

async function getSut() {
  return loadSut<typeof import("#src/app/services/file-download-service.js")>(
    "#src/app/services/file-download-service.ts",
    import.meta.url,
  );
}

// Upstream's newer tests call these directly.
const { isTextFileName } = await getSut();

describe("app/services/file-download-service", () => {
  describe("toDataUri", () => {
    it("converts buffer to base64 data URI with correct MIME type", async () => {
      const { toDataUri } = await getSut();
      const buffer = Buffer.from("Hello, World!");
      const dataUri = toDataUri(buffer, "text/plain");

      expect(dataUri).toBe("data:text/plain;base64,SGVsbG8sIFdvcmxkIQ==");
    });

    it("handles image MIME types", async () => {
      const { toDataUri } = await getSut();
      const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic number
      const dataUri = toDataUri(buffer, "image/png");

      expect(dataUri).toMatch(/^data:image\/png;base64,/);
      expect(dataUri).toBe("data:image/png;base64,iVBORw==");
    });

    it("handles empty buffer", async () => {
      const { toDataUri } = await getSut();
      const buffer = Buffer.from([]);
      const dataUri = toDataUri(buffer, "application/octet-stream");

      expect(dataUri).toBe("data:application/octet-stream;base64,");
    });
  });

  describe("isFileSizeAllowed", () => {
    it("returns true when file size is within limit", async () => {
      const { isFileSizeAllowed } = await getSut();
      expect(isFileSizeAllowed(100 * 1024, 200)).toBe(true); // 100KB < 200KB
      expect(isFileSizeAllowed(1024, 1)).toBe(true); // exactly at limit
    });

    it("returns false when file size exceeds limit", async () => {
      const { isFileSizeAllowed } = await getSut();
      expect(isFileSizeAllowed(300 * 1024, 200)).toBe(false); // 300KB > 200KB
      expect(isFileSizeAllowed(1025, 1)).toBe(false); // just over limit
    });

    it("returns true when file size is undefined (unknown)", async () => {
      const { isFileSizeAllowed } = await getSut();
      expect(isFileSizeAllowed(undefined, 100)).toBe(true);
    });
  });

  describe("formatFileSize", () => {
    it("formats bytes correctly", async () => {
      const { formatFileSize } = await getSut();
      expect(formatFileSize(0)).toBe("0B");
      expect(formatFileSize(500)).toBe("500B");
      expect(formatFileSize(1023)).toBe("1023B");
    });

    it("formats kilobytes correctly", async () => {
      const { formatFileSize } = await getSut();
      expect(formatFileSize(1024)).toBe("1.0KB");
      expect(formatFileSize(1536)).toBe("1.5KB");
      expect(formatFileSize(10240)).toBe("10.0KB");
    });

    it("formats megabytes correctly", async () => {
      const { formatFileSize } = await getSut();
      expect(formatFileSize(1024 * 1024)).toBe("1.0MB");
      expect(formatFileSize(2.5 * 1024 * 1024)).toBe("2.5MB");
      expect(formatFileSize(10 * 1024 * 1024)).toBe("10.0MB");
    });
  });

  describe("isTextMimeType", () => {
    it("returns true for text/* MIME types", async () => {
      const { isTextMimeType } = await getSut();
      expect(isTextMimeType("text/plain")).toBe(true);
      expect(isTextMimeType("text/markdown")).toBe(true);
      expect(isTextMimeType("text/html")).toBe(true);
      expect(isTextMimeType("text/css")).toBe(true);
      expect(isTextMimeType("text/javascript")).toBe(true);
      expect(isTextMimeType("text/x-python")).toBe(true);
      expect(isTextMimeType("text/csv")).toBe(true);
    });

    it("returns true for whitelisted application/* types", async () => {
      const { isTextMimeType } = await getSut();
      expect(isTextMimeType("application/json")).toBe(true);
      expect(isTextMimeType("application/xml")).toBe(true);
      expect(isTextMimeType("application/javascript")).toBe(true);
      expect(isTextMimeType("application/x-yaml")).toBe(true);
      expect(isTextMimeType("application/sql")).toBe(true);
    });

    it("returns false for other application/* types", async () => {
      const { isTextMimeType } = await getSut();
      expect(isTextMimeType("application/pdf")).toBe(false);
      expect(isTextMimeType("application/zip")).toBe(false);
      expect(isTextMimeType("application/octet-stream")).toBe(false);
      expect(isTextMimeType("application/msword")).toBe(false);
    });

    it("returns false for image/* types", async () => {
      const { isTextMimeType } = await getSut();
      expect(isTextMimeType("image/png")).toBe(false);
      expect(isTextMimeType("image/jpeg")).toBe(false);
      expect(isTextMimeType("image/gif")).toBe(false);
    });

    it("returns false for undefined", async () => {
      const { isTextMimeType } = await getSut();
      expect(isTextMimeType(undefined)).toBe(false);
    });

    it("returns false for empty string", async () => {
      const { isTextMimeType } = await getSut();
      expect(isTextMimeType("")).toBe(false);
    });

    it("returns true for unknown MIME with known code file extension", async () => {
      const { isTextMimeType } = await getSut();
      expect(isTextMimeType("application/octet-stream", "component.svelte")).toBe(true);
      expect(isTextMimeType("application/octet-stream", "App.vue")).toBe(true);
      expect(isTextMimeType("application/octet-stream", "main.tsx")).toBe(true);
      expect(isTextMimeType("application/octet-stream", "server.go")).toBe(true);
      expect(isTextMimeType("application/octet-stream", "script.py")).toBe(true);
    });

    it("returns false for unknown MIME with unknown extension", async () => {
      const { isTextMimeType } = await getSut();
      expect(isTextMimeType("application/octet-stream", "file.xyz")).toBe(false);
      expect(isTextMimeType("application/octet-stream", "archive.7z")).toBe(false);
    });

    it("returns false for unknown MIME without filename", async () => {
      const { isTextMimeType } = await getSut();
      expect(isTextMimeType("application/octet-stream")).toBe(false);
    });

    it("returns false for undefined MIME even with known extension", async () => {
      const { isTextMimeType } = await getSut();
      expect(isTextMimeType(undefined, "file.svelte")).toBe(false);
    });

    it("handles files with multiple dots correctly", async () => {
      const { isTextMimeType } = await getSut();
      expect(isTextMimeType("application/octet-stream", "Component.test.svelte")).toBe(true);
      expect(isTextMimeType("application/octet-stream", "some.file.with.dots.py")).toBe(true);
    });

    it("handles files with no extension", async () => {
      const { isTextMimeType } = await getSut();
      expect(isTextMimeType("application/octet-stream", "Dockerfile")).toBe(false);
    });
  });

  describe("isTextFileName", () => {
    it("accepts source files by extension", () => {
      expect(isTextFileName("index.ts")).toBe(true);
      expect(isTextFileName("app.js")).toBe(true);
      expect(isTextFileName("package.json")).toBe(true);
      expect(isTextFileName("notes.txt")).toBe(true);
      expect(isTextFileName("main.py")).toBe(true);
    });

    it("accepts known extensionless files and dotfiles", () => {
      expect(isTextFileName("Makefile")).toBe(true);
      expect(isTextFileName("Dockerfile")).toBe(true);
      expect(isTextFileName(".env.example")).toBe(true);
      expect(isTextFileName(".gitignore")).toBe(true);
    });

    it("is case-insensitive for extensionless names", () => {
      expect(isTextFileName("MAKEFILE")).toBe(true);
      expect(isTextFileName("dockerfile")).toBe(true);
    });

    it("accepts a full path by looking only at the base name", () => {
      expect(isTextFileName("D:\\Repo\\src\\bot\\index.ts")).toBe(true);
      expect(isTextFileName("/repo/src/Makefile")).toBe(true);
    });

    it("rejects binary files", () => {
      expect(isTextFileName("logo.png")).toBe(false);
      expect(isTextFileName("app.exe")).toBe(false);
      expect(isTextFileName("archive.zip")).toBe(false);
      expect(isTextFileName("doc.pdf")).toBe(false);
    });

    it("rejects unknown extensionless files", () => {
      expect(isTextFileName("mystery")).toBe(false);
      expect(isTextFileName("")).toBe(false);
    });
  });
});

describe("downloadTelegramFile reverse-proxy wiring", () => {
  beforeEach(() => {
    // Reset config to defaults before each test
    configMock.telegram.token = "bot-token-xyz";
    configMock.telegram.apiRoot = "";
    configMock.telegram.proxyUrl = "";
    configMock.telegram.proxySecret = "";
    configMock.telegram.forceIpv4 = false;

    // Stub global fetch so downloadTelegramFile doesn't hit the real network
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  function makeApiStub(): Api {
    return {
      getFile: vi.fn().mockResolvedValue({
        file_path: "voice/sample.ogg",
        file_size: 100,
      }),
    } as unknown as Api;
  }

  it("uses api.telegram.org as the file URL base when TELEGRAM_API_ROOT is unset", async () => {
    const { downloadTelegramFile } = await getSut();
    await downloadTelegramFile(makeApiStub(), "fid");

    const call = defined(fetchMock.mock.calls[0]);
    const [url] = call;
    expect(url).toBe("https://api.telegram.org/file/botbot-token-xyz/voice/sample.ogg");
  });

  it("uses TELEGRAM_API_ROOT as the file URL base when set", async () => {
    configMock.telegram.apiRoot = "https://tg-proxy.example.com";
    const { downloadTelegramFile } = await getSut();
    await downloadTelegramFile(makeApiStub(), "fid");

    const call = defined(fetchMock.mock.calls[0]);
    const [url] = call;
    expect(url).toBe("https://tg-proxy.example.com/file/botbot-token-xyz/voice/sample.ogg");
  });

  it("normalizes a trailing slash so the URL has no double slash", async () => {
    configMock.telegram.apiRoot = "https://tg-proxy.example.com/";
    const { downloadTelegramFile } = await getSut();
    await downloadTelegramFile(makeApiStub(), "fid");

    const call = defined(fetchMock.mock.calls[0]);
    const [url] = call;
    expect(url).toBe("https://tg-proxy.example.com/file/botbot-token-xyz/voice/sample.ogg");
  });

  it("does not send X-Proxy-Secret when TELEGRAM_PROXY_SECRET is unset", async () => {
    configMock.telegram.apiRoot = "https://tg-proxy.example.com";
    const { downloadTelegramFile } = await getSut();
    await downloadTelegramFile(makeApiStub(), "fid");

    const call = defined(fetchMock.mock.calls[0]);
    const [, init] = call;
    const headers = (init as { headers?: Record<string, string> } | undefined)?.headers;
    expect(headers?.["X-Proxy-Secret"]).toBeUndefined();
  });

  it("sends X-Proxy-Secret on the file fetch when TELEGRAM_PROXY_SECRET is set", async () => {
    configMock.telegram.apiRoot = "https://tg-proxy.example.com";
    configMock.telegram.proxySecret = "secret-abc";
    const { downloadTelegramFile } = await getSut();
    await downloadTelegramFile(makeApiStub(), "fid");

    const call = defined(fetchMock.mock.calls[0]);
    const [, init] = call;
    const headers = (init as { headers?: Record<string, string> } | undefined)?.headers;
    expect(headers?.["X-Proxy-Secret"]).toBe("secret-abc");
  });

  it("does not configure a fetch proxy or agent for direct downloads by default", async () => {
    const { downloadTelegramFile } = await getSut();
    await downloadTelegramFile(makeApiStub(), "fid");

    const [, init] = fetchMock.mock.calls[0];
    const opts = init as { proxy?: string } | undefined;
    expect(opts?.proxy).toBeUndefined();
  });

  it("does not set a proxy when TELEGRAM_FORCE_IPV4 is enabled (Bun has no agent-level IPv4 pinning)", async () => {
    configMock.telegram.forceIpv4 = true;
    const { downloadTelegramFile } = await getSut();
    await downloadTelegramFile(makeApiStub(), "fid");

    const [, init] = fetchMock.mock.calls[0];
    const opts = init as { proxy?: string } | undefined;
    expect(opts?.proxy).toBeUndefined();
  });
});
