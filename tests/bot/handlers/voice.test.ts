import { beforeEach, describe, expect, it, vi } from "#vitest";
import type { Context } from "grammy";
import type { VoiceMessageDeps } from "#src/bot/handlers/voice-handler.js";
import { loadSut } from "#helpers/sut-loader.js";
import { createSettingsStoreMock } from "#helpers/settings-store-mock.js";
const { t } = await loadSut<typeof import("#src/i18n/index.js")>(
  "#src/i18n/index.ts",
  import.meta.url,
);

// ---- Mutable mocks (registered BEFORE any SUT load) ----

const mocked = vi.hoisted(() => ({
  getTtsModeMock: vi.fn(),
  getPromptQueueEnabledMock: vi.fn(),
  fetchMock: vi.fn(),
  loggerDebugMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  flushPendingPromptMock: vi.fn(),
}));

const configMock = vi.hoisted(() => ({
  telegram: {
    token: "test-telegram-token",
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
    model: { provider: "test-provider", modelId: "test-model" },
  },
  server: { logLevel: "info" },
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
  files: { maxFileSizeKb: 100 },
  open: { browserRoots: "" },
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
}));

const settingsStoreMock = createSettingsStoreMock();
settingsStoreMock.getTtsMode = mocked.getTtsModeMock;
settingsStoreMock.getPromptQueueEnabled = mocked.getPromptQueueEnabledMock;

vi.mock("#src/config.ts", () => ({
  config: configMock,
}));

vi.mock("#src/app/stores/settings-store.ts", () => settingsStoreMock);

vi.mock("#src/utils/logger.ts", () => ({
  logger: {
    debug: mocked.loggerDebugMock,
    info: mocked.loggerInfoMock,
    warn: mocked.loggerWarnMock,
    error: mocked.loggerErrorMock,
  },
}));

vi.mock("#src/bot/handlers/message-merger.ts", () => ({
  flushPendingPrompt: mocked.flushPendingPromptMock,
  __resetMessageMergerForTests: vi.fn(),
}));

async function getSut() {
  return loadSut<typeof import("#src/bot/handlers/voice-handler.js")>(
    "#src/bot/handlers/voice-handler.ts",
    import.meta.url,
  );
}

const loadVoiceModule = getSut;

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
      getFile: vi.fn().mockResolvedValue({
        file_path: "voice/sample.ogg",
        file_size: 1024,
      }),
    },
  } as unknown as Context;

  return { ctx, replyMock, editMessageTextMock };
}

function createVoiceDeps(overrides: Record<string, unknown> = {}): {
  deps: VoiceMessageDeps;
  processPromptMock: ReturnType<typeof vi.fn>;
  downloadMock: ReturnType<typeof vi.fn>;
  transcribeMock: ReturnType<typeof vi.fn>;
} {
  const processPromptMock = vi.fn().mockResolvedValue(true);
  const downloadMock = vi.fn().mockResolvedValue({
    buffer: Buffer.from("audio"),
    filename: "file_1.ogg",
  });
  const transcribeMock = vi.fn().mockResolvedValue({ text: "run tests" });

  const deps: VoiceMessageDeps = {
    bot: {} as VoiceMessageDeps["bot"],
    ensureEventSubscription: vi.fn().mockResolvedValue(undefined),
    isSttConfigured: vi.fn(() => true),
    downloadTelegramFile: downloadMock,
    transcribeAudio: transcribeMock,
    processPrompt: (ctx, input, promptDeps, options) =>
      processPromptMock(ctx, input.text, promptDeps, input.fileParts, options),
    ...overrides,
  };

  return { deps, processPromptMock, downloadMock, transcribeMock };
}

