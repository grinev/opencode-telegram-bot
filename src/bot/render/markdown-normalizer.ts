import type { PhrasingContent, Root, RootContent } from "mdast";
import { unified } from "unified";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";

interface NormalizeMarkdownOptions {
  preserveBlockMarkup: boolean;
}

const markdownProcessor = unified().use(remarkParse).use(remarkGfm);

type CodeLine = "block" | "inline-start" | "inline-continuation";

/** Zero-based source lines occupied by literal block or inline code. */
function collectCodeLines(markdown: string): Map<number, CodeLine> {
  const codeLines = new Map<number, CodeLine>();
  const visit = (node: Root | RootContent | PhrasingContent): void => {
    if (node.type === "code" || node.type === "inlineCode") {
      if (node.position) {
        for (let line = node.position.start.line; line <= node.position.end.line; line++) {
          const kind =
            node.type === "code"
              ? "block"
              : line === node.position.start.line
                ? "inline-start"
                : "inline-continuation";
          if (kind !== "inline-start" || !codeLines.has(line - 1)) {
            codeLines.set(line - 1, kind);
          }
        }
      }
      return;
    }

    if ("children" in node) {
      for (const child of node.children) {
        visit(child);
      }
    }
  };

  visit(markdownProcessor.parse(markdown) as Root);
  return codeLines;
}

/** Drops the opening fence indentation so the formula keeps its own layout. */
function stripIndent(line: string, indent: string): string {
  if (!indent) {
    return line;
  }

  return line.startsWith(indent) ? line.slice(indent.length) : line.trimStart();
}

function isHorizontalRuleLine(line: string): boolean {
  const normalized = line.trim();
  if (!normalized) {
    return false;
  }

  return /^([-*_])(?:\s*\1){2,}$/.test(normalized);
}

function isHeadingLine(line: string): boolean {
  return /^\s{0,3}#{1,6}\s+\S/.test(line);
}

/** `$$ formula $$` on a single line, as models often emit it. */
function extractSingleLineMath(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("$$") || !trimmed.endsWith("$$") || trimmed.length <= 4) {
    return null;
  }

  const expression = trimmed.slice(2, -2).trim();
  return expression ? expression : null;
}

function isMathFenceLine(line: string): boolean {
  return line.trim() === "$$";
}

function normalizeHeadingLine(line: string): string {
  const match = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*$/);
  const heading = match?.[1];
  if (!heading) {
    return line;
  }

  return `**${heading}**`;
}

function normalizeChecklistLine(line: string): string | null {
  const match = line.match(/^(\s*)(?:[-+*]|\d+\.)\s+\[( |x|X)\]\s+(.*)$/);
  const indent = match?.[1];
  const checked = match?.[2];
  const rest = match?.[3];
  if (indent === undefined || checked === undefined || rest === undefined) {
    return null;
  }

  const marker = checked.toLowerCase() === "x" ? "✅" : "🔲";
  return `${indent}${marker} ${rest}`;
}

function normalizeMarkdown(text: string, options: NormalizeMarkdownOptions): string {
  const lines = text.split("\n");
  const codeLines = collectCodeLines(text);
  const output: string[] = [];
  let inQuote = false;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line === undefined) {
      continue;
    }

    const codeLine = codeLines.get(index);
    if (codeLine) {
      const hasQuoteMarker = line.trimStart().startsWith(">");
      if (codeLine === "block") {
        inQuote = false;
      } else if (codeLine === "inline-start" && hasQuoteMarker) {
        inQuote = true;
      }
      output.push(inQuote && !hasQuoteMarker ? `> ${line}` : line);
      continue;
    }

    if (!line.trim()) {
      inQuote = false;
      output.push(line);
      continue;
    }

    const indent = line.match(/^[ \t]*/)?.[0] ?? "";
    const singleLineMath = extractSingleLineMath(line);
    if (singleLineMath) {
      output.push(`${indent}\`\`\`math`, `${indent}${singleLineMath}`, `${indent}\`\`\``);
      inQuote = false;
      continue;
    }

    if (isMathFenceLine(line)) {
      const expressionLines: string[] = [];
      let closingIndex = -1;
      for (let inner = index + 1; inner < lines.length; inner++) {
        if (codeLines.has(inner)) {
          break;
        }
        const innerLine = lines[inner];
        if (innerLine === undefined) {
          continue;
        }
        if (isMathFenceLine(innerLine)) {
          closingIndex = inner;
          break;
        }
        expressionLines.push(innerLine);
      }

      const expression = expressionLines
        .map((expressionLine) => stripIndent(expressionLine, indent))
        .join("\n")
        .trim();
      if (closingIndex !== -1 && expression) {
        output.push(`${indent}\`\`\`math`);
        for (const expressionLine of expression.split("\n")) {
          output.push(expressionLine ? `${indent}${expressionLine}` : "");
        }
        output.push(`${indent}\`\`\``);
        index = closingIndex;
        inQuote = false;
        continue;
      }
    }

    if (isHeadingLine(line)) {
      output.push(options.preserveBlockMarkup ? line : normalizeHeadingLine(line));
      inQuote = false;
      continue;
    }

    if (isHorizontalRuleLine(line)) {
      output.push(options.preserveBlockMarkup ? line : "──────────");
      inQuote = false;
      continue;
    }

    const trimmedLeft = line.trimStart();
    if (trimmedLeft.startsWith(">")) {
      inQuote = true;
      const quoteContent = trimmedLeft.replace(/^>\s?/, "");
      const normalizedChecklistInQuote = normalizeChecklistLine(quoteContent);
      output.push(
        normalizedChecklistInQuote && !options.preserveBlockMarkup
          ? `> ${normalizedChecklistInQuote.trimStart()}`
          : `> ${quoteContent.trimStart()}`,
      );
      continue;
    }

    const normalizedChecklist = normalizeChecklistLine(line);
    if (normalizedChecklist) {
      if (options.preserveBlockMarkup) {
        output.push(inQuote ? `> ${trimmedLeft}` : line);
      } else {
        output.push(inQuote ? `> ${normalizedChecklist.trimStart()}` : normalizedChecklist);
      }
      continue;
    }

    if (inQuote) {
      output.push(`> ${trimmedLeft}`);
      continue;
    }

    output.push(line);
  }

  return output.join("\n");
}

export function normalizeMarkdownForTelegramRendering(text: string): string {
  return normalizeMarkdown(text, { preserveBlockMarkup: false });
}

export function normalizeMarkdownForTelegramBlockParsing(text: string): string {
  return normalizeMarkdown(text, { preserveBlockMarkup: true });
}
