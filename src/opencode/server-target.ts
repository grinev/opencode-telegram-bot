import { config } from "../config.js";
import { logger } from "../utils/logger.js";

/** An OpenCode server address with the basic-auth credentials it expects, if any. */
export interface OpencodeServerTarget {
  url: string;
  username?: string;
  password?: string;
}

// The server the bot talks to when it is not the configured one; lives until the bot restarts.
let switchedServer: OpencodeServerTarget | null = null;

export function getConfiguredOpencodeServer(): OpencodeServerTarget {
  return {
    url: config.opencode.apiUrl,
    username: config.opencode.username,
    password: config.opencode.password,
  };
}

/** The server every OpenCode request goes to. */
export function getActiveOpencodeServer(): OpencodeServerTarget {
  return switchedServer ?? getConfiguredOpencodeServer();
}

export function isOnConfiguredOpencodeServer(): boolean {
  return switchedServer === null;
}

/** A server address for the log, without any credentials written into it. */
export function describeOpencodeServerUrl(serverUrl: string): string {
  try {
    const url = new URL(serverUrl);
    return `${url.protocol}//${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return "the configured OPENCODE_API_URL";
  }
}

/** Points every later OpenCode request at the given server, or at the configured one for null. */
export function switchOpencodeServer(server: OpencodeServerTarget | null): void {
  const previousUrl = getActiveOpencodeServer().url;
  switchedServer = server && server.url !== config.opencode.apiUrl ? server : null;
  const nextUrl = getActiveOpencodeServer().url;
  if (nextUrl !== previousUrl) {
    logger.info(
      `[OpenCode] Switched the OpenCode server from ${describeOpencodeServerUrl(previousUrl)} to ${describeOpencodeServerUrl(nextUrl)}`,
    );
  }
}

export function __resetOpencodeServerTargetForTests(): void {
  switchedServer = null;
}
