import type { Api, RawApi } from "grammy";
import { config } from "../../config.js";
import type {
  QueuedScheduledTaskDelivery,
} from "../../app/types/scheduled-task.js";
import type { ScheduledTaskDeliverySender } from "../../app/services/scheduled-task-runtime-service.js";
import { formatSummaryWithMode } from "./summary-message-formatter.js";
import { escapePlainTextForTelegramMarkdownV2 } from "../../utils/telegram-markdown.js";
import { AGENT_TEXT_LINK_PREVIEW_OPTIONS, sendBotText } from "./telegram-text.js";

type SendMessageApi = Pick<Api<RawApi>, "sendMessage">;

const TELEGRAM_MESSAGE_LIMIT = 4096;

interface ScheduledTaskMessagePart {
  text: string;
  /** Parts carrying the agent's reply keep Telegram's link preview. */
  carriesResult: boolean;
}

function getScheduledTaskDeliveryFormat(): "raw" | "markdown_v2" {
  return config.bot.messageFormatMode === "markdown" ? "markdown_v2" : "raw";
}

function getSilentDeliveryOptions(): { options: { disable_notification: true } } | Record<string, never> {
  return config.bot.scheduledTaskNotificationsSilent
    ? { options: { disable_notification: true } }
    : {};
}

function toResultParts(texts: string[]): ScheduledTaskMessagePart[] {
  return texts.map((text) => ({ text, carriesResult: true }));
}

function buildScheduledTaskSuccessMessageParts(
  delivery: QueuedScheduledTaskDelivery,
): ScheduledTaskMessagePart[] {
  if (!delivery.resultText) {
    return [{ text: delivery.notificationText, carriesResult: false }];
  }

  if (config.bot.messageFormatMode !== "markdown") {
    return toResultParts(
      formatSummaryWithMode(
        `${delivery.notificationText}\n\n${delivery.resultText}`,
        config.bot.messageFormatMode,
      ),
    );
  }

  const header = escapePlainTextForTelegramMarkdownV2(delivery.notificationText);
  const resultParts = formatSummaryWithMode(delivery.resultText, config.bot.messageFormatMode);
  if (resultParts.length === 0) {
    return [{ text: header, carriesResult: false }];
  }

  const firstPart = `${header}\n\n${resultParts[0]}`;
  if (firstPart.length <= TELEGRAM_MESSAGE_LIMIT) {
    return toResultParts([firstPart, ...resultParts.slice(1)]);
  }

  return [{ text: header, carriesResult: false }, ...toResultParts(resultParts)];
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
          : [{ text: delivery.notificationText, carriesResult: false }];
      const format = delivery.status === "success" ? getScheduledTaskDeliveryFormat() : "raw";
      const suppressResultNotification = delivery.status === "success" && Boolean(delivery.footerText);
      const resultDeliveryOptions =
        suppressResultNotification && !config.bot.scheduledTaskNotificationsSilent
          ? { options: { disable_notification: true } }
          : getSilentDeliveryOptions();

      const partOptions =
        "options" in resultDeliveryOptions ? resultDeliveryOptions.options : undefined;

      for (const part of messageParts) {
        await sendBotText({
          api,
          chatId,
          text: part.text,
          format,
          options: part.carriesResult
            ? { ...partOptions, ...AGENT_TEXT_LINK_PREVIEW_OPTIONS }
            : partOptions,
        });
      }

      if (delivery.status === "success" && delivery.footerText) {
        await sendBotText({
          api,
          chatId,
          text: delivery.footerText,
          format: "raw",
          ...getSilentDeliveryOptions(),
        });
      }

      return true;
    },
  };
}
