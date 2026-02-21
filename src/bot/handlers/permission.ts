import { Context, InlineKeyboard } from "grammy";
import { permissionManager } from "../../permission/manager.js";
import { opencodeClient } from "../../opencode/client.js";
import { getCurrentProject } from "../../settings/manager.js";
import { getCurrentSession } from "../../session/manager.js";
import { summaryAggregator } from "../../summary/aggregator.js";
import { interactionManager } from "../../interaction/manager.js";
import { logger } from "../../utils/logger.js";
import { safeBackgroundTask } from "../../utils/safe-background-task.js";
import { PermissionRequest, PermissionReply } from "../../permission/types.js";
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
};

function getCallbackMessageId(ctx: Context): number | null {
  const message = ctx.callbackQuery?.message;
  if (!message || !("message_id" in message)) {
    return null;
  }

  const messageId = (message as { message_id?: number }).message_id;
  return typeof messageId === "number" ? messageId : null;
}

function clearPermissionInteraction(reason: string): void {
  const state = interactionManager.getSnapshot();
  if (state?.kind === "permission") {
    interactionManager.clear(reason);
  }
}

function syncPermissionInteractionState(metadata: Record<string, unknown> = {}): void {
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

function isPermissionReply(value: string): value is PermissionReply {
  return value === "once" || value === "always" || value === "reject";
}

/**
 * Handle permission callback from inline buttons
 */
export async function handlePermissionCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data) return false;

  if (!data.startsWith("permission:")) {
    return false;
  }

  logger.debug(`[PermissionHandler] Received callback: ${data}`);

  if (!permissionManager.isActive()) {
    clearPermissionInteraction("permission_inactive_callback");
    await ctx.answerCallbackQuery({ text: t("permission.inactive_callback"), show_alert: true });
    return true;
  }

  const callbackMessageId = getCallbackMessageId(ctx);
  if (!permissionManager.isActiveMessage(callbackMessageId)) {
    await ctx.answerCallbackQuery({ text: t("permission.inactive_callback"), show_alert: true });
    return true;
  }

  const requestID = permissionManager.getRequestID(callbackMessageId);
  if (!requestID) {
    await ctx.answerCallbackQuery({ text: t("permission.inactive_callback"), show_alert: true });
    return true;
  }

  const parts = data.split(":");
  const action = parts[1];

  if (!isPermissionReply(action)) {
    await ctx.answerCallbackQuery({
      text: t("permission.processing_error_callback"),
      show_alert: true,
    });
    return true;
  }

  try {
    await handlePermissionReply(ctx, action, requestID, callbackMessageId);
  } catch (err) {
    logger.error("[PermissionHandler] Error handling callback:", err);
    await ctx.answerCallbackQuery({
      text: t("permission.processing_error_callback"),
      show_alert: true,
    });
  }

  return true;
}

/**
 * Handle permission reply (once/always/reject)
 */
async function handlePermissionReply(
  ctx: Context,
  reply: PermissionReply,
  requestID: string,
  callbackMessageId: number | null,
): Promise<void> {
  const currentProject = getCurrentProject();
  const currentSession = getCurrentSession();
  const chatId = ctx.chat?.id;
  const directory = currentSession?.directory ?? currentProject?.worktree;

  if (!directory || !chatId) {
    permissionManager.clear();
    clearPermissionInteraction("permission_invalid_runtime_context");

    await ctx.answerCallbackQuery({
      text: t("permission.no_active_request_callback"),
      show_alert: true,
    });
    return;
  }

  // Reply labels for user feedback
  const replyLabels: Record<PermissionReply, string> = {
    once: t("permission.reply.once"),
    always: t("permission.reply.always"),
    reject: t("permission.reply.reject"),
  };

  await ctx.answerCallbackQuery({ text: replyLabels[reply] });

  // Delete the permission message
  await ctx.deleteMessage().catch(() => {});

  // Stop typing indicator since we're responding
  summaryAggregator.stopTypingIndicator();

  logger.info(`[PermissionHandler] Sending permission reply: ${reply}, requestID=${requestID}`);

  // CRITICAL: Fire-and-forget! Do not block the handler
  safeBackgroundTask({
    taskName: "permission.reply",
    task: () =>
      opencodeClient.permission.reply({
        requestID,
        directory,
        reply,
      }),
    onSuccess: ({ error }) => {
      if (error) {
        logger.error("[PermissionHandler] Failed to send permission reply:", error);
        if (ctx.api && chatId) {
          void ctx.api.sendMessage(chatId, t("permission.send_reply_error")).catch(() => {});
        }
        return;
      }

      logger.info("[PermissionHandler] Permission reply sent successfully");
    },
  });

  permissionManager.removeByMessageId(callbackMessageId);

  if (!permissionManager.isActive()) {
    clearPermissionInteraction("permission_replied");
    return;
  }

  syncPermissionInteractionState({
    lastRepliedRequestID: requestID,
  });
}

/**
 * Show permission request message with inline buttons
 */
export async function showPermissionRequest(
  bot: Context["api"],
  chatId: number,
  request: PermissionRequest,
): Promise<void> {
  logger.debug(`[PermissionHandler] Showing permission request: ${request.permission}`);

  const text = formatPermissionText(request);
  const keyboard = buildPermissionKeyboard();

  try {
    const message = await bot.sendMessage(chatId, text, {
      reply_markup: keyboard,
      parse_mode: "Markdown",
    });

    logger.debug(`[PermissionHandler] Message sent, messageId=${message.message_id}`);
    permissionManager.startPermission(request, message.message_id);

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
      // Escape backticks for Markdown code
      const escapedPattern = pattern.replace(/`/g, "\\`");
      text += `\`${escapedPattern}\`\n`;
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
