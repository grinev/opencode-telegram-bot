import { describe, expect, it, vi } from "vitest";
import { InputFile } from "grammy";
import { sendTtsResponseForSession } from "../../../src/bot/utils/send-tts-response.js";
import { t } from "../../../src/i18n/index.js";

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("bot/utils/send-tts-response", () => {
  it("sends audio when the session response mode requires TTS", async () => {
    const sendAudioMock = vi.fn().mockResolvedValue(undefined);
    const sendMessageMock = vi.fn().mockResolvedValue(undefined);
    const synthesizeSpeechMock = vi.fn().mockResolvedValue({
      buffer: Buffer.from("mp3"),
      filename: "assistant-reply.mp3",
      mimeType: "audio/mpeg",
    });

    const result = await sendTtsResponseForSession({
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
    const [chatId, inputFile] = sendAudioMock.mock.calls[0];
    expect(chatId).toBe(123);
    expect(inputFile).toBeInstanceOf(InputFile);
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("skips audio when the session response mode is text only", async () => {
    const sendAudioMock = vi.fn().mockResolvedValue(undefined);
    const sendMessageMock = vi.fn().mockResolvedValue(undefined);
    const synthesizeSpeechMock = vi.fn();

    const result = await sendTtsResponseForSession({
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

    const result = await sendTtsResponseForSession({
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

    const result = await sendTtsResponseForSession({
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
