import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { isExpectedOpencodeUnavailableError } from "../utils/opencode-error.js";
import { opencodeClient, opencodeServerVersion, probeOpencodeServer } from "./client.js";

export type OpencodeHealth =
  { healthy: true; version: string | undefined } | { healthy: false; error: unknown };

let lastReportedProblem: string | null = null;

function describeServerUrl(): string {
  try {
    const url = new URL(config.opencode.apiUrl);
    return `${url.protocol}//${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return "the configured OPENCODE_API_URL";
  }
}

function reportOnce(key: string, report: () => void): void {
  if (lastReportedProblem === key) {
    return;
  }
  lastReportedProblem = key;
  report();
}

/** Explains a failed health check in the log: wrong credentials or a server of the other version. */
async function explainFailedHealthCheck(): Promise<void> {
  const configured = await probeOpencodeServer(opencodeServerVersion);
  if (configured.kind === "unauthorized") {
    reportOnce("unauthorized", () =>
      logger.warn(
        `[OpenCode] Authentication failed at ${describeServerUrl()}: check OPENCODE_SERVER_USERNAME and OPENCODE_SERVER_PASSWORD`,
      ),
    );
    return;
  }

  const otherVersion = opencodeServerVersion === "v1" ? "v2" : "v1";
  const other = await probeOpencodeServer(otherVersion);
  // A server that answers the configured route without asking for credentials but locks
  // the other version's route is that other version: a password-protected server locks
  // every route. Its exact version stays unknown without the password.
  const actual =
    other.kind === "found"
      ? `OpenCode ${other.serverVersion}`
      : other.kind === "unauthorized"
        ? "an OpenCode server"
        : null;
  if (!actual) {
    return;
  }

  reportOnce(`mismatch:${actual}`, () =>
    logger.error(
      `[OpenCode] Server version mismatch: OPENCODE_SERVER_VERSION=${opencodeServerVersion}, but the server at ${describeServerUrl()} is ${actual} (API ${otherVersion}). Set OPENCODE_SERVER_VERSION=${otherVersion} and restart the bot, or run an OpenCode ${opencodeServerVersion} server at this address.`,
    ),
  );
}

/**
 * Health of the server at the configured URL through the configured API version. A server
 * that answers with anything but the expected health shape is unhealthy.
 */
export async function checkOpencodeHealth(): Promise<OpencodeHealth> {
  let error: unknown;
  try {
    const result = await opencodeClient.global.health();
    if (!result.error && result.data?.healthy === true) {
      lastReportedProblem = null;
      return { healthy: true, version: result.data.version };
    }
    error = result.error ?? new Error("Unexpected OpenCode health response");
  } catch (caught) {
    error = caught;
  }

  if (!isExpectedOpencodeUnavailableError(error)) {
    await explainFailedHealthCheck();
  }
  return { healthy: false, error };
}

export function __resetServerHealthStateForTests(): void {
  lastReportedProblem = null;
}
