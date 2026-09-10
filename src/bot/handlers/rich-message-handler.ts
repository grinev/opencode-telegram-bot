import type { Context, NextFunction } from "grammy";
import type {
  RichBlock,
  RichBlockCaption,
  RichBlockTableCell,
  RichText,
} from "grammy/types";
import {
  createIncomingPrompt,
  type IncomingPrompt,
  type TelegramPhotoInput,
} from "../../app/types/prompt.js";
import { t } from "../../i18n/index.js";

const incomingPromptKey: unique symbol = Symbol("incomingPrompt");

type ContextWithIncomingPrompt = Context & {
  [incomingPromptKey]?: IncomingPrompt;
};

interface RichMessageConversion {
  text: string;
  photos: TelegramPhotoInput[];
  skippedMediaCount: number;
}

interface ConversionState {
  photos: TelegramPhotoInput[];
  skippedMediaCount: number;
  messageId: number;
}

export function setIncomingPrompt(ctx: Context, input: IncomingPrompt): void {
  (ctx as ContextWithIncomingPrompt)[incomingPromptKey] = input;
}

export function getIncomingPrompt(ctx: Context): IncomingPrompt | null {
  const stored = (ctx as ContextWithIncomingPrompt)[incomingPromptKey];
  if (stored) {
    return stored;
  }

  const text = ctx.message?.text;
  return text === undefined ? null : createIncomingPrompt(text);
}

export async function normalizeRichMessage(
  ctx: Context,
  next: NextFunction,
): Promise<void> {
  const message = ctx.message;
  if (!message?.rich_message) {
    await next();
    return;
  }

  const converted = convertRichMessage(message.rich_message.blocks, message.message_id);
  const input = createIncomingPrompt(converted.text, { photos: converted.photos });
  setIncomingPrompt(ctx, input);

  Object.assign(message, { text: converted.text });
  exposeSlashCommandEntity(message, converted.text);

  if (converted.skippedMediaCount > 0) {
    await ctx.reply(
      t("bot.rich_message_media_skipped", {
        count: String(converted.skippedMediaCount),
      }),
    );
  }

  await next();
}

export function convertRichMessage(blocks: RichBlock[], messageId = 0): RichMessageConversion {
  const state: ConversionState = {
    photos: [],
    skippedMediaCount: 0,
    messageId,
  };
  const text = renderBlocks(blocks, state).trim();
  return { text, photos: state.photos, skippedMediaCount: state.skippedMediaCount };
}

function exposeSlashCommandEntity(
  message: NonNullable<Context["message"]>,
  text: string,
): void {
  const token = text.trim().split(/\s+/)[0];
  if (!token?.startsWith("/") || token.length < 2) {
    return;
  }

  const existing = message.entities ?? [];
  message.entities = [
    { type: "bot_command", offset: 0, length: token.length },
    ...existing.filter((entity) => entity.type !== "bot_command"),
  ];
}

function renderBlocks(blocks: RichBlock[], state: ConversionState): string {
  return blocks
    .map((block) => renderBlock(block, state))
    .filter((block) => block.length > 0)
    .join("\n\n");
}

function renderBlock(block: RichBlock, state: ConversionState): string {
  switch (block.type) {
    case "paragraph":
    case "footer":
    case "thinking":
      return renderRichText(block.text);
    case "heading":
      return `${"#".repeat(block.size)} ${renderRichText(block.text)}`;
    case "pre": {
      const content = plainRichText(block.text);
      const fence = content.includes("```") ? "````" : "```";
      return `${fence}${block.language ?? ""}\n${content}\n${fence}`;
    }
    case "divider":
      return "---";
    case "mathematical_expression":
      return `$$\n${block.expression}\n$$`;
    case "anchor":
      return `<a name="${escapeHtmlAttribute(block.name)}"></a>`;
    case "list":
      return block.items
        .map((item) => {
          const marker = item.has_checkbox
            ? item.is_checked
              ? "- [x]"
              : "- [ ]"
            : item.label || "-";
          return prefixFirstAndIndentRest(marker, renderBlocks(item.blocks, state));
        })
        .join("\n");
    case "blockquote":
      return quoteMarkdown(
        [renderBlocks(block.blocks, state), block.credit && `— ${renderRichText(block.credit)}`]
          .filter(Boolean)
          .join("\n\n"),
      );
    case "pullquote":
      return quoteMarkdown(
        [renderRichText(block.text), block.credit && `— ${renderRichText(block.credit)}`]
          .filter(Boolean)
          .join("\n\n"),
      );
    case "collage":
    case "slideshow":
      return [
        renderBlocks(block.blocks, state),
        block.caption && renderCaption(block.caption),
      ]
        .filter(Boolean)
        .join("\n\n");
    case "table":
      return renderTable(block.cells, block.caption);
    case "details":
      return `<details${block.is_open ? " open" : ""}><summary>${renderRichText(block.summary)}</summary>\n\n${renderBlocks(block.blocks, state)}\n\n</details>`;
    case "photo": {
      const largestPhoto = block.photo[block.photo.length - 1];
      if (largestPhoto) {
        state.photos.push({
          fileId: largestPhoto.file_id,
          filename: `rich-photo-${state.messageId}-${state.photos.length + 1}.jpg`,
          source: "rich",
          ...(largestPhoto.file_size === undefined ? {} : { fileSize: largestPhoto.file_size }),
        });
      }
      return block.caption ? renderCaption(block.caption) : "";
    }
    case "animation":
    case "audio":
    case "video":
    case "voice_note":
    case "map":
      state.skippedMediaCount += 1;
      return block.caption ? renderCaption(block.caption) : "";
    default:
      return assertNever(block);
  }
}

