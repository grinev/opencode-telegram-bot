const SILENCE_MARKER = "[SILENT]";
const MARKER_LENGTH_CAP = 64;
// Match Python's str.strip/split whitespace and str.splitlines boundaries used by Hermes.
const EDGE_WHITESPACE = /^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu;
const WHITESPACE = /[\p{White_Space}\u001c-\u001f]+/gu;
const LINE_BOUNDARY = /\r\n|[\n\v\f\r\u001c-\u001e\u0085\u2028\u2029]/u;

function trimWhitespace(text: string): string {
  return text.replace(EDGE_WHITESPACE, "");
}

function isEdgePunctuation(character: string): boolean {
  return character !== "[" && character !== "]" && /\p{P}/u.test(character);
}

function isSilenceCandidate(text: string): boolean {
  const characters = Array.from(trimWhitespace(text));
  if (characters.length === 0 || characters.length > MARKER_LENGTH_CAP) {
    return false;
  }

  while (characters.length > 0 && isEdgePunctuation(characters[0]!)) {
    characters.shift();
  }
  while (characters.length > 0 && isEdgePunctuation(characters[characters.length - 1]!)) {
    characters.pop();
  }

  return (
    trimWhitespace(characters.join("")).toUpperCase().replace(WHITESPACE, " ") === SILENCE_MARKER
  );
}

export function isScheduledTaskSilentResult(resultText: string): boolean {
  const stripped = trimWhitespace(resultText);
  if (!stripped) {
    return false;
  }
  if (stripped.toUpperCase().startsWith(SILENCE_MARKER)) {
    return true;
  }

  const lines = stripped.split(LINE_BOUNDARY).filter((line) => trimWhitespace(line));
  return [stripped, lines[0]!, lines[lines.length - 1]!].some(isSilenceCandidate);
}
