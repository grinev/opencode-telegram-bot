interface NormalizeMarkdownOptions {
  preserveBlockMarkup: boolean;
}

function isCodeFenceLine(line: string): boolean {
  return line.trimStart().startsWith("```");
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

function normalizeHeadingLine(line: string): string {
  const match = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*$/);
  if (!match) {
    return line;
  }

  return `**${match[1]}**`;
}

function normalizeChecklistLine(line: string): string | null {
  const match = line.match(/^(\s*)(?:[-+*]|\d+\.)\s+\[( |x|X)\]\s+(.*)$/);
  if (!match) {
    return null;
  }

  const marker = match[2].toLowerCase() === "x" ? "✅" : "🔲";
  return `${match[1]}${marker} ${match[3]}`;
}

function normalizeMarkdown(text: string, options: NormalizeMarkdownOptions): string {
  const lines = text.split("\n");
  const output: string[] = [];
  let inCodeFence = false;
  let inQuote = false;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];

    if (isCodeFenceLine(line)) {
      inCodeFence = !inCodeFence;
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