function renderRichText(text: RichText): string {
  if (typeof text === "string") {
    return escapeMarkdownText(text);
  }
  if (Array.isArray(text)) {
    return text.map(renderRichText).join("");
  }

  switch (text.type) {
    case "bold":
      return `**${renderRichText(text.text)}**`;
    case "italic":
      return `_${renderRichText(text.text)}_`;
    case "underline":
      return `<u>${renderRichText(text.text)}</u>`;
    case "strikethrough":
      return `~~${renderRichText(text.text)}~~`;
    case "spoiler":
      return `||${renderRichText(text.text)}||`;
    case "subscript":
      return `<sub>${renderRichText(text.text)}</sub>`;
    case "superscript":
      return `<sup>${renderRichText(text.text)}</sup>`;
    case "marked":
      return `==${renderRichText(text.text)}==`;
    case "code":
      return renderInlineCode(plainRichText(text.text));
    case "custom_emoji":
      return escapeMarkdownText(text.alternative_text);
    case "mathematical_expression":
      return `$${text.expression}$`;
    case "url":
      return `[${renderRichText(text.text)}](${escapeLinkTarget(text.url)})`;
    case "email_address":
      return `[${renderRichText(text.text)}](mailto:${escapeLinkTarget(text.email_address)})`;
    case "phone_number":
      return `[${renderRichText(text.text)}](tel:${escapeLinkTarget(text.phone_number)})`;
    case "anchor":
      return `<a name="${escapeHtmlAttribute(text.name)}"></a>`;
    case "anchor_link":
      return `[${renderRichText(text.text)}](#${escapeLinkTarget(text.anchor_name)})`;
    case "reference":
      return `[^${escapeReferenceName(text.name)}]: ${renderRichText(text.text)}`;
    case "reference_link":
      return `[${renderRichText(text.text)}][^${escapeReferenceName(text.reference_name)}]`;
    case "date_time":
    case "text_mention":
    case "bank_card_number":
    case "mention":
    case "hashtag":
    case "cashtag":
    case "bot_command":
      return renderRichText(text.text);
    default:
      return assertNever(text);
  }
}

function plainRichText(text: RichText): string {
  if (typeof text === "string") {
    return text;
  }
  if (Array.isArray(text)) {
    return text.map(plainRichText).join("");
  }

  switch (text.type) {
    case "custom_emoji":
      return text.alternative_text;
    case "mathematical_expression":
      return text.expression;
    case "anchor":
      return "";
    case "reference":
    case "reference_link":
    case "bold":
    case "italic":
    case "underline":
    case "strikethrough":
    case "spoiler":
    case "date_time":
    case "text_mention":
    case "subscript":
    case "superscript":
    case "marked":
    case "code":
    case "url":
    case "email_address":
    case "phone_number":
    case "bank_card_number":
    case "mention":
    case "hashtag":
    case "cashtag":
    case "bot_command":
    case "anchor_link":
      return plainRichText(text.text);
    default:
      return assertNever(text);
  }
}

function renderCaption(caption: RichBlockCaption): string {
  return [renderRichText(caption.text), caption.credit && `— ${renderRichText(caption.credit)}`]
    .filter(Boolean)
    .join("\n");
}

function renderTable(cells: RichBlockTableCell[][], caption?: RichText): string {
  if (cells.length === 0) {
    return caption ? renderRichText(caption) : "";
  }

  const columnCount = Math.max(...cells.map((row) => row.length));
  const rows = cells.map((row) =>
    Array.from({ length: columnCount }, (_, index) => {
      const cell = row[index];
      return cell?.text ? escapeTableCell(renderRichText(cell.text)) : "";
    }),
  );
  const firstRow = cells[0] ?? [];
  const alignment = Array.from({ length: columnCount }, (_, index) => {
    const align = firstRow[index]?.align ?? "left";
    return align === "center" ? ":---:" : align === "right" ? "---:" : ":---";
  });
  const table = [
    `| ${rows[0]?.join(" | ") ?? ""} |`,
    `| ${alignment.join(" | ")} |`,
    ...rows.slice(1).map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
  return [caption && renderRichText(caption), table].filter(Boolean).join("\n\n");
}

function prefixFirstAndIndentRest(marker: string, text: string): string {
  const lines = text.split("\n");
  return lines
    .map((line, index) => (index === 0 ? `${marker} ${line}` : `  ${line}`))
    .join("\n");
}

function quoteMarkdown(text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function renderInlineCode(text: string): string {
  const fence = text.includes("`") ? "``" : "`";
  return `${fence}${text}${fence}`;
}

function escapeMarkdownText(text: string): string {
  return text.replace(/([\\`*_[\]<>])/g, "\\$1");
}

function escapeTableCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function escapeLinkTarget(text: string): string {
  return text.replace(/([\\()])/g, "\\$1");
}

function escapeReferenceName(text: string): string {
  return text.replace(/[\]^]/g, "");
}

function escapeHtmlAttribute(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function assertNever(value: never): never {
  throw new Error(`Unsupported rich message value: ${JSON.stringify(value)}`);
}
