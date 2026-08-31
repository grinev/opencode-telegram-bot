import type { RichBlockTableCell, RichText } from "grammy/types";
import { buildAlignedTableText, toBlockPlainText } from "./block-plain-text.js";
import type {
  InlineNode,
  TableColumnAlign,
  TelegramBlock,
  TelegramListItem,
  TelegramRichBlock,
} from "./types.js";

/** Telegram rejects rich tables wider than this; such tables fall back to preformatted text. */
const RICH_TABLE_MAX_COLUMNS = 20;

function toRichTextNodes(nodes: InlineNode[]): RichText[] {
  const result: RichText[] = [];

  for (const node of nodes) {
    switch (node.type) {
      case "text":
        if (node.text) {
          result.push(node.text);
        }
        break;
      case "bold":
        result.push({ type: "bold", text: toRichText(node.children) });
        break;
      case "italic":
        result.push({ type: "italic", text: toRichText(node.children) });
        break;
      case "strike":
        result.push({ type: "strikethrough", text: toRichText(node.children) });
        break;
      case "underline":
        result.push({ type: "underline", text: toRichText(node.children) });
        break;
      case "spoiler":
        result.push({ type: "spoiler", text: toRichText(node.children) });
        break;
      case "subscript":
        result.push({ type: "subscript", text: toRichText(node.children) });
        break;
      case "superscript":
        result.push({ type: "superscript", text: toRichText(node.children) });
        break;
      case "marked":
        result.push({ type: "marked", text: toRichText(node.children) });
        break;
      case "code":
        result.push({ type: "code", text: node.text });
        break;
      case "link":
        result.push({ type: "url", text: toRichText(node.text), url: node.url });
        break;
      default: {
        const exhaustiveCheck: never = node;
        throw new Error(`Unsupported inline node: ${JSON.stringify(exhaustiveCheck)}`);
      }
    }
  }

  return result;
}

export function toRichText(nodes: InlineNode[]): RichText {
  const parts = toRichTextNodes(nodes);
  if (parts.length === 0) {
    return "";
  }

  if (parts.length === 1) {
    return parts[0] ?? "";
  }
  return parts;
}

function taskMarker(checked: boolean | undefined): string {
  if (checked === undefined) {
    return "";
  }

  return checked ? "✅ " : "🔲 ";
}

/**
 * Inline content of an item, for the text form of a list. Only a leading
 * paragraph keeps its formatting; anything else an item holds (a nested list,
 * code, a quote) is appended as indented plain text.
 */
function toTextItemNodes(item: TelegramListItem, indent: string): RichText[] {
  const [first, ...rest] = item.blocks;
  const leadingInlines = first?.type === "paragraph" ? first.inlines : [];
  const trailingBlocks = first?.type === "paragraph" ? rest : item.blocks;

  const nodes: RichText[] = [...toRichTextNodes(leadingInlines)];

  for (const block of trailingBlocks) {
    const text = toBlockPlainText(block);
    if (!text) {
      continue;
    }

    nodes.push(
      `\n${text
        .split("\n")
        .map((line) => `${indent}${line}`)
        .join("\n")}`,
    );
  }

  return nodes;
}

/**
 * Lists Telegram cannot render the way the product needs, so they are written
 * out as text: ordered lists because the native one is numbered from zero in
 * Telegram Web, task lists because the native checkbox is not drawn at all and
 * the item state would be lost. Both are client behaviour the API cannot fix —
 * see the plan's Risks section.
 */
export function isTextRenderedList(block: Extract<TelegramBlock, { type: "list" }>): boolean {
  return block.ordered || block.items.some((item) => item.checked !== undefined);
}

/** The `N. `, `✅ ` or `• ` an item is written out with. */
export function textListMarker(
  item: TelegramListItem,
  index: number,
  ordered: boolean,
  start = 1,
): string {
  const task = taskMarker(item.checked);
  if (ordered) {
    return `${start + index}. ${task}`;
  }

  return task || "• ";
}

function toTextListBlock(
  items: TelegramListItem[],
  ordered: boolean,
  start: number,
): TelegramRichBlock {
  const text = items.flatMap((item, index) => {
    const marker = textListMarker(item, index, ordered, start);
    return [
      index === 0 ? marker : `\n${marker}`,
      ...toTextItemNodes(item, " ".repeat(marker.length)),
    ];
  });

  return { type: "paragraph", text };
}

/**
 * A sub-list that is itself written out as text has nothing native to be lifted
 * into: on its own it would start flush left, indistinguishable from its parent.
 * It stays inside the item instead, where it is written out indented — but only
 * while it holds nothing but text, because staying means being flattened, and a
 * code block or a bullet list deeper inside would lose its native form with it.
 */
function staysInsideItem(block: TelegramBlock): boolean {
  if (block.type !== "list" || !isTextRenderedList(block)) {
    return false;
  }

  return block.items.every((item) =>
    item.blocks.every((inner) => inner.type === "paragraph" || staysInsideItem(inner)),
  );
}

/**
 * A list written out as text cannot hold native content, so what an item carries
 * beyond its leading paragraph is lifted out and placed right after the piece it
 * belonged to, where it renders natively. Numbering runs across the pieces, so a
 * sub-list under item 2 does not restart the count at item 3.
 */
