import { getProjectFolderName } from "./project-selection-menu.js";

function pathSegments(directory: string): string[] {
  return directory.split(/[\\/]/).filter(Boolean);
}

/**
 * The project label /recent shows for a directory: its folder name, or the shortest
 * path tail that keeps it apart from the other known folders.
 */
export function resolveProjectName(
  directory: string,
  knownDirectories: readonly string[],
): string {
  const segments = pathSegments(directory);
  const others = knownDirectories
    .filter((other) => other !== directory)
    .map((other) => pathSegments(other));
  let depth = 1;
  while (
    depth < segments.length &&
    others.some((other) => other.slice(-depth).join("/") === segments.slice(-depth).join("/"))
  ) {
    depth++;
  }
  return depth === 1 ? getProjectFolderName(directory) : segments.slice(-depth).join("/");
}
