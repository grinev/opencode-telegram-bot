import type { McpStatus } from "@opencode-ai/sdk/v2";
import { opencodeClient } from "../../opencode/client.js";

export interface McpCatalogServerItem {
  name: string;
  status: McpStatus;
}

function normalizeDirectoryForMcpApi(directory: string): string {
  return directory.replace(/\\/g, "/");
}

function parseMcpCatalogServers(value: unknown): McpCatalogServerItem[] | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (Array.isArray(value)) {
    const servers: McpCatalogServerItem[] = [];
    for (const item of value) {
      if (!item || typeof item !== "object") {
        return null;
      }

      const name = (item as { name?: unknown }).name;
      const status = (item as { status?: unknown }).status;
      if (typeof name !== "string" || !status || typeof status !== "object") {
        return null;
      }

      const s = status as { status?: unknown; error?: unknown };
      if (typeof s.status !== "string") {
        return null;
      }

      const mcpStatus: McpStatus = { status: s.status } as McpStatus;
      if ("error" in s && typeof s.error === "string") {
        (mcpStatus as McpStatus & { error: string }).error = s.error;
      }

      servers.push({ name, status: mcpStatus });
    }

    return servers;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const servers: McpCatalogServerItem[] = [];

  for (const [name, status] of entries) {
    if (!status || typeof status !== "object") {
      return null;
    }

    const s = status as { status?: unknown; error?: unknown };
    if (typeof s.status !== "string") {
      return null;
    }

    const mcpStatus: McpStatus = { status: s.status } as McpStatus;
    if ("error" in s && typeof s.error === "string") {
      (mcpStatus as McpStatus & { error: string }).error = s.error;
    }

    servers.push({ name, status: mcpStatus });
  }

  return servers;
}

export async function loadMcpCatalog(projectDirectory: string): Promise<McpCatalogServerItem[]> {
  const { data, error } = await opencodeClient.mcp.status({
    directory: normalizeDirectoryForMcpApi(projectDirectory),
  });

  if (error || !data) {
    throw error || new Error("No MCP status data received");
  }

  const servers = parseMcpCatalogServers(data);
  if (!servers) {
    throw new Error("Invalid MCP status data format");
  }

  return servers;
}

export async function toggleMcpCatalogServer(
  projectDirectory: string,
  serverName: string,
  enable: boolean,
): Promise<void> {
  const params = {
    name: serverName,
    directory: normalizeDirectoryForMcpApi(projectDirectory),
  };

  if (enable) {
    const { error } = await opencodeClient.mcp.connect(params);
    if (error) {
      throw error;
    }
    return;
  }

  const { error } = await opencodeClient.mcp.disconnect(params);
  if (error) {
    throw error;
  }
}
