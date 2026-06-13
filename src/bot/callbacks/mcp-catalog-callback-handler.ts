import type { Context } from "grammy";
import type { McpCatalogServerItem } from "../../app/services/mcp-catalog-service.js";
import {
  loadMcpCatalog,
  toggleMcpCatalogServer,
} from "../../app/services/mcp-catalog-service.js";
import { interactionManager } from "../../app/managers/interaction-manager.js";
import type { InteractionState } from "../../app/types/interaction.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import {
  buildMcpsDetailKeyboard,
  buildMcpsDetailText,
  buildMcpsListKeyboard,
  MCPS_CALLBACK_BACK,
  MCPS_CALLBACK_CANCEL,
  MCPS_CALLBACK_PREFIX,
  MCPS_CALLBACK_SELECT_PREFIX,
  MCPS_CALLBACK_TOGGLE,
  parseMcpSelectCallback,
} from "../menus/mcp-catalog-menu.js";

interface McpsListMetadata {
  flow: "mcps";
  stage: "list";
  messageId: number;
  projectDirectory: string;
  servers: McpCatalogServerItem[];
}

interface McpsDetailMetadata {
  flow: "mcps";
  stage: "detail";
  messageId: number;
  projectDirectory: string;
  serverName: string;
  servers: McpCatalogServerItem[];
}

type McpsMetadata = McpsListMetadata | McpsDetailMetadata;

function getCallbackMessageId(ctx: Context): number | null {
  const message = ctx.callbackQuery?.message;
  if (!message || !("message_id" in message)) {
    return null;
  }

  const messageId = (message as { message_id?: number }).message_id;
  return typeof messageId === "number" ? messageId : null;
}

function parseMcpsServers(value: unknown): McpCatalogServerItem[] | null {
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

      const mcpStatus = { status: s.status } as McpCatalogServerItem["status"];
      if ("error" in s && typeof s.error === "string") {
        (mcpStatus as McpCatalogServerItem["status"] & { error: string }).error = s.error;
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

    const mcpStatus = { status: s.status } as McpCatalogServerItem["status"];
    if ("error" in s && typeof s.error === "string") {
      (mcpStatus as McpCatalogServerItem["status"] & { error: string }).error = s.error;
    }

    servers.push({ name, status: mcpStatus });
  }

  return servers;
}

function parseMcpsMetadata(state: InteractionState | null): McpsMetadata | null {
  if (!state || state.kind !== "custom") {
    return null;
  }

  const flow = state.metadata.flow;
  const stage = state.metadata.stage;
  const messageId = state.metadata.messageId;
  const projectDirectory = state.metadata.projectDirectory;

  if (flow !== "mcps" || typeof messageId !== "number" || typeof projectDirectory !== "string") {
    return null;
  }

  const servers = parseMcpsServers(state.metadata.servers);
  if (!servers) {
    return null;
  }

  if (stage === "list") {
    return {
      flow,
      stage,
      messageId,
      projectDirectory,
      servers,
    };
  }

  if (stage === "detail") {
    const serverName = state.metadata.serverName;
    if (typeof serverName !== "string" || !serverName.trim()) {
      return null;
    }

    return {
      flow,
      stage,
      messageId,
      projectDirectory,
      serverName,
      servers,
    };
  }

  return null;
}

function clearMcpsInteraction(reason: string): void {
  const metadata = parseMcpsMetadata(interactionManager.getSnapshot());
  if (metadata) {
    interactionManager.clear(reason);
  }
}