describe("bot/handlers/voice-handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.getTtsModeMock.mockReturnValue("off");
    mocked.getPromptQueueEnabledMock.mockReturnValue(false);
    mocked.fetchMock.mockReset();
    configMock.stt.notePrompt = "";
    configMock.telegram.token = "test-telegram-token";
    configMock.telegram.apiRoot = "";
    configMock.telegram.proxyUrl = "";
    configMock.telegram.proxySecret = "";
    configMock.stt.apiUrl = "";
    configMock.stt.apiKey = "";
  });

  it("edits the status message with quoted recognized text", async () => {
    const { handleVoiceMessage } = await loadVoiceModule();
    const { ctx, replyMock, editMessageTextMock } = createVoiceContext();
    const { deps, processPromptMock } = createVoiceDeps({
      transcribeAudio: vi.fn().mockResolvedValue({ text: "Line 1\nLine 2" }),
    });

    await handleVoiceMessage(ctx, deps);

    expect(replyMock).toHaveBeenCalledWith(t("stt.recognizing"));
    expect(editMessageTextMock).toHaveBeenCalledWith(
      777,
      101,
      "🎤 Recognized:\n> Line 1\n> Line 2",
      { parse_mode: "MarkdownV2" },
    );
    expect(processPromptMock).toHaveBeenCalledWith(ctx, "Line 1\nLine 2", deps, [], {
      responseMode: "text_only",
    });
  });

  it("transcribes and queues a voice message while the agent is busy", async () => {
    mocked.getPromptQueueEnabledMock.mockReturnValue(true);
    const { handleVoiceMessage } = await loadVoiceModule();
    const { foregroundSessionState } = await import(
      "../../../src/app/managers/foreground-session-state-manager.js"
    );
    const { promptQueue } = await import("../../../src/app/managers/prompt-queue-manager.js");
    foregroundSessionState.__resetForTests();
    promptQueue.__resetForTests();
    foregroundSessionState.markBusy("session-1", "/repo");
    const { ctx } = createVoiceContext();
    const { deps, processPromptMock, transcribeMock } = createVoiceDeps();

    await handleVoiceMessage(ctx, deps);

    expect(transcribeMock).toHaveBeenCalledTimes(1);
    expect(processPromptMock).not.toHaveBeenCalled();
    expect(promptQueue.list()).toEqual([
      expect.objectContaining({
        text: "run tests",
        displayText: "run tests",
        responseMode: "text_only",
      }),
    ]);
    expect(promptQueue.mediaSize()).toBe(0);
  });

  it("continues with prompt processing when recognized text message edit fails", async () => {
    const { handleVoiceMessage } = await getSut();
    const { ctx, replyMock, editMessageTextMock } = createVoiceContext();
    const { deps, processPromptMock } = createVoiceDeps();

    editMessageTextMock.mockRejectedValueOnce(new Error("message is too long"));

    await handleVoiceMessage(ctx, deps);

    expect(mocked.flushPendingPromptMock).toHaveBeenCalledWith(777);
    expect(replyMock).toHaveBeenCalledWith(t("stt.recognizing"));
    expect(processPromptMock).toHaveBeenCalledWith(ctx, "run tests", deps, [], {
      responseMode: "text_only",
    });
  });

  it("returns not-configured message and does not process prompt", async () => {
    const { handleVoiceMessage } = await getSut();
    const { ctx, replyMock } = createVoiceContext();
    const { deps, processPromptMock, downloadMock } = createVoiceDeps({
      isSttConfigured: () => false,
    });

    await handleVoiceMessage(ctx, deps);

    expect(replyMock).toHaveBeenCalledWith(t("stt.not_configured"));
    expect(downloadMock).not.toHaveBeenCalled();
    expect(processPromptMock).not.toHaveBeenCalled();
  });

  it("shows empty-result message and skips prompt processing", async () => {
    const { handleVoiceMessage } = await getSut();
    const { ctx, editMessageTextMock } = createVoiceContext();
    const { deps, processPromptMock } = createVoiceDeps({
      transcribeAudio: vi.fn().mockResolvedValue({ text: "   " }),
    });

    await handleVoiceMessage(ctx, deps);

    expect(editMessageTextMock).toHaveBeenCalledWith(777, 101, t("stt.empty_result"));
    expect(processPromptMock).not.toHaveBeenCalled();
  });

  it("adds STT note to the LLM prompt when STT_NOTE_PROMPT is set", async () => {
    configMock.stt.notePrompt =
      "The following text is transcribed from voice. It may contain phonetic errors. Infer the intended meaning from context.";

    const { handleVoiceMessage } = await getSut();
    const { ctx } = createVoiceContext();
    const { deps, processPromptMock } = createVoiceDeps();
    const note =
      "The following text is transcribed from voice. It may contain phonetic errors. Infer the intended meaning from context.";

    await handleVoiceMessage(ctx, deps);

    expect(processPromptMock).toHaveBeenCalledWith(
      ctx,
      `[Note: ${note}]\nrun tests`,
      deps,
      [],
      { responseMode: "text_only" },
    );
    expect(mocked.loggerDebugMock).toHaveBeenCalledWith(
      `[Voice] Added STT note to LLM prompt: [Note: ${note}]`,
    );
  });

  it("requests an audio reply for voice prompts when TTS mode is auto", async () => {
    mocked.getTtsModeMock.mockReturnValue("auto");
    const { handleVoiceMessage } = await getSut();
    const { ctx } = createVoiceContext();
    const { deps, processPromptMock } = createVoiceDeps();

    await handleVoiceMessage(ctx, deps);

    expect(processPromptMock).toHaveBeenCalledWith(ctx, "run tests", deps, [], {
      responseMode: "text_and_tts",
    });
  });

  it.each(["", "false", "0", "   "])(
    "does not add STT note when STT_NOTE_PROMPT is %j",
    async (notePrompt) => {
      configMock.stt.notePrompt = notePrompt;

      const { handleVoiceMessage } = await getSut();
      const { ctx } = createVoiceContext();
      const { deps, processPromptMock } = createVoiceDeps();

      await handleVoiceMessage(ctx, deps);

      expect(processPromptMock).toHaveBeenCalledWith(ctx, "run tests", deps, [], {
        responseMode: "text_only",
      });
      // The prompt text must NOT contain the note prefix if STT_NOTE_PROMPT is falsy.
      const callArg = processPromptMock.mock.calls[0]?.[1];
      expect(callArg).not.toContain("[Note:");
    },
  );

  it("downloads voice files from the default Telegram file URL when TELEGRAM_API_ROOT is unset", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { handleVoiceMessage } = await getSut();
    const { ctx } = createVoiceContext();
    const transcribeMock = vi.fn().mockResolvedValue({ text: "hello" });
    const { deps, processPromptMock } = createVoiceDeps({
      downloadTelegramFile: undefined,
      transcribeAudio: transcribeMock,
    });
    // Clear the default getFile mock and set our own
    (ctx.api as { getFile: ReturnType<typeof vi.fn> }).getFile = vi
      .fn()
      .mockResolvedValue({ file_path: "voice/file_123.oga", file_size: 5 });

    await handleVoiceMessage(ctx, deps);

    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://api.telegram.org/file/bottest-telegram-token/voice/file_123.oga",
    );
    expect(processPromptMock).toHaveBeenCalledWith(ctx, "hello", deps, [], {
      responseMode: "text_only",
    });
  });

  it("downloads voice files from TELEGRAM_API_ROOT without a double slash", async () => {
    configMock.telegram.apiRoot = "https://tg-proxy.example.com/";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { handleVoiceMessage } = await getSut();
    const { ctx } = createVoiceContext();
    const transcribeMock = vi.fn().mockResolvedValue({ text: "hello" });
    const { deps, processPromptMock } = createVoiceDeps({
      downloadTelegramFile: undefined,
      transcribeAudio: transcribeMock,
    });
    (ctx.api as { getFile: ReturnType<typeof vi.fn> }).getFile = vi
      .fn()
      .mockResolvedValue({ file_path: "voice/file_123.oga", file_size: 5 });

    await handleVoiceMessage(ctx, deps);

    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://tg-proxy.example.com/file/bottest-telegram-token/voice/file_123.oga",
    );
    expect(processPromptMock).toHaveBeenCalledWith(ctx, "hello", deps, [], {
      responseMode: "text_only",
    });
  });
});
