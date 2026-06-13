import { InputFile } from "grammy";
import { prepareTtsResponseForSession, type TtsResult } from "../../app/services/tts-service.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { consumePromptResponseMode } from "./prompt.js";

interface TelegramAudioApi {
  sendAudio: (chatId: number, audio: InputFile) => Promise<unknown>;
  sendMessage: (chatId: number, text: string) => Promise<unknown>;
}

interface SendTtsResponseParams {
  api: TelegramAudioApi;
  sessionId: string;
  chatId: number;
  text: string;
  consumeResponseMode?: (sessionId: string) => "text_only" | "text_and_tts" | null;
  isTtsConfigured?: () => boolean;
  synthesizeSpeech?: (text: string) => Promise<TtsResult>;
}

export async function sendTtsResponseForSession({
  api,
  sessionId,
  chatId,
  text,
  consumeResponseMode: consumeResponseModeImpl = consumePromptResponseMode,
  isTtsConfigured,
  synthesizeSpeech,
}: SendTtsResponseParams): Promise<boolean> {
  try {
    const prepared = await prepareTtsResponseForSession({
      sessionId,
      text,
      consumeResponseMode: consumeResponseModeImpl,
      isTtsConfigured,
      synthesizeSpeech,
    });

    if (!prepared.shouldSend) {
      return false;
    }

    await api.sendAudio(chatId, new InputFile(prepared.speech.buffer, prepared.speech.filename));
    logger.info(`[TTS] Sent audio reply for session ${sessionId}`);
    return true;
  } catch (error) {
    logger.warn(`[TTS] Failed to send audio reply for session ${sessionId}`, error);

    await api.sendMessage(chatId, t("tts.failed")).catch((sendError) => {
      logger.warn(`[TTS] Failed to send audio error message for session ${sessionId}`, sendError);
    });

    return false;
  }
}
