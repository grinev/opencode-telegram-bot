import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import { config, type OpencodeServerVersion } from "../config.js";
import { getActiveOpencodeServer, type OpencodeServerTarget } from "./server-target.js";
import {
  createV2OpencodeClient,
  findRegisteredV2Server,
  type RegisteredV2Server,
  type V2ClientExtension,
} from "./v2/client.js";

const PROBE_TIMEOUT_MS = 5000;

const getAuth = (server: OpencodeServerTarget) => {
  if (!server.password) {
    return undefined;
  }
  const credentials = `${server.username ?? ""}:${server.password}`;
  return `Basic ${Buffer.from(credentials).toString("base64")}`;
};

const authHeaders = (
  server: OpencodeServerTarget = getActiveOpencodeServer(),
): Record<string, string> | undefined => {
  const auth = getAuth(server);
  return auth ? { Authorization: auth } : undefined;
};

/** The API version the bot was configured for; there is no detection or switching. */
export const opencodeServerVersion: OpencodeServerVersion =
  config.opencode.serverVersion === "v2" ? "v2" : "v1";

function createClient() {
  if (opencodeServerVersion === "v2") {
    // Read on every request, so the client follows a switch to another server.
    return createV2OpencodeClient({
      get baseUrl() {
        return getActiveOpencodeServer().url;
      },
      get headers() {
        return authHeaders() ?? {};
      },
    });
  }
  return createOpencodeClient({
    baseUrl: config.opencode.apiUrl,
    headers: authHeaders(),
  });
}

export const opencodeClient = createClient();

/** The V2-only operations of the same client; use only when `opencodeServerVersion` is "v2". */
export const opencodeV2Client = opencodeClient as unknown as V2ClientExtension;

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
 * Asks a server (by default the active one) whether it answers the given API version, with
 * that server's credentials.
 */
export async function probeOpencodeServer(
  version: OpencodeServerVersion,
  server: OpencodeServerTarget = getActiveOpencodeServer(),
): Promise<OpencodeServerProbe> {
  const baseUrl = server.url.endsWith("/") ? server.url : `${server.url}/`;
  try {
    const headers = authHeaders(server);
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

/** The registered OpenCode V2 background server and its credentials, or null when none answers. */
export async function findRegisteredOpencodeServer(): Promise<RegisteredV2Server | null> {
  return findRegisteredV2Server();
}
