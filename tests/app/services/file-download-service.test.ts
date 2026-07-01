import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Api } from "grammy";
import { Agent as HttpsAgent } from "https";
import {
  toDataUri,
  formatFileSize,
  isFileSizeAllowed,
  isTextMimeType,
} from "../../../src/app/services/file-download-service.js";

const nodeFetchMock = vi.hoisted(() => vi.fn());

vi.mock("node-fetch", () => ({
  default: nodeFetchMock,
}));

describe("app/services/file-download-service", () => {
  describe("toDataUri", () => {
    it("converts buffer to base64 data URI with correct MIME type", () => {
      const buffer = Buffer.from("Hello, World!");
      const dataUri = toDataUri(buffer, "text/plain");

      expect(dataUri).toBe("data:text/plain;base64,SGVsbG8sIFdvcmxkIQ==");
    });

    it("handles image MIME types", () => {
      const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic number
      const dataUri = toDataUri(buffer, "image/png");

      expect(dataUri).toMatch(/^data:image\/png;base64,/);
      expect(dataUri).toBe("data:image/png;base64,iVBORw==");
    });

    it("handles empty buffer", () => {
      const buffer = Buffer.from([]);
      const dataUri = toDataUri(buffer, "application/octet-stream");

      expect(dataUri).toBe("data:application/octet-stream;base64,");
    });
  });

  describe("isFileSizeAllowed", () => {
    it("returns true when file size is within limit", () => {
      expect(isFileSizeAllowed(100 * 1024, 200)).toBe(true); // 100KB < 200KB
      expect(isFileSizeAllowed(1024, 1)).toBe(true); // exactly at limit
    });

    it("returns false when file size exceeds limit", () => {
      expect(isFileSizeAllowed(300 * 1024, 200)).toBe(false); // 300KB > 200KB
      expect(isFileSizeAllowed(1025, 1)).toBe(false); // just over limit
    });

    it("returns true when file size is undefined (unknown)", () => {
      expect(isFileSizeAllowed(undefined, 100)).toBe(true);
    });
  });

  describe("formatFileSize", () => {
    it("formats bytes correctly", () => {
      expect(formatFileSize(0)).toBe("0B");
      expect(formatFileSize(500)).toBe("500B");
      expect(formatFileSize(1023)).toBe("1023B");
    });

    it("formats kilobytes correctly", () => {
      expect(formatFileSize(1024)).toBe("1.0KB");
      expect(formatFileSize(1536)).toBe("1.5KB");
      expect(formatFileSize(10240)).toBe("10.0KB");
    });

    it("formats megabytes correctly", () => {
      expect(formatFileSize(1024 * 1024)).toBe("1.0MB");
      expect(formatFileSize(2.5 * 1024 * 1024)).toBe("2.5MB");
      expect(formatFileSize(10 * 1024 * 1024)).toBe("10.0MB");
    });
  });

  describe("isTextMimeType", () => {
    it("returns true for text/* MIME types", () => {
      expect(isTextMimeType("text/plain")).toBe(true);
      expect(isTextMimeType("text/markdown")).toBe(true);
      expect(isTextMimeType("text/html")).toBe(true);
      expect(isTextMimeType("text/css")).toBe(true);
      expect(isTextMimeType("text/javascript")).toBe(true);
      expect(isTextMimeType("text/x-python")).toBe(true);
      expect(isTextMimeType("text/csv")).toBe(true);
    });

    it("returns true for whitelisted application/* types", () => {
      expect(isTextMimeType("application/json")).toBe(true);
      expect(isTextMimeType("application/xml")).toBe(true);
      expect(isTextMimeType("application/javascript")).toBe(true);
      expect(isTextMimeType("application/x-yaml")).toBe(true);
      expect(isTextMimeType("application/sql")).toBe(true);
    });

    it("returns false for other application/* types", () => {
      expect(isTextMimeType("application/pdf")).toBe(false);
      expect(isTextMimeType("application/zip")).toBe(false);
      expect(isTextMimeType("application/octet-stream")).toBe(false);
      expect(isTextMimeType("application/msword")).toBe(false);
    });

    it("returns false for image/* types", () => {
      expect(isTextMimeType("image/png")).toBe(false);
      expect(isTextMimeType("image/jpeg")).toBe(false);
      expect(isTextMimeType("image/gif")).toBe(false);
    });

    it("returns false for undefined", () => {
      expect(isTextMimeType(undefined)).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(isTextMimeType("")).toBe(false);
    });

    it("returns true for unknown MIME with known code file extension", () => {
      expect(isTextMimeType("application/octet-stream", "component.svelte")).toBe(true);
      expect(isTextMimeType("application/octet-stream", "App.vue")).toBe(true);
      expect(isTextMimeType("application/octet-stream", "main.tsx")).toBe(true);
      expect(isTextMimeType("application/octet-stream", "server.go")).toBe(true);
      expect(isTextMimeType("application/octet-stream", "script.py")).toBe(true);
    });

    it("returns false for unknown MIME with unknown extension", () => {
      expect(isTextMimeType("application/octet-stream", "file.xyz")).toBe(false);
      expect(isTextMimeType("application/octet-stream", "archive.7z")).toBe(false);
    });

    it("returns false for unknown MIME without filename", () => {
      expect(isTextMimeType("application/octet-stream")).toBe(false);
    });

    it("returns false for undefined MIME even with known extension", () => {
      expect(isTextMimeType(undefined, "file.svelte")).toBe(false);
    });

    it("handles files with multiple dots correctly", () => {
      expect(isTextMimeType("application/octet-stream", "Component.test.svelte")).toBe(true);
      expect(isTextMimeType("application/octet-stream", "some.file.with.dots.py")).toBe(true);
    });

    it("handles files with no extension", () => {
      expect(isTextMimeType("application/octet-stream", "Dockerfile")).toBe(false);
    });
  });
});

