import type { McpStatus } from "@opencode-ai/sdk/v2";
import { InlineKeyboard } from "grammy";
import type { McpCatalogServerItem } from "../../app/services/mcp-catalog-service.js";
import { t } from "../../i18n/index.js";

export const MCPS_CALLBACK_PREFIX = "mcps:";
export const MCPS_CALLBACK_SELECT_PREFIX = `${MCPS_CALLBACK_PREFIX}select:`;
export const MCPS_CALLBACK_TOGGLE = `${MCPS_CALLBACK_PREFIX}toggle`;
export const MCPS_CALLBACK_BACK = `${MCPS_CALLBACK_PREFIX}back`;
export const MCPS_CALLBACK_CANCEL = `${MCPS_CALLBACK_PREFIX}cancel`;

const MAX_INLINE_BUTTON_LABEL_LENGTH = 64;

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

function formatMcpButtonLabel(server: McpCatalogServerItem): string {
  const rawLabel = `${getStatusEmoji(server.status)} ${server.name}`;

  if (rawLabel.length <= MAX_INLINE_BUTTON_LABEL_LENGTH) {
    return rawLabel;
  }

  return `${rawLabel.slice(0, MAX_INLINE_BUTTON_LABEL_LENGTH - 3)}...`;
}

export function parseMcpSelectCallback(data: string): number | null {
  if (!data.startsWith(MCPS_CALLBACK_SELECT_PREFIX)) {
    return null;
  }

  const index = Number(data.slice(MCPS_CALLBACK_SELECT_PREFIX.length));
  if (!Number.isInteger(index) || index < 0) {
    return null;
  }

  return index;
}

export function buildMcpsListKeyboard(servers: McpCatalogServerItem[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  servers.forEach((server, index) => {
    keyboard.text(formatMcpButtonLabel(server), `${MCPS_CALLBACK_SELECT_PREFIX}${index}`).row();
  });

  keyboard.text(t("inline.button.cancel"), MCPS_CALLBACK_CANCEL);
  return keyboard;
}

export function buildMcpsDetailKeyboard(server: McpCatalogServerItem): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  let hasToggleButton = false;

  if (server.status.status === "connected") {
    keyboard.text(t("mcps.button.disable"), MCPS_CALLBACK_TOGGLE);
    hasToggleButton = true;
  } else if (server.status.status === "disabled" || server.status.status === "failed") {
    keyboard.text(t("mcps.button.enable"), MCPS_CALLBACK_TOGGLE);
    hasToggleButton = true;
  }

  if (hasToggleButton) {
    keyboard.row();
  }

  keyboard.text(t("mcps.button.back"), MCPS_CALLBACK_BACK);
  keyboard.text(t("inline.button.cancel"), MCPS_CALLBACK_CANCEL);

  return keyboard;
}

export function buildMcpsDetailText(server: McpCatalogServerItem): string {
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
