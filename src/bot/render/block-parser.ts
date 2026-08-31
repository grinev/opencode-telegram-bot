import { toString } from "mdast-util-to-string";
import type {
  Blockquote,
  Code,
  Heading,
  List,
  ListItem,
  Paragraph,
  PhrasingContent,
  Root,
  RootContent,
  Table,
  TableCell,
} from "mdast";
import { unified } from "unified";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { extractInlinePlainText as extractInlineNodeText } from "./block-plain-text.js";
import { normalizeMarkdownForTelegramBlockParsing } from "./markdown-normalizer.js";
import type {
  InlineNode,
  TableColumnAlign,
  TelegramBlock,
  TelegramListItem,
} from "./types.js";

const markdownProcessor = unified().use(remarkParse).use(remarkGfm);

/** Rich messages allow 16 nesting levels; deeper quotes and lists degrade to plain text. */
const MAX_NESTING_DEPTH = 6;

function pushTextNode(nodes: InlineNode[], text: string): void {
  if (!text) {
    return;
  }

  const previous = nodes.at(-1);
  if (previous?.type === "text") {
    previous.text += text;
    return;
  }

  nodes.push({ type: "text", text });
}

function prefixLines(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function createPlainBlock(text: string): TelegramBlock[] {
  const normalized = text.trim();
  if (!normalized) {
    return [];
  }

  return [{ type: "plain", text: normalized }];
}

function extractInlinePlainText(nodes: PhrasingContent[]): string {
  let result = "";

  for (const node of nodes) {
    switch (node.type) {
      case "text":
        result += node.value;
        break;
      case "strong":
      case "emphasis":
      case "delete":
      case "link":
        result += extractInlinePlainText(node.children);
        break;
      case "inlineCode":
        result += node.value;
        break;
      case "break":
        result += "\n";
        break;
      case "image":
        result += node.alt ?? "";
        break;
      case "imageReference":
        result += node.alt ?? "";
        break;
      case "linkReference":
        result += extractInlinePlainText(node.children);
        break;
      case "html":
        result += node.value;
        break;
      case "footnoteReference":
        result += `[^${node.identifier}]`;
        break;
      default:
        result += toString(node);
        break;
    }
  }

  return result;
}

function extractTableCellPlainText(cell: TableCell): string {
  return extractInlinePlainText(cell.children);
}

function extractListItemPlainText(item: ListItem, index: number, ordered: boolean): string {
  const prefix = item.checked === true ? "✅ " : item.checked === false ? "🔲 " : "";
  const marker = ordered ? `${index + 1}. ` : "- ";
  const body = item.children.map(extractBlockPlainText).filter(Boolean).join("\n");

  return `${marker}${prefix}${body}`.trimEnd();
}

function extractBlockPlainText(node: RootContent | ListItem): string {
  switch (node.type) {
    case "paragraph":
    case "heading":
      return extractInlinePlainText(node.children);
    case "blockquote":
      return node.children
        .map(extractBlockPlainText)
        .filter(Boolean)
        .map((text) => prefixLines(text, "> "))
        .join("\n");
    case "list":
      return node.children
        .map((item, index) => extractListItemPlainText(item, index, Boolean(node.ordered)))
        .filter(Boolean)
        .join("\n");
    case "listItem":
      return node.children.map(extractBlockPlainText).filter(Boolean).join("\n");
    case "code":
      return node.value;
    case "table":
      return node.children
        .map((row) => row.children.map(extractTableCellPlainText).join(" | "))
        .join("\n");
    case "thematicBreak":
      return "──────────";
    case "html":
      return node.value;
    default:
      return toString(node);
  }
}

type InlineHtmlWrapper = Exclude<InlineNode["type"], "text" | "link">;

/**
 * Inline HTML tags Telegram can express, mapped to the node that carries them.
 * A tag outside this table stays visible as written: the markup may carry
 * meaning of its own, and dropping it would hide that from the reader.
 */
const INLINE_HTML_WRAPPERS = new Map<string, InlineHtmlWrapper>([
  ["b", "bold"],
  ["strong", "bold"],
  ["i", "italic"],
  ["em", "italic"],
  ["s", "strike"],
  ["del", "strike"],
  ["strike", "strike"],
  ["u", "underline"],
  ["ins", "underline"],
  ["tg-spoiler", "spoiler"],
  ["sub", "subscript"],
  ["sup", "superscript"],
  ["mark", "marked"],
  // Telegram has no keyboard tag; monowidth is the closest thing it draws.
  ["kbd", "code"],
  ["code", "code"],
]);

const INLINE_HTML_TAG_PATTERN = /^<(\/?)([a-z][a-z0-9-]*)(?:\s[^>]*?)?\/?>$/i;

/** Telegram's rich markdown marks text with `==`; remark leaves it in the text. */
const MARKED_TEXT_PATTERN = /==(?=\S)([\s\S]*?\S)==/g;

function parseInlineHtmlTag(value: string): { name: string; closing: boolean } | null {
  const match = INLINE_HTML_TAG_PATTERN.exec(value.trim());
  const name = match?.[2];
  if (!name) {
    return null;
  }
  return { name: name.toLowerCase(), closing: match[1] === "/" };
}

/** An opened tag and the nodes it collects until its closing tag arrives. */
interface InlineHtmlFrame {
  name: string;
  wrapper: InlineHtmlWrapper;
  /** The tag as written, shown verbatim when it turns out never to close. */
  raw: string;
  nodes: InlineNode[];
}

function closeInlineHtmlFrame(frame: InlineHtmlFrame, closed: boolean): InlineNode[] {
  if (!closed) {
    return [{ type: "text", text: frame.raw }, ...frame.nodes];
  }

  return frame.wrapper === "code"
    ? [{ type: "code", text: extractInlineNodeText(frame.nodes) }]
    : [{ type: frame.wrapper, children: frame.nodes }];
}

/** Appends parsed nodes, merging text across the seam so runs stay in one node. */
function pushInlineNodes(target: InlineNode[], nodes: InlineNode[]): void {
  for (const node of nodes) {
    if (node.type === "text") {
      pushTextNode(target, node.text);
      continue;
    }

    target.push(node);
  }
}

function pushTextValue(nodes: InlineNode[], value: string): void {
  let lastIndex = 0;

  for (const match of value.matchAll(MARKED_TEXT_PATTERN)) {
    pushTextNode(nodes, value.slice(lastIndex, match.index));
    nodes.push({ type: "marked", children: [{ type: "text", text: match[1] ?? "" }] });
    lastIndex = match.index + match[0].length;
  }

  pushTextNode(nodes, value.slice(lastIndex));
}

function parseInlineNodes(nodes: PhrasingContent[]): InlineNode[] | null {
  const result: InlineNode[] = [];
  /** Tags opened but not yet closed; the innermost one collects what follows. */
  const open: InlineHtmlFrame[] = [];
  const target = (): InlineNode[] => open.at(-1)?.nodes ?? result;

  for (const node of nodes) {
    switch (node.type) {
      case "text":
        pushTextValue(target(), node.value);
        break;
      case "strong": {
        const children = parseInlineNodes(node.children);
        if (!children) {
          return null;
        }

        target().push({ type: "bold", children });
        break;
      }
      case "emphasis": {
        const children = parseInlineNodes(node.children);
        if (!children) {
          return null;
        }

        target().push({ type: "italic", children });
        break;
      }
      case "delete": {
        const children = parseInlineNodes(node.children);
        if (!children) {
          return null;
        }

        target().push({ type: "strike", children });
        break;
      }
      case "inlineCode":
        target().push({ type: "code", text: node.value });
        break;
      case "link": {
        const children = parseInlineNodes(node.children);
        if (!children) {
          return null;
        }

        target().push({ type: "link", text: children, url: node.url });
        break;
      }
      case "break":
        pushTextNode(target(), "\n");
        break;
      case "html": {
        const tag = parseInlineHtmlTag(node.value);
        if (!tag) {
          return null;
        }

        if (tag.name === "br") {
          pushTextNode(target(), "\n");
          break;
        }

        if (!tag.closing) {
          const wrapper = INLINE_HTML_WRAPPERS.get(tag.name);
          if (wrapper) {
            open.push({ name: tag.name, wrapper, raw: node.value, nodes: [] });
          } else {
            pushTextNode(target(), node.value);
          }

          break;
        }

        const index = open.map((frame) => frame.name).lastIndexOf(tag.name);
        if (index === -1) {
          pushTextNode(target(), node.value);
          break;
        }

        // Tags opened inside the one being closed never closed themselves:
        // they keep their markup visible along with their content.
        while (open.length > index) {
          const frame = open.pop();
          if (!frame) {
            break;
          }
          pushInlineNodes(target(), closeInlineHtmlFrame(frame, open.length === index));
        }

        break;
      }
      default:
        return null;
    }
  }

  while (open.length > 0) {
    const frame = open.pop();
    if (!frame) {
      break;
    }
    pushInlineNodes(target(), closeInlineHtmlFrame(frame, false));
  }

  return result;
}

function parseParagraphBlock(node: Paragraph): TelegramBlock[] {
  const inlines = parseInlineNodes(node.children);
  if (!inlines) {
    return createPlainBlock(extractBlockPlainText(node));
  }

  return [{ type: "paragraph", inlines }];
}

function parseHeadingBlock(node: Heading): TelegramBlock[] {
  const inlines = parseInlineNodes(node.children);
  if (!inlines) {
    return createPlainBlock(extractBlockPlainText(node));
  }

  return [
    {
      type: "heading",
      level: Math.min(6, Math.max(1, Math.floor(node.depth))),
      inlines,
    },
  ];
}

function parseBlockquoteBlock(node: Blockquote, depth: number): TelegramBlock[] {
  if (depth >= MAX_NESTING_DEPTH) {
    return createPlainBlock(extractBlockPlainText(node));
  }

  const blocks = node.children.flatMap((child) => parseRootContent(child, depth + 1));
  if (blocks.length === 0) {
    return [];
  }

  return [{ type: "blockquote", blocks }];
}

function parseListItem(item: ListItem, depth: number): TelegramListItem {
  return {
    blocks: item.children.flatMap((child) => parseRootContent(child, depth)),
    ...(typeof item.checked === "boolean" ? { checked: item.checked } : {}),
  };
}

function parseListBlock(node: List, depth: number): TelegramBlock[] {
  if (depth >= MAX_NESTING_DEPTH) {
    return createPlainBlock(extractBlockPlainText(node));
  }

  const items = node.children.map((item) => parseListItem(item, depth + 1));
  if (items.length === 0) {
    return [];
  }

  return [{ type: "list", ordered: Boolean(node.ordered), items }];
}

function parseCodeBlock(node: Code): TelegramBlock[] {
  return [{ type: "code", language: node.lang ?? undefined, text: node.value }];
}

/** Markdown declares column alignment in the delimiter row; unset columns stay left. */
function parseColumnAlign(align: Table["align"]): TableColumnAlign[] | undefined {
  if (!align || align.every((value) => value === null)) {
    return undefined;
  }

  return align.map((value) => value ?? "left");
}

function parseTableBlock(node: Table): TelegramBlock[] {
  const rows = node.children.map((row) => row.children.map(extractTableCellPlainText));
  if (rows.length === 0) {
    return [];
  }

  const align = parseColumnAlign(node.align);
  return [{ type: "table", rows, ...(align ? { align } : {}) }];
}

function parseRootContent(node: RootContent, depth = 0): TelegramBlock[] {
  switch (node.type) {
    case "paragraph":
      return parseParagraphBlock(node);
    case "heading":
      return parseHeadingBlock(node);
    case "blockquote":
      return parseBlockquoteBlock(node, depth);
    case "list":
      return parseListBlock(node, depth);
    case "code":
      return parseCodeBlock(node);
    case "table":
      return parseTableBlock(node);
    case "thematicBreak":
      return [{ type: "rule" }];
    default:
      return createPlainBlock(extractBlockPlainText(node));
  }
}

export function parseTelegramBlocks(markdown: string): TelegramBlock[] {
  const normalized = normalizeMarkdownForTelegramBlockParsing(markdown).trim();
  if (!normalized) {
    return [];
  }

  const tree = markdownProcessor.parse(normalized) as Root;
  return tree.children.flatMap((node) => parseRootContent(node));
}
