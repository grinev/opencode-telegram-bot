import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { Context } from "grammy";
import type { VoiceMessageDeps } from "../../../src/bot/handlers/voice.js";
import { t } from "../../../src/i18n/index.js";
async function loadVoiceModule() {
  vi.resetModules();
  return import("../../../src/bot/handlers/voice.js");
}

function createVoiceContext(): {
  ctx: Context;
  replyMock: ReturnType<typeof vi.fn>;
  editMessageTextMock: ReturnType<typeof vi.fn>;
} {
  const replyMock = vi.fn().mockResolvedValue({ message_id: 101 });
  const editMessageTextMock = vi.fn().mockResolvedValue(true);

  const ctx = {
    chat: { id: 777 },
    message: {
      voice: {
        file_id: "voice-file-id",
      },
    },
    reply: replyMock,
    api: {
      editMessageText: editMessageTextMock,
    },
  } as unknown as Context;

  return { ctx, replyMock, editMessageTextMock };
}

function createVoiceDeps(overrides: Record<string, unknown> = {}): {
  deps: VoiceMessageDeps;
  downloadMock: ReturnType<typeof vi.fn>;
  transcribeMock: ReturnType<typeof vi.fn>;
} {
  const downloadMock = vi.fn().mockResolvedValue({
    buffer: Buffer.from("audio"),
    filename: "file_1.oga",
  });
  const transcribeMock = vi.fn().mockResolvedValue({ text: "run tests" });

  const deps: VoiceMessageDeps = {
    bot: {} as VoiceMessageDeps["bot"],
    ensureEventSubscription: vi.fn().mockResolvedValue(undefined),
    isSttConfigured: vi.fn(() => true),
    downloadTelegramFile: downloadMock,
    transcribeAudio: transcribeMock,
    ...overrides,
  } as VoiceMessageDeps;

  return { deps, downloadMock, transcribeMock };
}

function mockHttpsDownload(): ReturnType<typeof vi.fn> {
  const httpsGetMock = vi.fn(
    (
      _url: unknown,
      _options: unknown,
      callback: (
        response: EventEmitter & {
          statusCode: number;
          headers: Record<string, string>;
          resume: () => void;
        },
      ) => void,
    ) => {
      const response = new EventEmitter() as EventEmitter & {
        statusCode: number;
        headers: Record<string, string>;
        resume: () => void;
      };
      response.statusCode = 200;
      response.headers = {};
      response.resume = vi.fn();

      const request = new EventEmitter() as EventEmitter & {
        setTimeout: (timeout: number, callback: () => void) => void;
        destroy: (error?: Error) => void;
      };
      request.setTimeout = vi.fn();
      request.destroy = vi.fn((error?: Error) => {
        if (error) {
          request.emit("error", error);
        }
      });

      setTimeout(() => {
        callback(response);
        response.emit("data", Buffer.from("audio"));
        response.emit("end");
      }, 0);

      return request;
    },
  );

  vi.doMock("node:https", () => ({
    default: { get: httpsGetMock },
  }));

  return httpsGetMock;
}

describe("bot/handlers/voice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.doUnmock("node:https");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-telegram-token");
    vi.stubEnv("TELEGRAM_ALLOWED_USER_ID", "123456789");
    vi.stubEnv("OPENCODE_MODEL_PROVIDER", "test-provider");
    vi.stubEnv("OPENCODE_MODEL_ID", "test-model");
    vi.stubEnv("TELEGRAM_API_ROOT", "");
    vi.stubEnv("STT_NOTE_PROMPT", "");
  });

  it("returns not-configured message and does not start confirmation flow", async () => {
    const { handleVoiceMessage } = await loadVoiceModule();
    const { ctx, replyMock } = createVoiceContext();
    const { deps, downloadMock } = createVoiceDeps({
      isSttConfigured: () => false,
    });

    await handleVoiceMessage(ctx, deps);

    expect(replyMock).toHaveBeenCalledWith(t("stt.not_configured"));
    expect(downloadMock).not.toHaveBeenCalled();
    const { interactionManager } = await import("../../../src/interaction/manager.js");
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("shows empty-result message and skips confirmation flow", async () => {
    const { handleVoiceMessage } = await loadVoiceModule();
    const { ctx, editMessageTextMock } = createVoiceContext();
    const { deps } = createVoiceDeps({
      transcribeAudio: vi.fn().mockResolvedValue({ text: "   " }),
    });

    await handleVoiceMessage(ctx, deps);

    expect(editMessageTextMock).toHaveBeenCalledWith(777, 101, t("stt.empty_result"));
    const { interactionManager } = await import("../../../src/interaction/manager.js");
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("downloads voice files from the default Telegram file URL when TELEGRAM_API_ROOT is unset", async () => {
    const httpsGetMock = mockHttpsDownload();
    const { handleVoiceMessage } = await loadVoiceModule();
    const { ctx } = createVoiceContext();
    const getFileMock = vi.fn().mockResolvedValue({
      file_path: "voice/file_123.oga",
      file_size: 5,
    });
    (ctx.api as unknown as { getFile: typeof getFileMock }).getFile = getFileMock;
    const { deps } = createVoiceDeps({
      downloadTelegramFile: undefined,
      transcribeAudio: vi.fn().mockResolvedValue({ text: "hello" }),
    });

    await handleVoiceMessage(ctx, deps);

    const [url] = httpsGetMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://api.telegram.org/file/bottest-telegram-token/voice/file_123.oga",
    );

    const { interactionManager } = await import("../../../src/interaction/manager.js");
    const interaction = interactionManager.getSnapshot();
    expect(interaction).not.toBeNull();
    expect(interaction!.metadata.sttTranscript).toBe("hello");
  });

  it("downloads voice files from TELEGRAM_API_ROOT without a double slash", async () => {
    vi.stubEnv("TELEGRAM_API_ROOT", "https://tg-proxy.example.com/");
    const httpsGetMock = mockHttpsDownload();
    const { handleVoiceMessage } = await loadVoiceModule();
    const { ctx } = createVoiceContext();
    const getFileMock = vi.fn().mockResolvedValue({
      file_path: "voice/file_123.oga",
      file_size: 5,
    });
    (ctx.api as unknown as { getFile: typeof getFileMock }).getFile = getFileMock;
    const { deps } = createVoiceDeps({
      downloadTelegramFile: undefined,
    });

    await handleVoiceMessage(ctx, deps);

    const [url] = httpsGetMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://tg-proxy.example.com/file/bottest-telegram-token/voice/file_123.oga",
    );
  });
});
