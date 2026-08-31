import { parseTelegramBlocks } from "./block-parser.js";
import { normalizeMarkdownForTelegramRendering } from "./markdown-normalizer.js";
import type { InlineNode, TelegramBlock } from "./types.js";

/**
 * Escapes characters reserved in Telegram MarkdownV2.
 * These must be escaped everywhere except when used as syntactic delimiters
 * we intentionally emit (e.g. the surrounding * of bold).
 */
function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

function escapeMarkdownV2Code(text: string): string {
  return text.replace(/([`\\])/g, "\\$1");
}

function escapeMarkdownV2LinkUrl(text: string): string {
  return text.replace(/([)\\])/g, "\\$1");
}

function renderInlineNodes(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
          return escapeMarkdownV2(node.text);
        case "bold":
          return `*${renderInlineNodes(node.children)}*`;
        case "italic":
          return `_${renderInlineNodes(node.children)}_`;
        case "strike":
          return `~${renderInlineNodes(node.children)}~`;
        case "code":
          return `\`${escapeMarkdownV2Code(node.text)}\``;
        case "link":
          return `[${renderInlineNodes(node.text)}](${escapeMarkdownV2LinkUrl(node.url)})`;
        case "underline":
          return `__${renderInlineNodes(node.children)}__`;
        case "spoiler":
          return `||${renderInlineNodes(node.children)}||`;
        // MarkdownV2 has no counterpart for these, so only the content survives.
        case "subscript":
        case "superscript":
        case "marked":
          return renderInlineNodes(node.children);
        default:
          return escapeMarkdownV2(String(node));
      }
    })
    .join("");
}

function renderBlock(block: TelegramBlock): string {
  switch (block.type) {
    case "paragraph":
      return renderInlineNodes(block.inlines);
    case "heading": {
      const content = renderInlineNodes(block.inlines);
      return `*${content}*`;
    }
    case "blockquote":
      return block.blocks
        .map(renderBlock)
        .filter(Boolean)
        .map((rendered) =>
          rendered
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n"),
        )
        .join("\n");
    case "list":
      return block.items
        .map((item, index) => {
          const marker = block.ordered ? `${(block.start ?? 1) + index}\\. ` : "\\- ";
          const taskPrefix = item.checked === true ? "✅ " : item.checked === false ? "🔲 " : "";
          const body = item.blocks.map(renderBlock).filter(Boolean).join("\n");
          const continuation = " ".repeat(marker.length);
          return `${taskPrefix}${body}`
            .split("\n")
            .map((line, lineIndex) => `${lineIndex === 0 ? marker : continuation}${line}`)
            .join("\n");
        })
        .join("\n");
    case "code":
      return `\`\`\`${escapeMarkdownV2Code(block.language ?? "")}\n${escapeMarkdownV2Code(block.text)}\n\`\`\``;
    case "table": {
      if (block.rows.length === 0) {
        return "";
      }
      const headerRow = block.rows[0];
      if (!headerRow) {
        return "";
      }
      const header = `\\| ${headerRow.map(escapeMarkdownV2).join(" \\| ")} \\|`;
      const separator = `\\| ${headerRow.map(() => "\\-\\-\\-").join(" \\| ")} \\|`;
      const body = block.rows
        .slice(1)
        .map((row) => `\\| ${row.map(escapeMarkdownV2).join(" \\| ")} \\|`);
      return [header, separator, ...body].join("\n");
    }
    case "rule":
      return "---";
    case "plain":
      return escapeMarkdownV2(block.text);
  }
}

/**
 * Converts standard Markdown into Telegram MarkdownV2.
 *
 * Uses the project's existing block parser (unified/remark) so that
 * headings, lists, tables, code blocks, etc. are handled consistently
 * with the entity-based Telegram renderer.
 */
export function convertToTelegramMarkdownV2(markdown: string): string {
  const normalized = normalizeMarkdownForTelegramRendering(markdown);
  const blocks = parseTelegramBlocks(normalized);
  if (blocks.length === 0) {
    return "";
  }
  return blocks.map(renderBlock).join("\n\n");
}
