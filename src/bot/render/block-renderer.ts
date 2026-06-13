import type { MessageEntity } from "grammy/types";
import { renderInlineNodesValidated } from "./inline-renderer.js";
import type { BlockRenderMode, InlineNode, TelegramBlock, TelegramRenderedBlock } from "./types.js";
import { validateTelegramEntities } from "./validator.js";

interface RenderedSegment {
  text: string;
  fallbackText: string;
  entities?: MessageEntity[];
  source: "entities" | "plain";
}

interface LineSpec {
  prefix: string;
  nodes: InlineNode[];
}

const ENTITY_TYPE_PRIORITY: Record<MessageEntity["type"], number> = {
  bold: 1,
  italic: 2,
  underline: 3,
  strikethrough: 4,
  spoiler: 5,
  code: 6,
  pre: 7,
  text_link: 8,
  mention: 100,
  hashtag: 101,
  cashtag: 102,
  bot_command: 103,
  url: 104,
  email: 105,
  phone_number: 106,
  blockquote: 107,
  expandable_blockquote: 108,
  text_mention: 109,
  custom_emoji: 110,
};

function compareEntities(left: MessageEntity, right: MessageEntity): number {
  if (left.offset !== right.offset) {
    return left.offset - right.offset;
  }

  if (left.length !== right.length) {
    return right.length - left.length;
  }

  return ENTITY_TYPE_PRIORITY[left.type] - ENTITY_TYPE_PRIORITY[right.type];
}

function sortEntities(entities: MessageEntity[]): MessageEntity[] {
  return [...entities].sort(compareEntities);
}

function pushTextNode(target: InlineNode[], text: string): void {
  if (!text) {
    return;
  }

  const previous = target.at(-1);
  if (previous?.type === "text") {
    previous.text += text;
    return;
  }

  target.push({ type: "text", text });
}

function appendInlineNode(target: InlineNode[], node: InlineNode): void {
  if (node.type === "text") {
    pushTextNode(target, node.text);
    return;
  }

  target.push(node);
}

function appendInlineNodes(target: InlineNode[], nodes: InlineNode[]): void {
  for (const node of nodes) {
    appendInlineNode(target, node);
  }
}

function rebaseEntities(entities: MessageEntity[] | undefined, offset: number): MessageEntity[] {
  if (!entities?.length) {
    return [];
  }

  return entities.map((entity) => ({
    ...entity,
    offset: entity.offset + offset,
  }));
}

function extractInlinePlainText(nodes: InlineNode[]): string {
  let result = "";

  for (const node of nodes) {
    switch (node.type) {
      case "text":
        result += node.text;
        break;
      case "bold":
      case "italic":
      case "strike":
      case "underline":
      case "spoiler":
        result += extractInlinePlainText(node.children);
        break;
      case "code":
        result += node.text;
        break;
      case "link":
        result += extractInlinePlainText(node.text);
        break;
      default: {
        const exhaustiveCheck: never = node;
        throw new Error(`Unsupported inline node: ${JSON.stringify(exhaustiveCheck)}`);
      }
    }
  }

  return result;
}

function containsCodeNode(nodes: InlineNode[]): boolean {
  for (const node of nodes) {
    switch (node.type) {
      case "code":
        return true;
      case "bold":
      case "italic":
      case "strike":
      case "underline":
      case "spoiler":
        if (containsCodeNode(node.children)) {
          return true;
        }
        break;
      case "link":
        if (containsCodeNode(node.text)) {
          return true;
        }
        break;
      case "text":
        break;
      default: {
        const exhaustiveCheck: never = node;
        throw new Error(`Unsupported inline node: ${JSON.stringify(exhaustiveCheck)}`);
      }
    }
  }

  return false;
}

