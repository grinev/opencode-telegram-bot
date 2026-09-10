import { describe, expect, it, vi } from "#vitest";
import { InputFile } from "grammy";
import { mockDep } from "#helpers/mock-dep.js";
import { loadSut } from "#helpers/sut-loader.js";
import { defined } from "#helpers/defined.js";

import { loadSut } from "#helpers/sut-loader.js";
mockDep(
  "#src/utils/logger.ts",
  () => ({
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  }),
  import.meta.url,
);

const sut = await loadSut<typeof import("#src/bot/handlers/tts-response-handler.js")>(
  "#src/bot/handlers/tts-response-handler.ts",
  import.meta.url,
);

const { t } = await loadSut<typeof import("#src/i18n/index.js")>(
  "#src/i18n/index.ts",
  import.meta.url,
);

describe("bot/handlers/tts-response-handler", () => {
  it("sends audio when the session response mode requires TTS", async () => {
    const sendAudioMock = vi.fn().mockResolvedValue(undefined);
    const sendMessageMock = vi.fn().mockResolvedValue(undefined);
    const synthesizeSpeechMock = vi.fn().mockResolvedValue({
      buffer: Buffer.from("mp3"),
      filename: "assistant-reply.mp3",
      mimeType: "audio/mpeg",
    });

    const result = await sut.sendTtsResponseForSession({
      api: { sendAudio: sendAudioMock, sendMessage: sendMessageMock },
      sessionId: "session-1",
      chatId: 123,
      text: "Hello from audio",
      consumeResponseMode: () => "text_and_tts",
      isTtsConfigured: () => true,
      synthesizeSpeech: synthesizeSpeechMock,
    });

    expect(result).toBe(true);
    expect(synthesizeSpeechMock).toHaveBeenCalledWith("Hello from audio");
    expect(sendAudioMock).toHaveBeenCalledTimes(1);
    const call = defined(sendAudioMock.mock.calls[0]);
    const [chatId, inputFile] = call;
    expect(chatId).toBe(123);
    expect(inputFile).toBeInstanceOf(InputFile);
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("skips audio when the session response mode is text only", async () => {
    const sendAudioMock = vi.fn().mockResolvedValue(undefined);
    const sendMessageMock = vi.fn().mockResolvedValue(undefined);
    const synthesizeSpeechMock = vi.fn();

    const result = await sut.sendTtsResponseForSession({
      api: { sendAudio: sendAudioMock, sendMessage: sendMessageMock },
      sessionId: "session-1",
      chatId: 123,
      text: "Hello from text",
      consumeResponseMode: () => "text_only",
      isTtsConfigured: () => true,
      synthesizeSpeech: synthesizeSpeechMock,
    });

    expect(result).toBe(false);
    expect(synthesizeSpeechMock).not.toHaveBeenCalled();
    expect(sendAudioMock).not.toHaveBeenCalled();
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("skips audio when TTS is not configured", async () => {
    const sendAudioMock = vi.fn().mockResolvedValue(undefined);
    const sendMessageMock = vi.fn().mockResolvedValue(undefined);
    const synthesizeSpeechMock = vi.fn();

    const result = await sut.sendTtsResponseForSession({
      api: { sendAudio: sendAudioMock, sendMessage: sendMessageMock },
      sessionId: "session-1",
      chatId: 123,
      text: "Hello from audio",
      consumeResponseMode: () => "text_and_tts",
      isTtsConfigured: () => false,
      synthesizeSpeech: synthesizeSpeechMock,
    });

    expect(result).toBe(false);
    expect(synthesizeSpeechMock).not.toHaveBeenCalled();
    expect(sendAudioMock).not.toHaveBeenCalled();
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("sends a user-facing error when audio generation fails", async () => {
    const sendAudioMock = vi.fn().mockRejectedValue(new Error("tts failed"));
    const sendMessageMock = vi.fn().mockResolvedValue(undefined);
    const synthesizeSpeechMock = vi.fn().mockResolvedValue({
      buffer: Buffer.from("mp3"),
      filename: "assistant-reply.mp3",
      mimeType: "audio/mpeg",
    });

    const result = await sut.sendTtsResponseForSession({
      api: { sendAudio: sendAudioMock, sendMessage: sendMessageMock },
      sessionId: "session-1",
      chatId: 123,
      text: "Hello from audio",
      consumeResponseMode: () => "text_and_tts",
      isTtsConfigured: () => true,
      synthesizeSpeech: synthesizeSpeechMock,
    });

    expect(result).toBe(false);
    expect(sendMessageMock).toHaveBeenCalledWith(123, t("tts.failed"));
  });
});
