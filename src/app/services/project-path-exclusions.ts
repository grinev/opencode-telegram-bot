import path from "node:path";

export function projectPathKey(directory: string): string {
  const isWindowsPath =
    process.platform === "win32" || /^[a-zA-Z]:[\\/]/.test(directory) || /^\\\\/.test(directory);
  const pathModule = isWindowsPath ? path.win32 : path.posix;
  const normalized = pathModule.normalize(directory);
  const root = pathModule.parse(normalized).root;
  const trimmed = normalized === root ? normalized : normalized.replace(/[\\/]+$/, "");

  return isWindowsPath ? trimmed.toLowerCase() : trimmed;
}

/** An exact path match, not a prefix or a match on repository identity. */
export function createProjectPathExclusionMatcher(
  excludedPaths: readonly string[],
): ((directory: string) => boolean) | undefined {
  if (excludedPaths.length === 0) return undefined;

  const excludedKeys = new Set(excludedPaths.map(projectPathKey));
  return (directory) => excludedKeys.has(projectPathKey(directory));
}
