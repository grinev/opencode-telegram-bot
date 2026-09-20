import type { McpStatus } from "@opencode-ai/sdk/v2";
import { directApi } from "../../opencode/client.js";
import { logger } from "../../utils/logger.js";
import { isRecord } from "../../utils/type-guards.js";

export interface McpCatalogServerItem {
  name: string;
  status: McpStatus;
}

const MCP_STATUS_NAMES = [
  "connected",
  "disabled",
  "failed",
  "needs_auth",
  "needs_client_registration",
] as const;

function isMcpStatusName(value: unknown): value is (typeof MCP_STATUS_NAMES)[number] {
  return typeof value === "string" && MCP_STATUS_NAMES.some((name) => name === value);
}

function buildMcpStatus(statusValue: (typeof MCP_STATUS_NAMES)[number], errorValue: unknown): McpStatus {
  if (statusValue === "failed" || statusValue === "needs_client_registration") {
    // The SDK type requires an error string on these states; a missing one is
    // normalized to an empty string (falsy for display purposes).
    return { status: statusValue, error: typeof errorValue === "string" ? errorValue : "" };
  }

  return { status: statusValue };
}

type ParsedMcpServerStatus =
  | { kind: "ok"; status: McpStatus }
  | { kind: "skip" }
  | { kind: "invalid" };

function parseMcpServerStatus(status: unknown): ParsedMcpServerStatus {
  if (!isRecord(status)) {
    return { kind: "invalid" };
  }

  if (!isMcpStatusName(status.status)) {
    if (typeof status.status === "string") {
      // Unknown status value: the SDK union is stale (server drifted). Skip the
      // server instead of failing the whole catalog.
      logger.debug(`[McpCatalog] Unknown MCP status "${status.status}", skipping server`);
      return { kind: "skip" };
    }

    return { kind: "invalid" };
  }

  return { kind: "ok", status: buildMcpStatus(status.status, status.error) };
}

export function parseMcpCatalogServers(value: unknown): McpCatalogServerItem[] | null {
  if (!isRecord(value)) {
    return null;
  }

  if (Array.isArray(value)) {
    const servers: McpCatalogServerItem[] = [];
    for (const item of value) {
      if (!isRecord(item)) {
        return null;
      }

      const name = item.name;
      if (typeof name !== "string") {
        return null;
      }

      const parsed = parseMcpServerStatus(item.status);
      if (parsed.kind === "invalid") {
        return null;
      }
      if (parsed.kind === "skip") {
        continue;
      }

      servers.push({ name, status: parsed.status });
    }

    return servers;
  }

  const servers: McpCatalogServerItem[] = [];

  for (const [name, statusValue] of Object.entries(value)) {
    const parsed = parseMcpServerStatus(statusValue);
    if (parsed.kind === "invalid") {
      return null;
    }
    if (parsed.kind === "skip") {
      continue;
    }

    servers.push({ name, status: parsed.status });
  }

  return servers;
}

export async function loadMcpCatalog(_projectDirectory: string): Promise<McpCatalogServerItem[]> {
  // v2: GET /api/mcp -> { location, data: [{ name, status, ... }] }
  const { data, error } = await directApi<{ data: unknown }>("GET", "/api/mcp");

  if (error || !data) {
    throw error || new Error("No MCP status data received");
  }

  const servers = parseMcpCatalogServers(data.data);
  if (!servers) {
    throw new Error("Invalid MCP status data format");
  }

  return servers;
}

export async function toggleMcpCatalogServer(
  _projectDirectory: string,
  serverName: string,
  enable: boolean,
): Promise<void> {
  // v2: POST /api/experimental/mcp/{server}/connect|disconnect
  const action = enable ? "connect" : "disconnect";
  const { error } = await directApi(
    "POST",
    `/api/experimental/mcp/${encodeURIComponent(serverName)}/${action}`,
  );
  if (error) {
    throw error;
  }
}
