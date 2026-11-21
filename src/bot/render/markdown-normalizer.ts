interface NormalizeMarkdownOptions {
  preserveBlockMarkup: boolean;
}

/** A fence delimiter: three or more backticks or tildes after up to three spaces. */
const CODE_FENCE_PATTERN = /^\s*(`{3,}|~{3,})/;

const LIST_MARKER_PATTERN = /^(\s*)(?:[-+*]|\d+[.)])\s+/;

/** Fence character of a delimiter line, or null when the line is not a fence. */
function codeFenceChar(line: string): "`" | "~" | null {
  const fence = line.match(CODE_FENCE_PATTERN)?.[1];
  return fence ? (fence[0] as "`" | "~") : null;
}

function leadingIndent(line: string): string {
  return line.match(/^[ \t]*/)?.[0] ?? "";
}

/** Indentation width, with tabs counted as four spaces. */
function indentWidth(indent: string): number {
  return indent.replace(/\t/g, "    ").length;
}

/**
 * Code the block parser reads literally: four spaces past the current list item
 * content, or four spaces at the left margin.
 */
function isIndentedCodeLine(line: string, listContentIndent: number): boolean {
  return indentWidth(leadingIndent(line)) >= listContentIndent + 4;
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
  const output: string[] = [];
  let inCodeFence = false;
  let codeFenceMark: "`" | "~" | null = null;
  let inQuote = false;
  let listContentIndent = 0;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line === undefined) {
      continue;
    }

    const fence = codeFenceChar(line);
    if (fence) {
      if (!inCodeFence) {
        inCodeFence = true;
        codeFenceMark = fence;
      } else if (fence === codeFenceMark) {
        inCodeFence = false;
        codeFenceMark = null;
      }
      inQuote = false;
      output.push(line);
      continue;
    }

    if (inCodeFence) {
      output.push(line);
      continue;
    }

    if (!line.trim()) {
      inQuote = false;
      output.push(line);
      continue;
    }

    const indent = leadingIndent(line);

    // Indented code is literal text: formulas inside it must stay untouched.
    if (isIndentedCodeLine(line, listContentIndent)) {
      output.push(line);
      continue;
    }

    const listMarker = line.match(LIST_MARKER_PATTERN);
    if (listMarker) {
      listContentIndent = indentWidth(listMarker[0]);
    } else if (indentWidth(indent) < listContentIndent) {
      listContentIndent = 0;
    }

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