export async function handleMcpsCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith(MCPS_CALLBACK_PREFIX)) {
    return false;
  }

  const metadata = parseMcpsMetadata(interactionManager.getSnapshot());
  const callbackMessageId = getCallbackMessageId(ctx);

  if (!metadata || callbackMessageId === null || metadata.messageId !== callbackMessageId) {
    await ctx.answerCallbackQuery({ text: t("inline.inactive_callback"), show_alert: true });
    return true;
  }

  try {
    if (data === MCPS_CALLBACK_CANCEL) {
      clearMcpsInteraction("mcps_cancelled");
      await ctx.answerCallbackQuery({ text: t("inline.cancelled_callback") });
      await ctx.deleteMessage().catch(() => {});
      return true;
    }

    if (data === MCPS_CALLBACK_BACK) {
      if (metadata.stage !== "detail") {
        await ctx.answerCallbackQuery({ text: t("callback.processing_error"), show_alert: true });
        return true;
      }

      const servers = await loadMcpCatalog(metadata.projectDirectory);
      const keyboard = buildMcpsListKeyboard(servers);
      await ctx.editMessageText(t("mcps.select"), { reply_markup: keyboard });
      await ctx.answerCallbackQuery();

      interactionManager.transition({
        expectedInput: "callback",
        metadata: {
          flow: "mcps",
          stage: "list",
          messageId: metadata.messageId,
          projectDirectory: metadata.projectDirectory,
          servers,
        },
      });

      return true;
    }

    if (data === MCPS_CALLBACK_TOGGLE) {
      if (metadata.stage !== "detail") {
        await ctx.answerCallbackQuery({ text: t("callback.processing_error"), show_alert: true });
        return true;
      }

      const serverName = metadata.serverName;
      const server = metadata.servers.find((s) => s.name === serverName);
      if (!server) {
        await ctx.answerCallbackQuery({ text: t("inline.inactive_callback"), show_alert: true });
        return true;
      }

      const enable = server.status.status !== "connected";
      await ctx.answerCallbackQuery({ text: enable ? t("mcps.enabling") : t("mcps.disabling") });

      await toggleMcpCatalogServer(metadata.projectDirectory, serverName, enable);

      const updatedServers = await loadMcpCatalog(metadata.projectDirectory);
      const updatedServer = updatedServers.find((s) => s.name === serverName);
      if (!updatedServer) {
        await ctx.editMessageText(t("mcps.select"), {
          reply_markup: buildMcpsListKeyboard(updatedServers),
        });
        interactionManager.transition({
          expectedInput: "callback",
          metadata: {
            flow: "mcps",
            stage: "list",
            messageId: metadata.messageId,
            projectDirectory: metadata.projectDirectory,
            servers: updatedServers,
          },
        });
        return true;
      }

      await ctx.editMessageText(buildMcpsDetailText(updatedServer), {
        reply_markup: buildMcpsDetailKeyboard(updatedServer),
      });

      interactionManager.transition({
        expectedInput: "callback",
        metadata: {
          flow: "mcps",
          stage: "detail",
          messageId: metadata.messageId,
          projectDirectory: metadata.projectDirectory,
          serverName: updatedServer.name,
          servers: updatedServers,
        },
      });

      return true;
    }

    if (data.startsWith(MCPS_CALLBACK_SELECT_PREFIX)) {
      if (metadata.stage !== "list") {
        await ctx.answerCallbackQuery({ text: t("callback.processing_error"), show_alert: true });
        return true;
      }

      const serverIndex = parseMcpSelectCallback(data);
      const server = serverIndex === null ? undefined : metadata.servers[serverIndex];
      if (!server) {
        await ctx.answerCallbackQuery({ text: t("inline.inactive_callback"), show_alert: true });
        return true;
      }

      await ctx.answerCallbackQuery();
      await ctx.editMessageText(buildMcpsDetailText(server), {
        reply_markup: buildMcpsDetailKeyboard(server),
      });

      interactionManager.transition({
        expectedInput: "callback",
        metadata: {
          flow: "mcps",
          stage: "detail",
          messageId: metadata.messageId,
          projectDirectory: metadata.projectDirectory,
          serverName: server.name,
          servers: metadata.servers,
        },
      });

      return true;
    }

    await ctx.answerCallbackQuery({ text: t("callback.unknown_command") });
    return true;
  } catch (error) {
    logger.error("[Mcps] Error handling MCP callback:", error);
    clearMcpsInteraction("mcps_callback_error");
    await ctx.answerCallbackQuery({ text: t("mcps.toggle_error") }).catch(() => {});
    return true;
  }
}