describe("downloadTelegramFile reverse-proxy wiring", () => {
  beforeEach(() => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot-token-xyz");
    vi.stubEnv("TELEGRAM_ALLOWED_USER_ID", "123456789");
    vi.stubEnv("OPENCODE_MODEL_PROVIDER", "test-provider");
    vi.stubEnv("OPENCODE_MODEL_ID", "test-model");
    vi.stubEnv("TELEGRAM_PROXY_URL", "");
    vi.stubEnv("TELEGRAM_API_ROOT", "");
    vi.stubEnv("TELEGRAM_PROXY_SECRET", "");
    vi.stubEnv("TELEGRAM_FORCE_IPV4", "");
    nodeFetchMock.mockReset();
  });

  function makeApiStub(): Api {
    return {
      getFile: vi.fn().mockResolvedValue({
        file_path: "voice/sample.ogg",
        file_size: 100,
      }),
    } as unknown as Api;
  }

  function makeFetchStub(): ReturnType<typeof vi.fn> {
    return nodeFetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    });
  }

  async function loadDownloadModule() {
    vi.resetModules();
    return import("../../../src/app/services/file-download-service.js");
  }

  it("uses api.telegram.org as the file URL base when TELEGRAM_API_ROOT is unset", async () => {
    const fetchMock = makeFetchStub();
    vi.stubGlobal("fetch", fetchMock);

    const { downloadTelegramFile } = await loadDownloadModule();
    await downloadTelegramFile(makeApiStub(), "fid");

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/file/botbot-token-xyz/voice/sample.ogg");
  });

  it("uses TELEGRAM_API_ROOT as the file URL base when set", async () => {
    vi.stubEnv("TELEGRAM_API_ROOT", "https://tg-proxy.example.com");
    const fetchMock = makeFetchStub();
    vi.stubGlobal("fetch", fetchMock);

    const { downloadTelegramFile } = await loadDownloadModule();
    await downloadTelegramFile(makeApiStub(), "fid");

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://tg-proxy.example.com/file/botbot-token-xyz/voice/sample.ogg");
  });

  it("normalizes a trailing slash so the URL has no double slash", async () => {
    vi.stubEnv("TELEGRAM_API_ROOT", "https://tg-proxy.example.com/");
    const fetchMock = makeFetchStub();
    vi.stubGlobal("fetch", fetchMock);

    const { downloadTelegramFile } = await loadDownloadModule();
    await downloadTelegramFile(makeApiStub(), "fid");

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://tg-proxy.example.com/file/botbot-token-xyz/voice/sample.ogg");
  });

  it("does not send X-Proxy-Secret when TELEGRAM_PROXY_SECRET is unset", async () => {
    vi.stubEnv("TELEGRAM_API_ROOT", "https://tg-proxy.example.com");
    const fetchMock = makeFetchStub();
    vi.stubGlobal("fetch", fetchMock);

    const { downloadTelegramFile } = await loadDownloadModule();
    await downloadTelegramFile(makeApiStub(), "fid");

    const [, init] = fetchMock.mock.calls[0];
    const headers = (init as { headers?: Record<string, string> } | undefined)?.headers;
    expect(headers?.["X-Proxy-Secret"]).toBeUndefined();
  });

  it("sends X-Proxy-Secret on the file fetch when TELEGRAM_PROXY_SECRET is set", async () => {
    vi.stubEnv("TELEGRAM_API_ROOT", "https://tg-proxy.example.com");
    vi.stubEnv("TELEGRAM_PROXY_SECRET", "secret-abc");
    const fetchMock = makeFetchStub();
    vi.stubGlobal("fetch", fetchMock);

    const { downloadTelegramFile } = await loadDownloadModule();
    await downloadTelegramFile(makeApiStub(), "fid");

    const [, init] = fetchMock.mock.calls[0];
    const headers = (init as { headers?: Record<string, string> } | undefined)?.headers;
    expect(headers?.["X-Proxy-Secret"]).toBe("secret-abc");
  });

  it("does not configure a fetch agent for direct downloads by default", async () => {
    const fetchMock = makeFetchStub();
    vi.stubGlobal("fetch", fetchMock);

    const { downloadTelegramFile } = await loadDownloadModule();
    await downloadTelegramFile(makeApiStub(), "fid");

    const [, init] = fetchMock.mock.calls[0];
    expect((init as { agent?: unknown } | undefined)?.agent).toBeUndefined();
  });

  it("uses an IPv4 HTTPS agent for direct downloads when TELEGRAM_FORCE_IPV4 is enabled", async () => {
    vi.stubEnv("TELEGRAM_FORCE_IPV4", "true");
    const fetchMock = makeFetchStub();
    vi.stubGlobal("fetch", fetchMock);

    const { downloadTelegramFile } = await loadDownloadModule();
    await downloadTelegramFile(makeApiStub(), "fid");

    const [, init] = fetchMock.mock.calls[0];
    const agent = (init as { agent?: unknown } | undefined)?.agent;
    expect(agent).toBeInstanceOf(HttpsAgent);
    expect((agent as HttpsAgent).options.family).toBe(4);
  });
});
