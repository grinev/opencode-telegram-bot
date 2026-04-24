import { CommandContext, Context, InlineKeyboard } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { getCurrentProject } from "../../settings/manager.js";
import { interactionManager } from "../../interaction/manager.js";
import type { InteractionState } from "../../interaction/types.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import type { McpStatus } from "@opencode-ai/sdk/v2";

const MCPS_CALLBACK_PREFIX = "mcps:";
const MCPS_CALLBACK_SELECT_PREFIX = `${MCPS_CALLBACK_PREFIX}select:`;
const MCPS_CALLBACK_TOGGLE_PREFIX = `${MCPS_CALLBACK_PREFIX}toggle:`;
const MCPS_CALLBACK_BACK = `${MCPS_CALLBACK_PREFIX}back`;
const MCPS_CALLBACK_CANCEL = `${MCPS_CALLBACK_PREFIX}cancel`;
const MAX_INLINE_BUTTON_LABEL_LENGTH = 64;

interface McpServerItem {
  name: string;
  status: McpStatus;
}

interface McpsListMetadata {
  flow: "mcps";
  stage: "list";
  messageId: number;
  projectDirectory: string;
  servers: McpServerItem[];
}

interface McpsDetailMetadata {
  flow: "mcps";
  stage: "detail";
  messageId: number;
  projectDirectory: string;
  serverName: string;
  servers: McpServerItem[];
}

type McpsMetadata = McpsListMetadata | McpsDetailMetadata;

function normalizeDirectoryForApi(directory: string): string {
  return directory.replace(/\\/g, "/");
}

function getCallbackMessageId(ctx: Context): number | null {
  const message = ctx.callbackQuery?.message;
  if (!message || !("message_id" in message)) {
    return null;
  }

  const messageId = (message as { message_id?: number }).message_id;
  return typeof messageId === "number" ? messageId : null;
}

function getStatusLabel(status: McpStatus): string {
  switch (status.status) {
    case "connected":
      return t("mcps.status.connected");
    case "disabled":
      return t("mcps.status.disabled");
    case "failed":
      return t("mcps.status.failed");
    case "needs_auth":
      return t("mcps.status.needs_auth");
    case "needs_client_registration":
      return t("mcps.status.needs_client_registration");
    default:
      return t("common.unknown");
  }
}

function getStatusEmoji(status: McpStatus): string {
  switch (status.status) {
    case "connected":
      return "🟢";
    case "disabled":
      return "🔴";
    case "failed":
      return "⚠️";
    case "needs_auth":
      return "🔒";
    case "needs_client_registration":
      return "🔒";
    default:
      return "❓";
  }
}

function formatMcpButtonLabel(server: McpServerItem): string {
  const rawLabel = `${getStatusEmoji(server.status)} ${server.name}`;

  if (rawLabel.length <= MAX_INLINE_BUTTON_LABEL_LENGTH) {
    return rawLabel;
  }

  return `${rawLabel.slice(0, MAX_INLINE_BUTTON_LABEL_LENGTH - 3)}...`;
}

function buildMcpsListKeyboard(servers: McpServerItem[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  servers.forEach((server) => {
    keyboard
      .text(formatMcpButtonLabel(server), `${MCPS_CALLBACK_SELECT_PREFIX}${server.name}`)
      .row();
  });

  keyboard.text(t("inline.button.cancel"), MCPS_CALLBACK_CANCEL);
  return keyboard;
}

function buildMcpsDetailKeyboard(server: McpServerItem): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  if (server.status.status === "connected") {
    keyboard.text(t("mcps.button.disable"), `${MCPS_CALLBACK_TOGGLE_PREFIX}${server.name}`);
  } else if (server.status.status === "disabled" || server.status.status === "failed") {
    keyboard.text(t("mcps.button.enable"), `${MCPS_CALLBACK_TOGGLE_PREFIX}${server.name}`);
  }

  keyboard.row();
  keyboard.text(t("mcps.button.back"), MCPS_CALLBACK_BACK);
  keyboard.text(t("inline.button.cancel"), MCPS_CALLBACK_CANCEL);

  return keyboard;
}

