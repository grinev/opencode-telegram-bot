import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import type { VoiceMessageDeps } from "../../../src/bot/handlers/voice.js";
import { t } from "../../../src/i18n/index.js";

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

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
  processPromptMock: ReturnType<typeof vi.fn>;
  downloadMock: ReturnType<typeof vi.fn>;
  transcribeMock: ReturnType<typeof vi.fn>;
} {
  const processPromptMock = vi.fn().mockResolvedValue(true);
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
    processPrompt: processPromptMock,
    ...overrides,
  };

  return { deps, processPromptMock, downloadMock, transcribeMock };
}

describe("bot/handlers/voice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-telegram-token");
    vi.stubEnv("TELEGRAM_ALLOWED_USER_ID", "123456789");
    vi.stubEnv("OPENCODE_MODEL_PROVIDER", "test-provider");
    vi.stubEnv("OPENCODE_MODEL_ID", "test-model");
    vi.stubEnv("STT_NOTE_PROMPT", "");
  });

  it("continues with prompt processing when recognized text message edit fails", async () => {
    const { handleVoiceMessage } = await loadVoiceModule();
    const { ctx, replyMock, editMessageTextMock } = createVoiceContext();
    const { deps, processPromptMock } = createVoiceDeps();

    editMessageTextMock.mockRejectedValueOnce(new Error("message is too long"));

    await handleVoiceMessage(ctx, deps);

    expect(replyMock).toHaveBeenCalledWith(t("stt.recognizing"));
    expect(processPromptMock).toHaveBeenCalledWith(ctx, "run tests", deps);
  });

  it("returns not-configured message and does not process prompt", async () => {
    const { handleVoiceMessage } = await loadVoiceModule();
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
    const { handleVoiceMessage } = await loadVoiceModule();
    const { ctx, editMessageTextMock } = createVoiceContext();
    const { deps, processPromptMock } = createVoiceDeps({
      transcribeAudio: vi.fn().mockResolvedValue({ text: "   " }),
    });

    await handleVoiceMessage(ctx, deps);

    expect(editMessageTextMock).toHaveBeenCalledWith(777, 101, t("stt.empty_result"));
    expect(processPromptMock).not.toHaveBeenCalled();
  });

  it("adds STT note to the LLM prompt when STT_NOTE_PROMPT is set", async () => {
    vi.stubEnv(
      "STT_NOTE_PROMPT",
      "The following text is transcribed from voice. It may contain phonetic errors. Infer the intended meaning from context.",
    );

    const { handleVoiceMessage } = await loadVoiceModule();
    const { logger } = await import("../../../src/utils/logger.js");
    const { ctx } = createVoiceContext();
    const { deps, processPromptMock } = createVoiceDeps();
    const note =
      "The following text is transcribed from voice. It may contain phonetic errors. Infer the intended meaning from context.";

    await handleVoiceMessage(ctx, deps);

    expect(processPromptMock).toHaveBeenCalledWith(ctx, `[Note: ${note}]\nrun tests`, deps);
    expect(logger.debug).toHaveBeenCalledWith(
      `[Voice] Added STT note to LLM prompt: [Note: ${note}]`,
    );
  });

  it.each(["", "false", "0", "   "])(
    "does not add STT note when STT_NOTE_PROMPT is %j",
    async (notePrompt) => {
      vi.stubEnv("STT_NOTE_PROMPT", notePrompt);

      const { handleVoiceMessage } = await loadVoiceModule();
      const { logger } = await import("../../../src/utils/logger.js");
      const { ctx } = createVoiceContext();
      const { deps, processPromptMock } = createVoiceDeps();

      await handleVoiceMessage(ctx, deps);

      expect(processPromptMock).toHaveBeenCalledWith(ctx, "run tests", deps);
      expect(logger.debug).not.toHaveBeenCalled();
    },
  );
});
