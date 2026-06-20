import type { MessageEntity } from "grammy/types";

import { t } from "../../i18n/index.js";
import type { TelegramRenderedPart } from "../render/types.js";
import type { StreamingMessagePayload } from "../streaming/response-streamer.js";

export interface ThinkingSection {
  id: string;
  title?: string;
  text: string;
}

function formatHeader(title?: string): string {
  const fallback = t("bot.thinking");
  const normalizedTitle = title?.trim();
  return normalizedTitle ? `${fallback} — ${normalizedTitle}` : fallback;
}

function quoteFallbackText(text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function splitText(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  for (let offset = 0; offset < text.length; offset += maxLength) {
    chunks.push(text.slice(offset, offset + maxLength));
  }
  return chunks;
}

function createThinkingPart(header: string, text: string): TelegramRenderedPart {
  if (!text) {
    return {
      text: header,
      fallbackText: header,
      source: "entities",
    };
  }

  const renderedText = `${header}\n${text}`;
  const entity: MessageEntity = {
    type: "blockquote",
    offset: header.length + 1,
    length: text.length,
  };

  return {
    text: renderedText,
    entities: [entity],
    fallbackText: `${header}\n${quoteFallbackText(text)}`,
    source: "entities",
  };
}

export function prepareThinkingStreamingPayload(
  sections: ThinkingSection[],
  maxPartLength: number,
): StreamingMessagePayload | null {
  const parts: TelegramRenderedPart[] = [];

  for (const section of sections) {
    const header = formatHeader(section.title);
    const text = section.text.replace(/\r\n/g, "\n").trimEnd();
    const textLimit = Math.max(1, maxPartLength - header.length - 1);
    const chunks = text ? splitText(text, textLimit) : [""];

    for (const chunk of chunks) {
      parts.push(createThinkingPart(header, chunk));
    }
  }

  return parts.length > 0 ? { parts } : null;
}
