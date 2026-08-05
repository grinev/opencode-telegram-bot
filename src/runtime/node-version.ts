const MINIMUM_NODE_MAJOR = 22;
const MINIMUM_NODE_MINOR = 14;
const MINIMUM_NODE_VERSION = `${MINIMUM_NODE_MAJOR}.${MINIMUM_NODE_MINOR}`;

/**
 * Returns an error message when the running Node.js is too old, otherwise null.
 *
 * Must be checked before any module that loads a native addon is imported:
 * better-sqlite3 crashes the process with SIGSEGV on unsupported Node.js
 * versions, and such a crash cannot be caught by try/catch. Its prebuilt addon
 * requires Node-API v10, which is only available from Node.js 22.14.
 */
export function getUnsupportedNodeVersionMessage(
  version: string = process.versions.node,
): string | null {
  const [rawMajor, rawMinor] = version.split(".");
  const major = Number.parseInt(rawMajor ?? "", 10);
  const minor = Number.parseInt(rawMinor ?? "", 10);

  if (!Number.isInteger(major) || !Number.isInteger(minor)) {
    return null;
  }

  if (major > MINIMUM_NODE_MAJOR || (major === MINIMUM_NODE_MAJOR && minor >= MINIMUM_NODE_MINOR)) {
    return null;
  }

  return [
    `OpenCode Telegram Bot requires Node.js ${MINIMUM_NODE_VERSION} or newer, but the current version is v${version}.`,
    "Update Node.js and try again: https://nodejs.org",
  ].join("\n");
}
