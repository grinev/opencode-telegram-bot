import type { Api, RawApi } from "grammy";
import { config } from "../../config.js";
import type {
  QueuedScheduledTaskDelivery,
} from "../../app/types/scheduled-task.js";
import type { ScheduledTaskDeliverySender } from "../../app/services/scheduled-task-runtime-service.js";
import {
  escapePlainTextForTelegramMarkdownV2,
  formatSummaryWithMode,
} from "./summary-message-formatter.js";
import { sendBotText } from "./telegram-text.js";

type SendMessageApi = Pick<Api<RawApi>, "sendMessage">;

const TELEGRAM_MESSAGE_LIMIT = 4096;

function getScheduledTaskDeliveryFormat(): "raw" | "markdown_v2" {
  return config.bot.messageFormatMode === "markdown" ? "markdown_v2" : "raw";
}

function buildScheduledTaskSuccessMessageParts(delivery: QueuedScheduledTaskDelivery): string[] {
  if (!delivery.resultText) {
    return [delivery.notificationText];
  }

  if (config.bot.messageFormatMode !== "markdown") {
    return formatSummaryWithMode(
      `${delivery.notificationText}\n\n${delivery.resultText}`,
      config.bot.messageFormatMode,
    );
  }

  const header = escapePlainTextForTelegramMarkdownV2(delivery.notificationText);
  const resultParts = formatSummaryWithMode(delivery.resultText, config.bot.messageFormatMode);
  if (resultParts.length === 0) {
    return [header];
  }

  const firstPart = `${header}\n\n${resultParts[0]}`;
  if (firstPart.length <= TELEGRAM_MESSAGE_LIMIT) {
    return [firstPart, ...resultParts.slice(1)];
  }

  return [header, ...resultParts];
}

export function createScheduledTaskDeliverySender(
  api: SendMessageApi,
  chatId: number,
): ScheduledTaskDeliverySender {
  return {
    async send(delivery) {
      const messageParts =
        delivery.status === "success"
          ? buildScheduledTaskSuccessMessageParts(delivery)
          : [delivery.notificationText];
      const format = delivery.status === "success" ? getScheduledTaskDeliveryFormat() : "raw";
      const suppressResultNotification = delivery.status === "success" && Boolean(delivery.footerText);

      for (const part of messageParts) {
        await sendBotText({
          api,
          chatId,
          text: part,
          format,
          ...(suppressResultNotification ? { options: { disable_notification: true } } : {}),
        });
      }

      if (delivery.status === "success" && delivery.footerText) {
        await sendBotText({
          api,
          chatId,
          text: delivery.footerText,
          format: "raw",
        });
      }

      return true;
    },
  };
}
