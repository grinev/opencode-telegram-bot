import type { Api, RawApi } from "grammy";
import {
  buildExternalUserInputNotification,
  type ExternalUserInputNotification,
} from "../../app/services/external-user-input-service.js";
import { sendBotText } from "./telegram-text.js";

type SendMessageApi = Pick<Api<RawApi>, "sendMessage">;

interface DeliverExternalUserInputParams {
  api: SendMessageApi;
  chatId: number;
  currentSessionId: string | null;
  sessionId: string;
  text: string;
  consumeSuppressedInput: (sessionId: string, text: string) => boolean;
}

async function sendExternalUserInputNotification(
  api: SendMessageApi,
  chatId: number,
  notification: ExternalUserInputNotification,
): Promise<void> {
  await sendBotText({
    api,
    chatId,
    text: notification.text,
    rawFallbackText: notification.rawFallbackText,
    format: "markdown_v2",
  });
}

export async function deliverExternalUserInputNotification({
  api,
  chatId,
  currentSessionId,
  sessionId,
  text,
  consumeSuppressedInput,
}: DeliverExternalUserInputParams): Promise<boolean> {
  const notification = buildExternalUserInputNotification(text);
  if (!notification || currentSessionId !== sessionId) {
    return false;
  }

  if (consumeSuppressedInput(sessionId, text)) {
    return false;
  }

  await sendExternalUserInputNotification(api, chatId, notification);
  return true;
}
