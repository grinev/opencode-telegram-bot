import type { MessageEntity } from "grammy/types";

import { t } from "../../i18n/index.js";
import { PLAIN_MAX_PART_CHARS } from "../render/limits.js";
import { splitTextIntoChunks } from "../render/text-splitter.js";
import type { TelegramRenderedPart } from "../render/types.js";
import type { StreamingMessagePayload } from "../streaming/response-streamer.js";

export interface ThinkingSection {
  id: string;
  title?: string | undefined;
  text: string;
}

interface ThinkingPayloadOptions {
  /**
   * Final render: the reasoning is complete, so the quote is collapsed. While
   * the model is still thinking the quote stays open so the text is readable.
   */
  final?: boolean;
}

function formatHeader(title?: string): string {
  const fallback = t("bot.thinking");
  const normalizedTitle = title?.trim();
  return normalizedTitle ? `${fallback} — ${normalizedTitle}` : fallback;
}

/**
 * Reasoning is delivered as a plain text message with a quote entity: rich
 * blocks have no collapsed quotation, only the `details` disclosure widget.
 */
function createThinkingPart(
  header: string,
  text: string,
  collapsed: boolean,
): TelegramRenderedPart {
  if (!text) {
    return { blocks: [], fallbackText: header, source: "plain" };
  }

  const entity: MessageEntity = {
    type: collapsed ? "expandable_blockquote" : "blockquote",
    offset: header.length + 1,
    length: text.length,
  };

  return {
    blocks: [],
    fallbackText: `${header}\n${text}`,
    source: "plain",
    entities: [entity],
  };
}

export function prepareThinkingPayload(
  sections: ThinkingSection[],
  options: ThinkingPayloadOptions = {},
): StreamingMessagePayload | null {
  const collapsed = options.final ?? false;
  const parts: TelegramRenderedPart[] = [];

  for (const section of sections) {
    const header = formatHeader(section.title);
    const text = section.text.replace(/\r\n/g, "\n").trimEnd();
    const textLimit = Math.max(1, PLAIN_MAX_PART_CHARS - header.length - 1);
    const chunks = text ? splitTextIntoChunks(text, textLimit) : [""];

    for (const chunk of chunks) {
      parts.push(createThinkingPart(header, chunk, collapsed));
    }
  }

  return parts.length > 0 ? { parts } : null;
}
