function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}

function isSafeUtf16Boundary(text: string, index: number): boolean {
  if (index <= 0 || index >= text.length) {
    return true;
  }

  return !(isHighSurrogate(text.charCodeAt(index - 1)) && isLowSurrogate(text.charCodeAt(index)));
}

function isWhitespaceBoundary(text: string, index: number): boolean {
  const previous = text[index - 1];
  return index > 0 && previous !== undefined && /\s/.test(previous);
}

/**
 * Finds the largest safe cut point within `maxLength` of `start`, preferring a
 * line break, then any whitespace, then any UTF-16 safe boundary.
 */
function findSplitBoundary(text: string, start: number, maxLength: number): number | null {
  const hardEnd = Math.min(text.length, start + maxLength);
  if (hardEnd >= text.length) {
    return text.length;
  }

  let whitespaceBoundary: number | null = null;
  let fallbackBoundary: number | null = null;

  for (let index = hardEnd; index > start; index--) {
    if (!isSafeUtf16Boundary(text, index)) {
      continue;
    }

    if (text[index - 1] === "\n") {
      return index;
    }

    if (whitespaceBoundary === null && isWhitespaceBoundary(text, index)) {
      whitespaceBoundary = index;
    }

    if (fallbackBoundary === null) {
      fallbackBoundary = index;
    }
  }

  return whitespaceBoundary ?? fallbackBoundary;
}

export function splitTextIntoChunks(text: string, maxLength: number): string[] {
  if (!text) {
    return [];
  }

  const limit = Math.max(1, Math.floor(maxLength));
  if (text.length <= limit) {
    return [text];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = findSplitBoundary(text, start, limit);
    if (!end || end <= start) {
      throw new Error("Unable to split text on a safe UTF-16 boundary");
    }

    chunks.push(text.slice(start, end));
    start = end;
  }

  return chunks;
}
