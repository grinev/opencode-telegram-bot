import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import { config, type OpencodeServerVersion } from "../config.js";
import { createV2OpencodeClient } from "./v2/client.js";

const PROBE_TIMEOUT_MS = 5000;

const getAuth = () => {
  if (!config.opencode.password) {
    return undefined;
  }
  const credentials = `${config.opencode.username}:${config.opencode.password}`;
  return `Basic ${Buffer.from(credentials).toString("base64")}`;
};

const authHeaders = (): Record<string, string> | undefined => {
  const auth = getAuth();
  return auth ? { Authorization: auth } : undefined;
};

/** The API version the bot was configured for; there is no detection or switching. */
export const opencodeServerVersion: OpencodeServerVersion =
  config.opencode.serverVersion === "v2" ? "v2" : "v1";

function createClient() {
  const headers = authHeaders();
  if (opencodeServerVersion === "v2") {
    return createV2OpencodeClient({
      baseUrl: config.opencode.apiUrl,
      ...(headers ? { headers } : {}),
    });
  }
  return createOpencodeClient({
    baseUrl: config.opencode.apiUrl,
    headers,
  });
}

export const opencodeClient = createClient();

export type OpencodeServerProbe =
  | { kind: "found"; version: OpencodeServerVersion; serverVersion: string }
  | { kind: "unauthorized" }
  | { kind: "none" };

const PROBE_ROUTES: Record<OpencodeServerVersion, string> = {
  v1: "global/health",
  v2: "api/info",
};

function readServerVersion(version: OpencodeServerVersion, body: unknown): string | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const record = body as Record<string, unknown>;
  if (typeof record.version !== "string") {
    return null;
  }
  if (version === "v1") {
    return record.healthy === true ? record.version : null;
  }
  return typeof record.pid === "number" ? record.version : null;
}

/**
 * Asks the configured URL whether it answers the given API version, with the configured
 * credentials. Used to explain a failed health check, never to switch clients.
 */
export async function probeOpencodeServer(
  version: OpencodeServerVersion,
): Promise<OpencodeServerProbe> {
  const baseUrl = config.opencode.apiUrl.endsWith("/")
    ? config.opencode.apiUrl
    : `${config.opencode.apiUrl}/`;
  try {
    const headers = authHeaders();
    const response = await fetch(new URL(PROBE_ROUTES[version], baseUrl), {
      ...(headers ? { headers } : {}),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (response.status === 401) {
      return { kind: "unauthorized" };
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.includes("json")) {
      return { kind: "none" };
    }
    const serverVersion = readServerVersion(version, await response.json());
    return serverVersion ? { kind: "found", version, serverVersion } : { kind: "none" };
  } catch {
    return { kind: "none" };
  }
}
