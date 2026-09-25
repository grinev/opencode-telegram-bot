import { config, type OpencodeServerVersion } from "../config.js";
import { logger } from "../utils/logger.js";
import { isExpectedOpencodeUnavailableError } from "../utils/opencode-error.js";
import { opencodeClient, opencodeServerVersion, probeOpencodeServer } from "./client.js";

export type OpencodeHealth =
  { healthy: true; version: string | undefined } | { healthy: false; error: unknown };

/** "always" logs every time (a user asked); "once" logs a problem once until it changes. */
export type ProblemReportMode = "always" | "once";

/** Why the configured URL did not answer as a healthy server of the configured version. */
export type FailedHealthCause =
  | { kind: "unauthorized" }
  | { kind: "mismatch"; actual: string; otherVersion: OpencodeServerVersion }
  | { kind: "unknown" };

let lastReportedProblem: string | null = null;

export function describeServerUrl(): string {
  try {
    const url = new URL(config.opencode.apiUrl);
    return `${url.protocol}//${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return "the configured OPENCODE_API_URL";
  }
}

/** Logs an OpenCode problem; in "once" mode the same problem is not logged again in a row. */
export function reportOpencodeProblem(
  key: string,
  mode: ProblemReportMode,
  report: () => void,
): void {
  if (mode === "once" && lastReportedProblem === key) {
    return;
  }
  lastReportedProblem = key;
  report();
}

/** Tells wrong credentials and a server of the other version apart from anything else. */
export async function classifyFailedHealthCheck(): Promise<FailedHealthCause> {
  const configured = await probeOpencodeServer(opencodeServerVersion);
  if (configured.kind === "unauthorized") {
    return { kind: "unauthorized" };
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
  return actual ? { kind: "mismatch", actual, otherVersion } : { kind: "unknown" };
}

/** Writes the log line for a failed health check cause; an unknown cause logs nothing. */
export function reportFailedHealthCause(cause: FailedHealthCause, mode: ProblemReportMode): void {
  if (cause.kind === "unauthorized") {
    reportOpencodeProblem("unauthorized", mode, () =>
      logger.warn(
        `[OpenCode] Authentication failed at ${describeServerUrl()}: check OPENCODE_SERVER_USERNAME and OPENCODE_SERVER_PASSWORD`,
      ),
    );
    return;
  }

  if (cause.kind === "mismatch") {
    reportOpencodeProblem(`mismatch:${cause.actual}`, mode, () =>
      logger.error(
        `[OpenCode] Server version mismatch: OPENCODE_SERVER_VERSION=${opencodeServerVersion}, but the server at ${describeServerUrl()} is ${cause.actual} (API ${cause.otherVersion}). Set OPENCODE_SERVER_VERSION=${cause.otherVersion} and restart the bot, or run an OpenCode ${opencodeServerVersion} server at this address.`,
      ),
    );
  }
}

/** Explains a failed health check in the log: wrong credentials or a server of the other version. */
export async function explainFailedHealthCheck(mode: ProblemReportMode): Promise<void> {
  reportFailedHealthCause(await classifyFailedHealthCheck(), mode);
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
    await explainFailedHealthCheck("once");
  }
  return { healthy: false, error };
}

export function __resetServerHealthStateForTests(): void {
  lastReportedProblem = null;
}
