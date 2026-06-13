import type { MessageEntity } from "grammy/types";

export type BlockRenderMode = "full" | "simplified" | "line-by-line" | "plain";

export interface TelegramRenderedPart {
  text: string;
  entities?: MessageEntity[];
  fallbackText: string;
  source: "entities" | "plain";
}

export interface TelegramRenderedBlock {
  blockType: TelegramBlock["type"];
  mode: BlockRenderMode;
  text: string;
  entities?: MessageEntity[];
  fallbackText: string;
  source: "entities" | "plain";
}

export type TelegramBlock =
  | { type: "paragraph"; inlines: InlineNode[] }
  | { type: "heading"; level: number; inlines: InlineNode[] }
  | { type: "blockquote"; lines: InlineNode[][] }
  | { type: "list"; ordered: boolean; items: InlineNode[][] }
  | { type: "code"; language?: string; text: string }
  | { type: "table"; rows: string[][] }
  | { type: "rule" }
  | { type: "plain"; text: string };

export type InlineNode =
  | { type: "text"; text: string }
  | { type: "bold"; children: InlineNode[] }
  | { type: "italic"; children: InlineNode[] }
  | { type: "strike"; children: InlineNode[] }
  | { type: "underline"; children: InlineNode[] }
  | { type: "spoiler"; children: InlineNode[] }
  | { type: "code"; text: string }
  | { type: "link"; text: InlineNode[]; url: string };
