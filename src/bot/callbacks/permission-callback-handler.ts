import type { Context } from "grammy";
import { permissionManager } from "../../app/managers/permission-manager.js";
import type { PermissionReply } from "../../app/types/permission.js";
import { opencodeClient } from "../../opencode/client.js";
import { getCurrentProject } from "../../app/stores/settings-store.js";
import { getCurrentSession } from "../../app/services/session-service.js";
import { summaryAggregator } from "../../app/managers/summary-aggregation-manager.js";
import { clearPermissionInteraction, syncPermissionInteractionState } from "../menus/permission-menu.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { safeBackgroundTask } from "../../utils/safe-background-task.js";

function getCallbackMessageId(ctx: Context): number | null {
  const message = ctx.callbackQuery?.message;
  if (!message || !("message_id" in message)) {
    return null;
  }

  const messageId = (message as { message_id?: number }).message_id;
  return typeof messageId === "number" ? messageId : null;
}

function isPermissionReply(value: string): value is PermissionReply {
  return value === "once" || value === "always" || value === "reject";
}

function isPermissionRequestNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    _tag?: unknown;
    name?: unknown;
    message?: unknown;
    data?: { message?: unknown };
  };

  if (candidate._tag === "PermissionNotFoundError") {
    return true;
  }

  if (candidate.name === "NotFoundError") {
    return true;
  }

  return [candidate.message, candidate.data?.message].some(
    (message) =>
      typeof message === "string" && message.toLowerCase().includes("permission request not found"),
  );
}

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

  const requestIDs = permissionManager.getRequestIDs(callbackMessageId);
  if (requestIDs.length === 0) {
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
    await handlePermissionReply(ctx, action, requestIDs, callbackMessageId);
  } catch (err) {
    logger.error("[PermissionHandler] Error handling callback:", err);
    await ctx.answerCallbackQuery({
      text: t("permission.processing_error_callback"),
      show_alert: true,
    });
  }

  return true;
}

async function handlePermissionReply(
  ctx: Context,
  reply: PermissionReply,
  requestIDs: string[],
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

  const replyLabels: Record<PermissionReply, string> = {
    once: t("permission.reply.once"),
    always: t("permission.reply.always"),
    reject: t("permission.reply.reject"),
  };

  await ctx.answerCallbackQuery({ text: replyLabels[reply] });
  await ctx.deleteMessage().catch(() => {});

  summaryAggregator.stopTypingIndicator();

  logger.info(
    `[PermissionHandler] Sending permission reply: ${reply}, requestIDs=${requestIDs.join(",")}`,
  );

  safeBackgroundTask({
    taskName: "permission.reply",
    task: async () => {
      let firstError: unknown = null;
      let lastResponse: Awaited<ReturnType<typeof opencodeClient.permission.reply>> | null = null;

      for (const requestID of requestIDs) {
        const response = await opencodeClient.permission.reply({
          requestID,
          directory,
          reply,
        });
        lastResponse = response;

        if (!response.error) {
          continue;
        }

        if (requestIDs.length > 1 && isPermissionRequestNotFound(response.error)) {
          logger.debug(
            `[PermissionHandler] Ignoring duplicate permission reply miss: requestID=${requestID}`,
          );
          continue;
        }

        firstError ??= response.error;
      }

      return { ...lastResponse, error: firstError };
    },
    onSuccess: ({ error }) => {
      if (error) {
        if (isPermissionRequestNotFound(error)) {
          logger.debug(
            `[PermissionHandler] Permission request already resolved: requestIDs=${requestIDs.join(",")}`,
          );
          return;
        }

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
    lastRepliedRequestIDs: requestIDs,
  });
}
