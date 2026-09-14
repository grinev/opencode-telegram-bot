import type { Api, RawApi } from "grammy";
import {
  buildExternalUserInputNotification,
  type ConsumeSuppressedInput,
  type ExternalUserInputNotification,
} from "../../app/services/external-user-input-service.js";
import { sendBotText } from "./telegram-text.js";

type SendMessageApi = Pick<Api<RawApi>, "sendMessage">;

interface DeliverExternalUserInputParams {
  api: SendMessageApi;
  chatId: number;
  currentSessionId: string | null;
  sessionId: string;
  messageId: string;
  text: string;
  consumeSuppressedInput: ConsumeSuppressedInput;
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
  messageId,
  text,
  consumeSuppressedInput,
}: DeliverExternalUserInputParams): Promise<boolean> {
  const notification = buildExternalUserInputNotification(text);
  if (!notification || currentSessionId !== sessionId) {
    return false;
  }

  if (consumeSuppressedInput(sessionId, messageId)) {
    return false;
  }

  await sendExternalUserInputNotification(api, chatId, notification);
  return true;
}
