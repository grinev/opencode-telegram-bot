import type { ToolMessageBatcher } from "../../app/formatters/tool-message-batcher.js";
import { t } from "../../i18n/index.js";

interface ThinkingMessageOptions {
  hideThinkingMessages: boolean;
}

type ThinkingBatcher = Pick<ToolMessageBatcher, "enqueue" | "sendTextNow">;

export function deliverThinkingMessage(
  sessionId: string,
  batcher: ThinkingBatcher,
  options: ThinkingMessageOptions,
): void {
  if (options.hideThinkingMessages) {
    return;
  }

  const message = t("bot.thinking");
  batcher.sendTextNow(sessionId, message, "thinking_started");
}
