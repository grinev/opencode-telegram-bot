import { logger } from "../utils/logger.js";
import {
  findRegisteredOpencodeServer,
  opencodeServerVersion,
  probeOpencodeServer,
} from "./client.js";
import {
  getOpencodeApiVersion,
  readLocalOpencodeVersion,
  type LocalOpencodeTarget,
} from "./process.js";
import {
  classifyFailedHealthCheck,
  describeServerUrl,
  reportFailedHealthCause,
  reportOpencodeProblem,
  type ProblemReportMode,
} from "./server-health.js";
import {
  getConfiguredOpencodeServer,
  isOnConfiguredOpencodeServer,
  switchOpencodeServer,
  type OpencodeServerTarget,
} from "./server-target.js";

/**
 * What to do about an active OpenCode server that failed its health check:
 * - `answers`: the active server, or the configured one again, answers after all;
 * - `connected`: the bot now talks to the registered V2 server at `url`;
 * - `start`: start a local server for the configured URL;
 * - `refuse`: neither; the reason is in the log.
 */
export type UnavailableOpencodeServerResolution =
  | { kind: "answers"; version: string }
  | { kind: "connected"; url: string; version: string }
  | { kind: "start" }
  | { kind: "refuse" };

type RegisteredServerLookup =
  | { kind: "none" }
  | { kind: "unusable" }
  | { kind: "found"; server: OpencodeServerTarget; version: string };

function getUrlPort(url: string): number | null {
  try {
    const parsedUrl = new URL(url);
    const port = Number.parseInt(parsedUrl.port, 10);
    return Number.isInteger(port) ? port : null;
  } catch {
    return null;
  }
}

/** The OpenCode V2 background server registered on another port, checked with its own credentials. */
async function findRegisteredServerOnAnotherPort(
  target: LocalOpencodeTarget,
  mode: ProblemReportMode,
): Promise<RegisteredServerLookup> {
  if (opencodeServerVersion !== "v2") {
    return { kind: "none" };
  }

  const registered = await findRegisteredOpencodeServer();
  if (!registered || getUrlPort(registered.url) === target.port) {
    return { kind: "none" };
  }

  const probe = await probeOpencodeServer("v2", registered);
  if (probe.kind === "found") {
    return { kind: "found", server: registered, version: probe.serverVersion };
  }

  const problem =
    probe.kind === "unauthorized"
      ? "rejected the credentials from the OpenCode registry"
      : "did not answer as an OpenCode v2 server";
  reportOpencodeProblem(`registered:${registered.url}`, mode, () =>
    logger.error(
      `[OpenCode] Not connecting to the registered OpenCode v2 background server at ${describeServerUrl(registered)}: it ${problem}. Not starting another local server either, since that would replace it; stop that server (opencode service stop) or fix it.`,
    ),
  );
  return { kind: "unusable" };
}

/** Refuses when the local `opencode` executable is a release of the other API version. */
async function isBlockedByExecutableVersion(mode: ProblemReportMode): Promise<boolean> {
  const executableVersion = await readLocalOpencodeVersion();
  if (!executableVersion) {
    return false;
  }

  const executableApiVersion = getOpencodeApiVersion(executableVersion);
  if (executableApiVersion === opencodeServerVersion) {
    return false;
  }

  reportOpencodeProblem(`executable:${executableVersion}`, mode, () =>
    logger.error(
      `[OpenCode] Server version mismatch: OPENCODE_SERVER_VERSION=${opencodeServerVersion}, but the local opencode executable is OpenCode ${executableVersion} (API ${executableApiVersion}). Set OPENCODE_SERVER_VERSION=${executableApiVersion} and restart the bot, or make an OpenCode ${opencodeServerVersion} opencode executable the first one on PATH.`,
    ),
  );
  return true;
}

/**
 * Decides what to do after the active OpenCode server failed its health check, in this
 * order: the active server, the configured one when the bot is switched away from it, the
 * configured address's failure cause, the registered V2 server on another port, and the
 * local `opencode` executable. The bot is switched only to a server that has just answered,
 * or to the configured one right before a start; every refusal is explained in the log.
 */
export async function resolveUnavailableOpencodeServer(
  target: LocalOpencodeTarget,
  mode: ProblemReportMode,
): Promise<UnavailableOpencodeServerResolution> {
  const active = await probeOpencodeServer(opencodeServerVersion);
  if (active.kind === "found") {
    return { kind: "answers", version: active.serverVersion };
  }

  const configured = getConfiguredOpencodeServer();
  if (!isOnConfiguredOpencodeServer()) {
    const configuredProbe = await probeOpencodeServer(opencodeServerVersion, configured);
    if (configuredProbe.kind === "found") {
      switchOpencodeServer(null);
      return { kind: "answers", version: configuredProbe.serverVersion };
    }
  }

  const cause = await classifyFailedHealthCheck(configured);
  if (cause.kind !== "unknown") {
    reportFailedHealthCause(cause, mode, configured);
    return { kind: "refuse" };
  }

  const registered = await findRegisteredServerOnAnotherPort(target, mode);
  if (registered.kind === "found") {
    switchOpencodeServer(registered.server);
    return { kind: "connected", url: registered.server.url, version: registered.version };
  }
  if (registered.kind === "unusable" || (await isBlockedByExecutableVersion(mode))) {
    return { kind: "refuse" };
  }

  switchOpencodeServer(null);
  return { kind: "start" };
}
