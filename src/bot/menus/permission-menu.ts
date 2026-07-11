import { Context, InlineKeyboard } from "grammy";
import { permissionManager } from "../../app/managers/permission-manager.js";
import { summaryAggregator } from "../../app/managers/summary-aggregation-manager.js";
import { interactionManager } from "../../app/managers/interaction-manager.js";
import { logger } from "../../utils/logger.js";
import type { PermissionRequest } from "../../app/types/permission.js";
import type { I18nKey } from "../../i18n/en.js";
import { t } from "../../i18n/index.js";

// Permission type display names
const PERMISSION_NAME_KEYS: Record<string, I18nKey> = {
  bash: "permission.name.bash",
  edit: "permission.name.edit",
  write: "permission.name.write",
  read: "permission.name.read",
  webfetch: "permission.name.webfetch",
  websearch: "permission.name.websearch",
  glob: "permission.name.glob",
  grep: "permission.name.grep",
  list: "permission.name.list",
  task: "permission.name.task",
  lsp: "permission.name.lsp",
  external_directory: "permission.name.external_directory",
};

// Permission type emojis
const PERMISSION_EMOJIS: Record<string, string> = {
  bash: "⚡",
  edit: "✏️",
  write: "📝",
  read: "📖",
  webfetch: "🌐",
  websearch: "🔍",
  glob: "📁",
  grep: "🔎",
  list: "📂",
  task: "⚙️",
  lsp: "🔧",
  external_directory: "📁",
};

export function clearPermissionInteraction(reason: string): void {
  const state = interactionManager.getSnapshot();
  if (state?.kind === "permission") {
    interactionManager.clear(reason);
  }
}

export function syncPermissionInteractionState(metadata: Record<string, unknown> = {}): void {
  const pendingCount = permissionManager.getPendingCount();

  if (pendingCount === 0) {
    clearPermissionInteraction("permission_no_pending_requests");
    return;
  }

  const nextMetadata: Record<string, unknown> = {
    pendingCount,
    ...metadata,
  };

  const state = interactionManager.getSnapshot();
  if (state?.kind === "permission") {
    interactionManager.transition({
      expectedInput: "callback",
      metadata: nextMetadata,
    });
    return;
  }

  interactionManager.start({
    kind: "permission",
    expectedInput: "callback",
    metadata: nextMetadata,
  });
}

/**
 * Show permission request message with inline buttons
 */
export async function showPermissionRequest(
  bot: Context["api"],
  chatId: number,
  request: PermissionRequest,
  generation: number = permissionManager.getGeneration(),
): Promise<void> {
  logger.debug(`[PermissionHandler] Showing permission request: ${request.permission}`);

  if (
    generation !== permissionManager.getGeneration() ||
    permissionManager.isResolved(request.id)
  ) {
    logger.debug(`[PermissionHandler] Skipping stale or already resolved request: ${request.id}`);
    return;
  }

  const text = formatPermissionText(request);
  const keyboard = buildPermissionKeyboard();

  try {
    const message = await bot.sendMessage(chatId, text, {
      reply_markup: keyboard,
    });

    logger.debug(`[PermissionHandler] Message sent, messageId=${message.message_id}`);
    if (!permissionManager.startPermission(request, message.message_id, generation)) {
      await bot.deleteMessage(chatId, message.message_id).catch((err) => {
        logger.warn(`[PermissionHandler] Failed to delete stale permission message:`, err);
      });
      return;
    }

    syncPermissionInteractionState({
      requestID: request.id,
      messageId: message.message_id,
    });

    summaryAggregator.stopTypingIndicator();
  } catch (err) {
    logger.error("[PermissionHandler] Failed to send permission message:", err);
    throw err;
  }
}

/**
 * Format permission request text
 */
function formatPermissionText(request: PermissionRequest): string {
  const emoji = PERMISSION_EMOJIS[request.permission] || "🔐";
  const nameKey = PERMISSION_NAME_KEYS[request.permission];
  const name = nameKey ? t(nameKey) : request.permission;

  let text = t("permission.header", { emoji, name });

  // Show patterns (commands/files)
  if (request.patterns.length > 0) {
    request.patterns.forEach((pattern) => {
      text += `• ${pattern}\n`;
    });
  }

  return text;
}

/**
 * Build inline keyboard with permission buttons
 */
function buildPermissionKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  keyboard.text(t("permission.button.allow"), "permission:once").row();
  keyboard.text(t("permission.button.always"), "permission:always").row();
  keyboard.text(t("permission.button.reject"), "permission:reject");

  return keyboard;
}
