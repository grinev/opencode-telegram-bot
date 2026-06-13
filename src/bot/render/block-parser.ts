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
import { normalizeMarkdownForTelegramBlockParsing } from "./markdown-normalizer.js";
import type { InlineNode, TelegramBlock } from "./types.js";

const markdownProcessor = unified().use(remarkParse).use(remarkGfm);

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

function appendInlineNodes(target: InlineNode[], additions: InlineNode[]): void {
  for (const node of additions) {
    if (node.type === "text") {
      pushTextNode(target, node.text);
      continue;
    }

    target.push(node);
  }
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

function parseInlineNodes(nodes: PhrasingContent[]): InlineNode[] | null {
  const result: InlineNode[] = [];

  for (const node of nodes) {
    switch (node.type) {
      case "text":
        pushTextNode(result, node.value);
        break;
      case "strong": {
        const children = parseInlineNodes(node.children);
        if (!children) {
          return null;
        }

        result.push({ type: "bold", children });
        break;
      }
      case "emphasis": {
        const children = parseInlineNodes(node.children);
        if (!children) {
          return null;
        }

        result.push({ type: "italic", children });
        break;
      }
      case "delete": {
        const children = parseInlineNodes(node.children);
        if (!children) {
          return null;
        }

        result.push({ type: "strike", children });
        break;
      }
      case "inlineCode":
        result.push({ type: "code", text: node.value });
        break;
      case "link": {
        const children = parseInlineNodes(node.children);
        if (!children) {
          return null;
        }

        result.push({ type: "link", text: children, url: node.url });
        break;
      }
      case "break":
        pushTextNode(result, "\n");
        break;
      default:
        return null;
    }
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

function parseBlockquoteBlock(node: Blockquote): TelegramBlock[] {
  const lines: InlineNode[][] = [];

  for (const child of node.children) {
    if (child.type !== "paragraph" && child.type !== "heading") {
      return createPlainBlock(extractBlockPlainText(node));
    }

    const inlines = parseInlineNodes(child.children);
    if (!inlines) {
      return createPlainBlock(extractBlockPlainText(node));
    }

    lines.push(inlines);
  }

  if (lines.length === 0) {
    return [];
  }

  return [{ type: "blockquote", lines }];
}

function parseListItemInlines(item: ListItem): InlineNode[] | null {
  const result: InlineNode[] = [];
  const taskPrefix = item.checked === true ? "✅ " : item.checked === false ? "🔲 " : "";
  if (taskPrefix) {
    pushTextNode(result, taskPrefix);
  }

  for (let index = 0; index < item.children.length; index++) {
    const child = item.children[index];
    if (child.type !== "paragraph") {
      return null;
    }

    const inlines = parseInlineNodes(child.children);
    if (!inlines) {
      return null;
    }

    if (index > 0) {
      pushTextNode(result, "\n");
    }

    appendInlineNodes(result, inlines);
  }

  return result;
}

function parseListBlock(node: List): TelegramBlock[] {
  const items: InlineNode[][] = [];

  for (const item of node.children) {
    const parsedItem = parseListItemInlines(item);
    if (!parsedItem) {
      return createPlainBlock(extractBlockPlainText(node));
    }

    items.push(parsedItem);
  }

  if (items.length === 0) {
    return [];
  }

  return [{ type: "list", ordered: Boolean(node.ordered), items }];
}

function parseCodeBlock(node: Code): TelegramBlock[] {
  return [{ type: "code", language: node.lang ?? undefined, text: node.value }];
}

function parseTableBlock(node: Table): TelegramBlock[] {
  const rows = node.children.map((row) => row.children.map(extractTableCellPlainText));
  if (rows.length === 0) {
    return [];
  }

  return [{ type: "table", rows }];
}

function parseRootContent(node: RootContent): TelegramBlock[] {
  switch (node.type) {
    case "paragraph":
      return parseParagraphBlock(node);
    case "heading":
      return parseHeadingBlock(node);
    case "blockquote":
      return parseBlockquoteBlock(node);
    case "list":
      return parseListBlock(node);
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

function mergeAdjacentBlocks(blocks: TelegramBlock[]): TelegramBlock[] {
  const merged: TelegramBlock[] = [];

  for (const block of blocks) {
    const previous = merged.at(-1);
    if (previous?.type === "blockquote" && block.type === "blockquote") {
      previous.lines.push(...block.lines);
      continue;
    }

    merged.push(block);
  }

  return merged;
}

export function parseTelegramBlocks(markdown: string): TelegramBlock[] {
  const normalized = normalizeMarkdownForTelegramBlockParsing(markdown).trim();
  if (!normalized) {
    return [];
  }

  const tree = markdownProcessor.parse(normalized) as Root;
  return mergeAdjacentBlocks(tree.children.flatMap(parseRootContent));
}