export function liftTextListContent(blocks: TelegramBlock[]): TelegramBlock[] {
  return blocks.flatMap((block) => {
    if (block.type !== "list" || !isTextRenderedList(block)) {
      return [block];
    }

    const result: TelegramBlock[] = [];
    let pieceItems: TelegramListItem[] = [];
    let start = block.start ?? 1;

    const flushPiece = (): void => {
      if (pieceItems.length === 0) {
        return;
      }

      result.push({ type: "list", ordered: block.ordered, items: pieceItems, start });
      start += pieceItems.length;
      pieceItems = [];
    };

    for (const item of block.items) {
      const [first, ...rest] = item.blocks;
      const leading = first?.type === "paragraph" ? [first] : [];
      const trailing = first?.type === "paragraph" ? rest : item.blocks;
      // Lifting starts at the first block that has a native form; keeping the
      // split at one point preserves the order the item was written in.
      const liftFrom = trailing.findIndex((inner) => !staysInsideItem(inner));
      const lifted = liftFrom === -1 ? [] : trailing.slice(liftFrom);

      pieceItems.push({
        ...item,
        blocks: [...leading, ...(liftFrom === -1 ? trailing : trailing.slice(0, liftFrom))],
      });
      if (lifted.length > 0) {
        flushPiece();
        result.push(...liftTextListContent(lifted));
      }
    }

    flushPiece();
    return result;
  });
}

function toTableCells(rows: string[][], align?: TableColumnAlign[]): RichBlockTableCell[][] {
  const columnCount = Math.max(...rows.map((row) => row.length));

  return rows.map((row, rowIndex) =>
    Array.from({ length: columnCount }, (_, columnIndex) => ({
      text: row[columnIndex] ?? "",
      ...(rowIndex === 0 ? { is_header: true as const } : {}),
      align: align?.[columnIndex] ?? ("left" as const),
      valign: "top" as const,
    })),
  );
}

function toTableBlock(rows: string[][], align?: TableColumnAlign[]): TelegramRichBlock {
  const columnCount = Math.max(...rows.map((row) => row.length));
  if (columnCount > RICH_TABLE_MAX_COLUMNS) {
    return { type: "pre", text: buildAlignedTableText(rows) };
  }

  return { type: "table", cells: toTableCells(rows, align), is_bordered: true };
}

export function toRichBlock(block: TelegramBlock): TelegramRichBlock {
  switch (block.type) {
    case "paragraph":
      return { type: "paragraph", text: toRichText(block.inlines) };
    case "heading":
      return {
        type: "heading",
        text: toRichText(block.inlines),
        size: Math.min(6, Math.max(1, Math.floor(block.level))) as 1 | 2 | 3 | 4 | 5 | 6,
      };
    case "blockquote":
      return { type: "blockquote", blocks: block.blocks.map(toRichBlock) };
    case "list":
      return isTextRenderedList(block)
        ? toTextListBlock(block.items, block.ordered, block.start ?? 1)
        : {
            type: "list",
            items: block.items.map((item) => ({ blocks: item.blocks.map(toRichBlock) })),
          };
    case "code":
      return { type: "pre", text: block.text, ...(block.language ? { language: block.language } : {}) };
    case "table":
      return block.rows.length > 0
        ? toTableBlock(block.rows, block.align)
        : { type: "paragraph", text: "" };
    case "rule":
      return { type: "divider" };
    case "plain":
      return { type: "paragraph", text: block.text };
    default: {
      const exhaustiveCheck: never = block;
      throw new Error(`Unsupported Telegram block: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

export function createParagraphBlock(text: string): TelegramRichBlock {
  return { type: "paragraph", text };
}

function countRichTextChars(text: RichText): number {
  if (typeof text === "string") {
    return text.length;
  }

  if (Array.isArray(text)) {
    return text.reduce((total, node) => total + countRichTextChars(node), 0);
  }

  switch (text.type) {
    case "bold":
    case "italic":
    case "underline":
    case "strikethrough":
    case "spoiler":
    case "subscript":
    case "superscript":
    case "marked":
    case "code":
    case "date_time":
    case "text_mention":
    case "url":
    case "email_address":
    case "phone_number":
    case "bank_card_number":
    case "mention":
    case "hashtag":
    case "cashtag":
    case "bot_command":
    case "anchor_link":
    case "reference":
    case "reference_link":
      return countRichTextChars(text.text);
    case "custom_emoji":
      return text.alternative_text.length;
    case "mathematical_expression":
      return text.expression.length;
    case "anchor":
      return text.name.length;
    default:
      return 0;
  }
}

/**
 * Number of blocks Telegram counts towards the per-message block limit.
 * Nested blocks, list items, table rows, and details bodies all count.
 */
export function countRichBlocks(block: TelegramRichBlock): number {
  switch (block.type) {
    case "list":
      return (
        1 +
        block.items.reduce(
          (total, item) => total + 1 + item.blocks.reduce((sum, b) => sum + countRichBlocks(b), 0),
          0,
        )
      );
    case "table":
      return 1 + block.cells.length;
    case "blockquote":
    case "details":
      return 1 + block.blocks.reduce((total, inner) => total + countRichBlocks(inner), 0);
    default:
      return 1;
  }
}

/** Upper bound of the characters a block contributes to the per-message character limit. */
export function countRichChars(block: TelegramRichBlock): number {
  switch (block.type) {
    case "paragraph":
    case "heading":
    case "footer":
    case "pullquote":
      return countRichTextChars(block.text);
    case "pre":
      return countRichTextChars(block.text);
    case "list":
      return block.items.reduce(
        (total, item) => total + item.blocks.reduce((sum, b) => sum + countRichChars(b), 0),
        0,
      );
    case "table":
      return block.cells.reduce(
        (total, row) =>
          total + row.reduce((sum, cell) => sum + (cell.text ? countRichTextChars(cell.text) : 0), 0),
        0,
      );
    case "blockquote":
      return block.blocks.reduce((total, inner) => total + countRichChars(inner), 0);
    case "details":
      return (
        countRichTextChars(block.summary) +
        block.blocks.reduce((total, inner) => total + countRichChars(inner), 0)
      );
    case "mathematical_expression":
      return block.expression.length;
    default:
      return 0;
  }
}
