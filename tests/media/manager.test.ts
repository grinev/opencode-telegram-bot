import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Hoisted mocks ---

const { mkdirMock, writeFileMock } = vi.hoisted(() => ({
  mkdirMock: vi.fn(),
  writeFileMock: vi.fn(),
}));

const { spawnMock, execMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  execMock: vi.fn(),
}));

const { configMock } = vi.hoisted(() => ({
  configMock: {
    media: { dir: "/tmp/test-media" },
    telegram: { token: "test-token", allowedUserId: 123456789 },
    transcription: { command: "" },
    opencode: {
      apiUrl: "http://localhost:4096",
      username: "opencode",
      password: "",
      model: { provider: "test", modelId: "test" },
    },
    server: { logLevel: "error" },
    bot: { sessionsListLimit: 10, locale: "en" as const },
    files: { maxFileSizeKb: 100 },
  },
}));

vi.mock("fs", () => ({
  promises: {
    mkdir: mkdirMock,
    writeFile: writeFileMock,
  },
}));

vi.mock("child_process", () => ({
  spawn: spawnMock,
  exec: execMock,
}));

vi.mock("../../src/config.js", () => ({
  config: configMock,
  envFilePath: "/test/.env",
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  ensureMediaDir,
  saveTelegramFile,
  transcribeAudioFile,
  __resetMediaDirCacheForTests,
} from "../../src/media/manager.js";

// --- Helpers ---

function createMockProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  return proc;
}

function createMockApi(filePath?: string) {
  return {
    getFile: vi.fn().mockResolvedValue({ file_path: filePath }),
  };
}

// --- Tests ---

describe("media/manager", () => {
  beforeEach(() => {
    mkdirMock.mockReset();
    writeFileMock.mockReset();
    spawnMock.mockReset();
    mkdirMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
    configMock.media.dir = "/tmp/test-media";
    configMock.transcription.command = "";
    __resetMediaDirCacheForTests();
  });

  // =========================================================================
  // ensureMediaDir
  // =========================================================================

  describe("ensureMediaDir", () => {
    it("creates directory on first call", async () => {
      const dir = await ensureMediaDir();

      expect(mkdirMock).toHaveBeenCalledWith("/tmp/test-media", { recursive: true });
      expect(dir).toBe("/tmp/test-media");
    });

    it("caches result — skips mkdir on second call", async () => {
      await ensureMediaDir();
      await ensureMediaDir();

      expect(mkdirMock).toHaveBeenCalledTimes(1);
    });

    it("throws when mkdir fails", async () => {
      mkdirMock.mockRejectedValue(new Error("EACCES"));

      await expect(ensureMediaDir()).rejects.toThrow("EACCES");
    });

    it("retries mkdir after failure (cache not set on error)", async () => {
      mkdirMock.mockRejectedValueOnce(new Error("EACCES"));
      mkdirMock.mockResolvedValueOnce(undefined);

      await expect(ensureMediaDir()).rejects.toThrow("EACCES");

      // Reset cache since the first call failed and cache shouldn't be set
      __resetMediaDirCacheForTests();

      const dir = await ensureMediaDir();
      expect(dir).toBe("/tmp/test-media");
      expect(mkdirMock).toHaveBeenCalledTimes(2);
    });
  });

  // =========================================================================
  // saveTelegramFile
  // =========================================================================

  describe("saveTelegramFile", () => {
    it("downloads and saves file with correct MIME type", async () => {
      const mockBody = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          arrayBuffer: () => Promise.resolve(mockBody.buffer),
        }),
      );

      const api = createMockApi("photos/file_42.jpg");
      const result = await saveTelegramFile(api, "file-id-123", "photo.jpg");

      expect(api.getFile).toHaveBeenCalledWith("file-id-123");
      expect(result.fileName).toMatch(/^\d+_photo\.jpg$/);
      expect(result.filePath).toMatch(/^\/tmp\/test-media\/\d+_photo\.jpg$/);
      expect(result.mimeType).toBe("image/jpeg");
      expect(result.fileUrl).toMatch(/^file:\/\//);
      expect(writeFileMock).toHaveBeenCalledTimes(1);
    });

    it("throws when getFile returns no file_path", async () => {
      const api = createMockApi(undefined);

      await expect(saveTelegramFile(api, "file-id", "test.jpg")).rejects.toThrow(
        "Could not get file path from Telegram",
      );
    });

    it("throws when fetch response is not ok", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 404,
          statusText: "Not Found",
        }),
      );

      const api = createMockApi("photos/test.jpg");

      await expect(saveTelegramFile(api, "file-id", "test.jpg")).rejects.toThrow(
        "Failed to download file: 404 Not Found",
      );
    });

    it("sanitizes special characters in filename", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        }),
      );

      const api = createMockApi("docs/test.pdf");
      const result = await saveTelegramFile(api, "fid", "my résumé (final).pdf");

      // Special chars replaced with underscores
      expect(result.fileName).toMatch(/^\d+_my_r_sum___final_\.pdf$/);
    });

    it("truncates very long filenames to 50 chars", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        }),
      );

      const api = createMockApi("docs/test.txt");
      const longName = "a".repeat(100) + ".txt";
      const result = await saveTelegramFile(api, "fid", longName);

      // baseName portion is sliced to 50
      const basePart = result.fileName.replace(/^\d+_/, "").replace(/\.txt$/, "");
      expect(basePart.length).toBeLessThanOrEqual(50);
    });

    it("returns correct MIME for various extensions", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        }),
      );

      const cases: [string, string][] = [
        ["file.png", "image/png"],
        ["file.gif", "image/gif"],
        ["file.mp4", "video/mp4"],
        ["file.ogg", "audio/ogg"],
        ["file.mp3", "audio/mpeg"],
        ["file.pdf", "application/pdf"],
        ["file.json", "application/json"],
        ["file.xyz", "application/octet-stream"],
      ];

      for (const [name, expectedMime] of cases) {
        const api = createMockApi("path/" + name);
        const result = await saveTelegramFile(api, "fid", name);
        expect(result.mimeType).toBe(expectedMime);

        // Reset cache for next iteration
        __resetMediaDirCacheForTests();
        mkdirMock.mockResolvedValue(undefined);
      }
    });

    it("handles filename with no extension", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        }),
      );

      const api = createMockApi("docs/noext");
      const result = await saveTelegramFile(api, "fid", "noext");

      expect(result.mimeType).toBe("application/octet-stream");
      expect(result.fileName).toMatch(/^\d+_noext$/);
    });
  });

  // =========================================================================
  // transcribeAudioFile
  // =========================================================================

  describe("transcribeAudioFile", () => {
    it("returns notConfigured when command is empty", async () => {
      configMock.transcription.command = "";

      const result = await transcribeAudioFile("/tmp/voice.ogg");

      expect(result.success).toBe(false);
      expect(result.notConfigured).toBe(true);
      expect(result.error).toContain("not configured");
      expect(spawnMock).not.toHaveBeenCalled();
    });

    it("returns success with transcript on exit code 0 + stdout", async () => {
      configMock.transcription.command = "transcribe {voice-message-file}";
      const proc = createMockProcess();
      spawnMock.mockReturnValue(proc);

      const promise = transcribeAudioFile("/tmp/voice.ogg");

      // Simulate process output
      proc.stdout.emit("data", "Hello, world!");
      proc.emit("close", 0);

      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.transcript).toBe("Hello, world!");
      expect(spawnMock).toHaveBeenCalledWith("transcribe /tmp/voice.ogg", [], expect.any(Object));
    });

    it("replaces {voice-message-file} placeholder in command", async () => {
      configMock.transcription.command = "whisper --file={voice-message-file} --lang=de";
      const proc = createMockProcess();
      spawnMock.mockReturnValue(proc);

      const promise = transcribeAudioFile("/path/to/audio.ogg");

      proc.stdout.emit("data", "Hallo Welt");
      proc.emit("close", 0);

      await promise;

      expect(spawnMock.mock.calls[0][0]).toBe("whisper --file=/path/to/audio.ogg --lang=de");
    });

    it("trims whitespace from transcript", async () => {
      configMock.transcription.command = "transcribe {voice-message-file}";
      const proc = createMockProcess();
      spawnMock.mockReturnValue(proc);

      const promise = transcribeAudioFile("/tmp/voice.ogg");

      proc.stdout.emit("data", "  Hello  \n\n");
      proc.emit("close", 0);

      const result = await promise;
      expect(result.transcript).toBe("Hello");
    });

    it("returns failure when exit code is non-zero", async () => {
      configMock.transcription.command = "transcribe {voice-message-file}";
      const proc = createMockProcess();
      spawnMock.mockReturnValue(proc);

      const promise = transcribeAudioFile("/tmp/voice.ogg");

      proc.stderr.emit("data", "file not found");
      proc.emit("close", 1);

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toBe("file not found");
      expect(result.details).toContain("exit_code: 1");
      expect(result.details).toContain("stderr: file not found");
      expect(result.details).toContain("command: transcribe /tmp/voice.ogg");
    });

    it("returns failure when exit code is 0 but stdout is empty", async () => {
      configMock.transcription.command = "transcribe {voice-message-file}";
      const proc = createMockProcess();
      spawnMock.mockReturnValue(proc);

      const promise = transcribeAudioFile("/tmp/voice.ogg");

      proc.emit("close", 0);

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toBe("Exit code 0");
    });

    it("returns failure when exit code is null (killed/timeout)", async () => {
      configMock.transcription.command = "transcribe {voice-message-file}";
      const proc = createMockProcess();
      spawnMock.mockReturnValue(proc);

      const promise = transcribeAudioFile("/tmp/voice.ogg");

      proc.emit("close", null);

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.details).toContain("exit_code: unknown");
    });

    it("returns failure on spawn error (binary not found)", async () => {
      configMock.transcription.command = "nonexistent-binary {voice-message-file}";
      const proc = createMockProcess();
      spawnMock.mockReturnValue(proc);

      const promise = transcribeAudioFile("/tmp/voice.ogg");

      proc.emit("error", new Error("spawn nonexistent-binary ENOENT"));

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toContain("ENOENT");
      expect(result.notConfigured).toBeUndefined();
    });

    it("includes both stdout and stderr in details on failure", async () => {
      configMock.transcription.command = "transcribe {voice-message-file}";
      const proc = createMockProcess();
      spawnMock.mockReturnValue(proc);

      const promise = transcribeAudioFile("/tmp/voice.ogg");

      proc.stdout.emit("data", "partial output");
      proc.stderr.emit("data", "warning: something");
      proc.emit("close", 2);

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.details).toContain("stdout: partial output");
      expect(result.details).toContain("stderr: warning: something");
      expect(result.details).toContain("exit_code: 2");
    });

    it("truncates very long stderr/stdout in details", async () => {
      configMock.transcription.command = "transcribe {voice-message-file}";
      const proc = createMockProcess();
      spawnMock.mockReturnValue(proc);

      const promise = transcribeAudioFile("/tmp/voice.ogg");

      const longOutput = "x".repeat(2000);
      proc.stderr.emit("data", longOutput);
      proc.emit("close", 1);

      const result = await promise;

      // truncateOutput default is 1200 + "..."
      const stderrLine = result.details!.split("\n").find((l) => l.startsWith("stderr:"));
      expect(stderrLine).toBeDefined();
      // "stderr: " = 8 chars + 1200 chars + "..." = 1211
      expect(stderrLine!.length).toBeLessThanOrEqual(1220);
    });

    it("accumulates multiple data chunks", async () => {
      configMock.transcription.command = "transcribe {voice-message-file}";
      const proc = createMockProcess();
      spawnMock.mockReturnValue(proc);

      const promise = transcribeAudioFile("/tmp/voice.ogg");

      proc.stdout.emit("data", "chunk1 ");
      proc.stdout.emit("data", "chunk2 ");
      proc.stdout.emit("data", "chunk3");
      proc.emit("close", 0);

      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.transcript).toBe("chunk1 chunk2 chunk3");
    });

    it("passes shell: true and timeout to spawn", async () => {
      configMock.transcription.command = "transcribe {voice-message-file}";
      const proc = createMockProcess();
      spawnMock.mockReturnValue(proc);

      const promise = transcribeAudioFile("/tmp/voice.ogg");

      proc.stdout.emit("data", "ok");
      proc.emit("close", 0);

      await promise;

      expect(spawnMock).toHaveBeenCalledWith(
        expect.any(String),
        [],
        expect.objectContaining({
          shell: true,
          timeout: 60000,
        }),
      );
    });
  });
});
