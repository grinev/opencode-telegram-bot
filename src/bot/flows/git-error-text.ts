const MAX_ERROR_LENGTH = 200;

/**
 * Compact, user-facing excerpt of a git failure. execFile errors start with
 * "Command failed: git …"; the stderr after it is the part worth showing.
 */
export function shortGitErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const detail = message.replace(/^Command failed:.*\n?/, "").trim() || message;
  return detail.length > MAX_ERROR_LENGTH ? `${detail.slice(0, MAX_ERROR_LENGTH)}…` : detail;
}
