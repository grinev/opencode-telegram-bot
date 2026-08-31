import type { InputRichMessageWithoutUpload, MessageEntity } from "grammy/types";

/**
 * A rich block that carries no file upload. The bot never attaches media to
 * assistant output, and drafts only accept the upload-free variant, so this is
 * the block type used across the render layer.
 */
export type TelegramRichBlock = NonNullable<InputRichMessageWithoutUpload["blocks"]>[number];

/**
 * A message ready to be delivered to Telegram.
 *
 * `blocks` carries the native rich representation; `fallbackText` is the plain
 * projection of the same content, used when the native send fails. A part with
 * `source: "plain"` has no blocks and its `fallbackText` already fits a text
 * message.
 */
export interface TelegramRenderedPart {
  blocks: TelegramRichBlock[];
  fallbackText: string;
  source: "blocks" | "plain";
  /**
   * Entities for the plain representation. Reasoning is delivered as a text
   * message with a collapsed quote, which rich blocks cannot express; ignored
   * for parts that carry blocks.
   */
  entities?: MessageEntity[] | undefined;
}

/** A single parsed block paired with its plain-text projection. */
export interface TelegramRenderedBlock {
  block: TelegramRichBlock;
  plainText: string;
}

/** Column alignment of a markdown table, as declared in its delimiter row. */
export type TableColumnAlign = "left" | "center" | "right";

/**
 * One entry of a list. The content is a block list so that nested lists, code
 * and quotes inside an item survive; `checked` is set only for task items.
 */
export interface TelegramListItem {
  blocks: TelegramBlock[];
  checked?: boolean;
}

export type TelegramBlock =
  | { type: "paragraph"; inlines: InlineNode[] }
  | { type: "heading"; level: number; inlines: InlineNode[] }
  | { type: "blockquote"; blocks: TelegramBlock[] }
  /** `start` continues the numbering when a list is written out in pieces. */
  | { type: "list"; ordered: boolean; items: TelegramListItem[]; start?: number }
  | { type: "code"; language?: string | undefined; text: string }
  | { type: "table"; rows: string[][]; align?: TableColumnAlign[] }
  | { type: "rule" }
  | { type: "plain"; text: string };

export type InlineNode =
  | { type: "text"; text: string }
  | { type: "bold"; children: InlineNode[] }
  | { type: "italic"; children: InlineNode[] }
  | { type: "strike"; children: InlineNode[] }
  | { type: "underline"; children: InlineNode[] }
  | { type: "spoiler"; children: InlineNode[] }
  | { type: "subscript"; children: InlineNode[] }
  | { type: "superscript"; children: InlineNode[] }
  | { type: "marked"; children: InlineNode[] }
  | { type: "code"; text: string }
  | { type: "link"; text: InlineNode[]; url: string };
