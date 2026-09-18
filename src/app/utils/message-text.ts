/**
 * Shared text extraction for OpenCode session messages.
 *
 * Used by both the session-switch preview/history flows and any caller that
 * needs the visible text of a message's parts.
 */

export type MessageTextPart = {
  type: string;
  text?: string;
};

export function extractMessageText(
  parts: MessageTextPart[],
  options: { trim?: boolean } = {},
): string | null {
  const textParts = parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string);

  if (textParts.length === 0) {
    return null;
  }

  const text = textParts.join("");
  const normalizedText = options.trim === false ? text : text.trim();
  return normalizedText.trim().length > 0 ? normalizedText : null;
}
