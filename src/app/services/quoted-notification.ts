import { escapePlainTextForTelegramMarkdownV2 } from "../../utils/telegram-markdown.js";

export interface QuotedNotification {
  text: string;
  rawFallbackText: string;
}

function buildQuotedPlainText(text: string): string {
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? `> ${line}` : ">"))
    .join("\n");
}

function buildQuotedMarkdownText(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      line.length > 0 ? `> ${escapePlainTextForTelegramMarkdownV2(line)}` : ">",
    )
    .join("\n");
}

export function buildQuotedNotification(
  title: string,
  body: string,
  options?: { blankLineAfterTitle?: boolean },
): QuotedNotification {
  const separator = options?.blankLineAfterTitle === false ? "\n" : "\n\n";
  return {
    text: `${escapePlainTextForTelegramMarkdownV2(title)}${separator}${buildQuotedMarkdownText(body)}`,
    rawFallbackText: `${title}${separator}${buildQuotedPlainText(body)}`,
  };
}