function buildMcpsDetailText(server: McpServerItem): string {
  const lines: string[] = [];
  lines.push(t("mcps.detail.title", { name: server.name }));
  lines.push("");
  lines.push(t("mcps.detail.status", { status: getStatusLabel(server.status) }));

  if (server.status.status === "failed" || server.status.status === "needs_client_registration") {
    lines.push(t("mcps.detail.error", { error: server.status.error }));
  }

  if (server.status.status === "needs_auth" || server.status.status === "needs_client_registration") {
    lines.push("");
    lines.push(t("mcps.auth_required"));
  }

  return lines.join("\n");
}

function parseMcpsServers(value: unknown): McpServerItem[] | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (Array.isArray(value)) {
    const servers: McpServerItem[] = [];
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
  const servers: McpServerItem[] = [];

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

async function getMcpServerList(projectDirectory: string): Promise<McpServerItem[]> {
  const { data, error } = await opencodeClient.mcp.status({
    directory: normalizeDirectoryForApi(projectDirectory),
  });

  if (error || !data) {
    throw error || new Error("No MCP status data received");
  }

  const servers = parseMcpsServers(data);
  if (!servers) {
    throw new Error("Invalid MCP status data format");
  }

  return servers;
}

async function toggleMcpServer(
  projectDirectory: string,
  serverName: string,
  enable: boolean,
): Promise<void> {
  const params = {
    name: serverName,
    directory: normalizeDirectoryForApi(projectDirectory),
  };

  if (enable) {
    const { error } = await opencodeClient.mcp.connect(params);
    if (error) {
      throw error;
    }
  } else {
    const { error } = await opencodeClient.mcp.disconnect(params);
    if (error) {
      throw error;
    }
  }
}

export async function mcpsCommand(ctx: CommandContext<Context>): Promise<void> {
  try {
    const currentProject = getCurrentProject();
    if (!currentProject) {
      await ctx.reply(t("bot.project_not_selected"));
      return;
    }

    const servers = await getMcpServerList(currentProject.worktree);
    if (servers.length === 0) {
      await ctx.reply(t("mcps.empty"));
      return;
    }

    const keyboard = buildMcpsListKeyboard(servers);
    const message = await ctx.reply(t("mcps.select"), {
      reply_markup: keyboard,
    });

    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "mcps",
        stage: "list",
        messageId: message.message_id,
        projectDirectory: currentProject.worktree,
        servers,
      },
    });
  } catch (error) {
    logger.error("[Mcps] Error fetching MCP servers list:", error);
    await ctx.reply(t("mcps.fetch_error"));
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

      const servers = await getMcpServerList(metadata.projectDirectory);
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

    if (data.startsWith(MCPS_CALLBACK_TOGGLE_PREFIX)) {
      if (metadata.stage !== "detail") {
        await ctx.answerCallbackQuery({ text: t("callback.processing_error"), show_alert: true });
        return true;
      }

      const serverName = data.slice(MCPS_CALLBACK_TOGGLE_PREFIX.length);
      const server = metadata.servers.find((s) => s.name === serverName);
      if (!server) {
        await ctx.answerCallbackQuery({ text: t("inline.inactive_callback"), show_alert: true });
        return true;
      }

      const enable = server.status.status !== "connected";
      await ctx.answerCallbackQuery({ text: enable ? t("mcps.enabling") : t("mcps.disabling") });

      await toggleMcpServer(metadata.projectDirectory, serverName, enable);

      const updatedServers = await getMcpServerList(metadata.projectDirectory);
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

      const serverName = data.slice(MCPS_CALLBACK_SELECT_PREFIX.length);
      const server = metadata.servers.find((s) => s.name === serverName);
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