function simplifyInlineNodes(nodes: InlineNode[], insideLink = false): InlineNode[] {
  const result: InlineNode[] = [];

  for (const node of nodes) {
    switch (node.type) {
      case "text":
        pushTextNode(result, node.text);
        break;
      case "code":
        result.push(node);
        break;
      case "link": {
        const simplifiedChildren = simplifyInlineNodes(node.text, true);
        if (insideLink) {
          appendInlineNodes(result, simplifiedChildren);
          break;
        }

        if (simplifiedChildren.length > 0) {
          result.push({ type: "link", text: simplifiedChildren, url: node.url });
        }
        break;
      }
      case "bold":
      case "italic":
      case "strike":
      case "underline":
      case "spoiler": {
        const simplifiedChildren = simplifyInlineNodes(node.children, insideLink);
        if (simplifiedChildren.length === 0) {
          break;
        }

        if (containsCodeNode(simplifiedChildren)) {
          appendInlineNodes(result, simplifiedChildren);
          break;
        }

        result.push({ ...node, children: simplifiedChildren });
        break;
      }
      default: {
        const exhaustiveCheck: never = node;
        throw new Error(`Unsupported inline node: ${JSON.stringify(exhaustiveCheck)}`);
      }
    }
  }

  return result;
}

function wrapInlineNode(node: InlineNode, children: InlineNode[]): InlineNode | null {
  if (children.length === 0) {
    return null;
  }

  switch (node.type) {
    case "bold":
    case "italic":
    case "strike":
    case "underline":
    case "spoiler":
      return { ...node, children };
    case "link":
      return { ...node, text: children };
    case "text":
      return { type: "text", text: extractInlinePlainText(children) };
    case "code":
      return { type: "code", text: extractInlinePlainText(children) };
    default: {
      const exhaustiveCheck: never = node;
      throw new Error(`Unsupported inline node: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

function splitInlineNodesByNewline(nodes: InlineNode[]): InlineNode[][] {
  const lines: InlineNode[][] = [[]];

  const pushLineBreak = (): void => {
    lines.push([]);
  };

  const appendNodeWithLineSplit = (node: InlineNode): void => {
    switch (node.type) {
      case "text": {
        const parts = node.text.split("\n");
        for (let index = 0; index < parts.length; index++) {
          pushTextNode(lines[lines.length - 1], parts[index]);
          if (index < parts.length - 1) {
            pushLineBreak();
          }
        }
        break;
      }
      case "code": {
        const parts = node.text.split("\n");
        for (let index = 0; index < parts.length; index++) {
          if (parts[index]) {
            appendInlineNode(lines[lines.length - 1], { type: "code", text: parts[index] });
          }
          if (index < parts.length - 1) {
            pushLineBreak();
          }
        }
        break;
      }
      case "bold":
      case "italic":
      case "strike":
      case "underline":
      case "spoiler":
      case "link": {
        const childLines = splitInlineNodesByNewline(
          node.type === "link" ? node.text : node.children,
        );
        for (let index = 0; index < childLines.length; index++) {
          if (index > 0) {
            pushLineBreak();
          }

          const wrapped = wrapInlineNode(node, childLines[index]);
          if (wrapped) {
            appendInlineNode(lines[lines.length - 1], wrapped);
          }
        }
        break;
      }
      default: {
        const exhaustiveCheck: never = node;
        throw new Error(`Unsupported inline node: ${JSON.stringify(exhaustiveCheck)}`);
      }
    }
  };

  for (const node of nodes) {
    appendNodeWithLineSplit(node);
  }

  return lines;
}

function applyWholeLineBold(
  text: string,
  entities: MessageEntity[] | undefined,
): MessageEntity[] | undefined {
  if (!text) {
    return entities;
  }

  const nextEntities = sortEntities([
    ...(entities ?? []),
    { type: "bold", offset: 0, length: text.length },
  ]);
  const validation = validateTelegramEntities(text, nextEntities);
  if (!validation.ok) {
    throw new Error(validation.issues.map((issue) => issue.message).join("; "));
  }

  return nextEntities;
}

function createRenderedBlock(
  blockType: TelegramBlock["type"],
  mode: BlockRenderMode,
  text: string,
  fallbackText: string,
  entities?: MessageEntity[],
): TelegramRenderedBlock {
  const normalizedEntities = entities?.length ? sortEntities(entities) : undefined;
  if (normalizedEntities) {
    const validation = validateTelegramEntities(text, normalizedEntities);
    if (!validation.ok) {
      throw new Error(validation.issues.map((issue) => issue.message).join("; "));
    }
  }

  return {
    blockType,
    mode,
    text,
    entities: normalizedEntities,
    fallbackText,
    source: normalizedEntities?.length ? "entities" : "plain",
  };
}

function renderInlineSegment(
  nodes: InlineNode[],
  simplify: boolean,
  boldWholeLine = false,
): RenderedSegment {
  const effectiveNodes = simplify ? simplifyInlineNodes(nodes) : nodes;
  const rendered = renderInlineNodesValidated(effectiveNodes);
  const entities = boldWholeLine
    ? applyWholeLineBold(rendered.text, rendered.entities)
    : rendered.entities;

  return {
    text: rendered.text,
    fallbackText: extractInlinePlainText(effectiveNodes),
    entities,
    source: entities?.length ? "entities" : "plain",
  };
}

function renderInlineSegmentWithLocalFallback(
  nodes: InlineNode[],
  boldWholeLine = false,
): RenderedSegment {
  try {
    return renderInlineSegment(nodes, false, boldWholeLine);
  } catch {
    try {
      return renderInlineSegment(nodes, true, boldWholeLine);
    } catch {
      const text = extractInlinePlainText(nodes);
      try {
        const entities = boldWholeLine ? applyWholeLineBold(text, undefined) : undefined;
        return {
          text,
          fallbackText: text,
          entities,
          source: entities?.length ? "entities" : "plain",
        };
      } catch {
        return {
          text,
          fallbackText: text,
          source: "plain",
        };
      }
    }
  }
}

function renderLineSpecs(
  blockType: TelegramBlock["type"],
  mode: Extract<BlockRenderMode, "full" | "simplified" | "line-by-line">,
  lineSpecs: LineSpec[],
  boldWholeLine = false,
): TelegramRenderedBlock {
  const textParts: string[] = [];
  const fallbackParts: string[] = [];
  const entities: MessageEntity[] = [];

  let currentOffset = 0;
  for (let index = 0; index < lineSpecs.length; index++) {
    const lineSpec = lineSpecs[index];
    const renderedLine =
      mode === "line-by-line"
        ? renderInlineSegmentWithLocalFallback(lineSpec.nodes, boldWholeLine)
        : renderInlineSegment(lineSpec.nodes, mode === "simplified", boldWholeLine);

    const lineText = `${lineSpec.prefix}${renderedLine.text}`;
    const lineFallbackText = `${lineSpec.prefix}${renderedLine.fallbackText}`;

    if (index > 0) {
      currentOffset += 1;
    }

    textParts.push(lineText);
    fallbackParts.push(lineFallbackText);
    entities.push(...rebaseEntities(renderedLine.entities, currentOffset + lineSpec.prefix.length));
    currentOffset += lineText.length;
  }

  return createRenderedBlock(
    blockType,
    mode,
    textParts.join("\n"),
    fallbackParts.join("\n"),
    entities,
  );
}

function renderPreformattedBlock(
  blockType: TelegramBlock["type"],
  mode: Extract<BlockRenderMode, "full" | "simplified">,
  text: string,
  language?: string,
): TelegramRenderedBlock {
  const entities = text
    ? [
        {
          type: "pre",
          offset: 0,
          length: text.length,
          ...(language ? { language } : {}),
        } as MessageEntity,
      ]
    : undefined;

  return createRenderedBlock(blockType, mode, text, text, entities);
}

function buildParagraphLineSpecs(inlines: InlineNode[]): LineSpec[] {
  return splitInlineNodesByNewline(inlines).map((nodes) => ({ prefix: "", nodes }));
}

function buildBlockquoteLineSpecs(lines: InlineNode[][]): LineSpec[] {
  return lines.flatMap((lineNodes) =>
    splitInlineNodesByNewline(lineNodes).map((nodes) => ({
      prefix: "> ",
      nodes,
    })),
  );
}

function buildListLineSpecs(ordered: boolean, items: InlineNode[][]): LineSpec[] {
  return items.flatMap((itemNodes, index) => {
    const marker = ordered ? `${index + 1}. ` : "- ";
    const continuationPrefix = " ".repeat(marker.length);

    return splitInlineNodesByNewline(itemNodes).map((nodes, lineIndex) => ({
      prefix: lineIndex === 0 ? marker : continuationPrefix,
      nodes,
    }));
  });
}

function buildAlignedTableText(rows: string[][]): string {
  const columnCount = Math.max(...rows.map((row) => row.length));
  const normalizedRows = rows.map((row) =>
    Array.from({ length: columnCount }, (_, index) => row[index] ?? ""),
  );
  const columnWidths = Array.from({ length: columnCount }, (_, index) =>
    Math.max(...normalizedRows.map((row) => row[index].length)),
  );

  const formatRow = (row: string[]): string =>
    row.map((cell, index) => cell.padEnd(columnWidths[index], " ")).join(" | ");

  const divider = columnWidths.map((width) => "-".repeat(width)).join("-|-");
  const formattedRows = normalizedRows.map(formatRow);

  if (formattedRows.length <= 1) {
    return formattedRows.join("\n");
  }

  return [formattedRows[0], divider, ...formattedRows.slice(1)].join("\n");
}

export function renderTelegramBlock(
  block: TelegramBlock,
  mode: BlockRenderMode = "full",
): TelegramRenderedBlock {
  switch (block.type) {
    case "paragraph":
      if (mode === "plain") {
        const text = extractInlinePlainText(block.inlines);
        return createRenderedBlock(block.type, mode, text, text);
      }

      if (mode === "line-by-line") {
        return renderLineSpecs(block.type, mode, buildParagraphLineSpecs(block.inlines));
      }

      {
        const segment = renderInlineSegment(block.inlines, mode === "simplified");
        return createRenderedBlock(
          block.type,
          mode,
          segment.text,
          segment.fallbackText,
          segment.entities,
        );
      }
    case "heading":
      if (mode === "plain") {
        const text = extractInlinePlainText(block.inlines);
        return createRenderedBlock(block.type, mode, text, text);
      }

      if (mode === "line-by-line") {
        return renderLineSpecs(block.type, mode, buildParagraphLineSpecs(block.inlines), true);
      }

      {
        const segment = renderInlineSegment(block.inlines, mode === "simplified", true);
        return createRenderedBlock(
          block.type,
          mode,
          segment.text,
          segment.fallbackText,
          segment.entities,
        );
      }
    case "blockquote":
      if (mode === "plain") {
        const text = buildBlockquoteLineSpecs(block.lines)
          .map((line) => `${line.prefix}${extractInlinePlainText(line.nodes)}`)
          .join("\n");
        return createRenderedBlock(block.type, mode, text, text);
      }

      return renderLineSpecs(
        block.type,
        mode === "line-by-line" ? mode : mode,
        buildBlockquoteLineSpecs(
          mode === "simplified"
            ? block.lines.map((line) => simplifyInlineNodes(line))
            : block.lines,
        ),
      );
    case "list":
      if (mode === "plain") {
        const text = buildListLineSpecs(block.ordered, block.items)
          .map((line) => `${line.prefix}${extractInlinePlainText(line.nodes)}`)
          .join("\n");
        return createRenderedBlock(block.type, mode, text, text);
      }

      return renderLineSpecs(
        block.type,
        mode === "line-by-line" ? mode : mode,
        buildListLineSpecs(
          block.ordered,
          mode === "simplified"
            ? block.items.map((item) => simplifyInlineNodes(item))
            : block.items,
        ),
      );
    case "code":
      if (mode === "plain" || mode === "line-by-line") {
        return createRenderedBlock(block.type, mode, block.text, block.text);
      }

      return renderPreformattedBlock(block.type, mode, block.text, block.language);
    case "table": {
      const text = buildAlignedTableText(block.rows);
      if (mode === "plain" || mode === "line-by-line") {
        return createRenderedBlock(block.type, mode, text, text);
      }

      return renderPreformattedBlock(block.type, mode, text);
    }
    case "rule":
      return createRenderedBlock(block.type, mode, "──────────", "──────────");
    case "plain":
      return createRenderedBlock(block.type, mode, block.text, block.text);
    default: {
      const exhaustiveCheck: never = block;
      throw new Error(`Unsupported Telegram block: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}
