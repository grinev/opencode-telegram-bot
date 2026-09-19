import { Bot, Context } from "grammy";
import { config } from "../config.js";
import { getCurrentProject } from "../app/stores/settings-store.js";
import type { AppContainer } from "../app/bootstrap/app-container.js";
import {
  configureAttachPresentation,
  restoreAttachedCurrentSession,
} from "../app/services/attach-service.js";
import { logger } from "../utils/logger.js";
import { safeBackgroundTask } from "../utils/safe-background-task.js";
import { withTelegramRateLimitRetry } from "../utils/telegram-rate-limit-retry.js";
import { telegramOutageNoticeService } from "../app/services/telegram-outage-notice-service.js";
import { flushTelegramOutageNotices, isUnretriedTelegramSend } from "./telegram-outage-notices.js";
import { LocalCommandRegistry } from "../app/services/local-command-registry.js";
import { registerCallbackRouter } from "./callbacks/callback-router.js";
import { initializePromptQueueDispatch } from "./handlers/prompt-queue-dispatch.js";
import { normalizeRichMessage } from "./handlers/rich-message-handler.js";
import { authMiddleware } from "./middleware/auth.js";
import { interactionGuardMiddleware } from "./middleware/interaction-guard.js";
import { staleUpdateMiddleware } from "./middleware/stale-update.js";
import {
  ensureCommandsInitialized,
  registerCommandRouter,
} from "./routers/command-router.js";
import { registerMessageRouter } from "./routers/message-router.js";
import { createAttachPresentation } from "./services/attach-presentation.js";
import { createTelegramBotOptions } from "./telegram-client-options.js";

const TRANSIENT_RETRY_SAFE_TELEGRAM_METHODS = new Set([
  "editMessageReplyMarkup",
  "editMessageText",
  "sendChatAction",
  "sendMessageDraft",
  "sendRichMessageDraft",
]);

const STARTUP_MANAGED_TELEGRAM_METHODS = new Set(["deleteWebhook", "getMe", "getWebhookInfo"]);

const CHAT_DELIVERY_TELEGRAM_METHODS = new Set([
  "sendMessage",
  "sendRichMessage",
  "editMessageText",
  "sendDocument",
  "sendAudio",
  "sendPhoto",
]);

interface TelegramApiErrorResponse {
  ok: false;
  error_code: number;
  description: string;
  parameters?: object;
}

class TelegramApiResponseError extends Error {
  constructor(readonly response: TelegramApiErrorResponse) {
    super(response.description ?? "Telegram API request failed");
    Object.assign(this, response);
  }
}

export function shouldRetryTelegramServerError(method: string): boolean {
  return TRANSIENT_RETRY_SAFE_TELEGRAM_METHODS.has(method);
}

function isTelegramApiErrorResponse(response: unknown): response is TelegramApiErrorResponse {
  return (
    typeof response === "object" &&
    response !== null &&
    Reflect.get(response, "ok") === false &&
    typeof Reflect.get(response, "error_code") === "number" &&
    typeof Reflect.get(response, "description") === "string"
  );
}

export function createBot(
  container: AppContainer,
  localCommandRegistry = LocalCommandRegistry.empty(),
): Bot<Context> {
  container.resetInteractions("bot_startup");
  container.attachManager.clear("bot_startup");
  container.resetRuntimeStreams("bot_startup");

  const botOptions = createTelegramBotOptions(config.telegram);
  const bot = new Bot(config.telegram.token, botOptions);

  configureAttachPresentation(createAttachPresentation());

  container.setTelegramContext(bot, config.telegram.allowedUserId);

  initializePromptQueueDispatch({
    bot,
    ensureEventSubscription: container.ensureEventSubscription,
  });

  container.setReadyRestoreHandler(async (reason) => {
    const restored = await restoreAttachedCurrentSession({
      bot,
      chatId: config.telegram.allowedUserId,
      ensureEventSubscription: container.ensureEventSubscription,
      forceFullRestore: true,
    });

    if (restored) {
      logger.info(`[Bot] Restored followed session after OpenCode ready: reason=${reason}`);
      return;
    }

    const currentProject = getCurrentProject();
    if (config.bot.trackBackgroundSessions && currentProject?.worktree) {
      await container.ensureEventSubscription(currentProject.worktree);
      logger.info(
        `[Bot] Started background session tracking after OpenCode ready: reason=${reason}, directory=${currentProject.worktree}`,
      );
    }
  });

  container.startHeartbeat();

  let lastGetUpdatesTime = Date.now();
  bot.api.config.use(async (prev, method, payload, signal) => {
    if (method === "getUpdates") {
      const now = Date.now();
      const timeSinceLast = now - lastGetUpdatesTime;
      logger.debug(`[Bot API] getUpdates called (${timeSinceLast}ms since last)`);
      lastGetUpdatesTime = now;
      return prev(method, payload, signal);
    }

    if (STARTUP_MANAGED_TELEGRAM_METHODS.has(method)) {
      return prev(method, payload, signal);
    }

    if (method === "sendMessage") {
      logger.debug(`[Bot API] sendMessage to chat ${(payload as { chat_id?: number }).chat_id}`);
    }

    try {
      const runCall = async () => {
        const response = await prev(method, payload, signal);
        if (isTelegramApiErrorResponse(response)) {
          throw new TelegramApiResponseError(response);
        }
        return response;
      };
      const response = isUnretriedTelegramSend()
        ? await runCall()
        : await withTelegramRateLimitRetry(runCall, {
            maxRetries: 5,
            retryTransientServerErrors: shouldRetryTelegramServerError(method),
            onRetry: ({ attempt, retryAfterMs, error }) => {
              logger.warn(
                `[Bot API] Retryable Telegram error on ${method}, retrying in ${retryAfterMs}ms (attempt=${attempt})`,
                error,
              );
            },
          });

      if (CHAT_DELIVERY_TELEGRAM_METHODS.has(method)) {
        const chatId = (payload as { chat_id?: number }).chat_id;
        if (typeof chatId === "number") {
          telegramOutageNoticeService.noteChatSendSucceeded();
          await flushTelegramOutageNotices({ api: bot.api, chatId });
        }
      }

      return response;
    } catch (error) {
      if (error instanceof TelegramApiResponseError) {
        return error.response;
      }
      throw error;
    }
  });

  bot.use((ctx, next) => {
    const hasCallbackQuery = !!ctx.callbackQuery;
    const hasMessage = !!ctx.message;
    const callbackData = ctx.callbackQuery?.data || "N/A";
    logger.debug(
      `[DEBUG] Incoming update: hasCallbackQuery=${hasCallbackQuery}, hasMessage=${hasMessage}, callbackData=${callbackData}`,
    );
    return next();
  });

  bot.use(authMiddleware);
  bot.use(staleUpdateMiddleware);
  bot.on("message:rich_message", normalizeRichMessage);
  bot.use((ctx, next) => ensureCommandsInitialized(ctx, next, localCommandRegistry));
  bot.use((ctx, next) => interactionGuardMiddleware(ctx, next, localCommandRegistry));

  registerCommandRouter(bot, { container, localCommandRegistry });
  registerCallbackRouter(bot, { container });
  registerMessageRouter(bot, { container });

  safeBackgroundTask({
    taskName: "bot.clearGlobalCommands",
    task: async () => {
      try {
        await Promise.all([
          bot.api.setMyCommands([], { scope: { type: "default" } }),
          bot.api.setMyCommands([], { scope: { type: "all_private_chats" } }),
        ]);
        return { success: true as const };
      } catch (error) {
        return { success: false as const, error };
      }
    },
    onSuccess: (result) => {
      if (result.success) {
        logger.debug("[Bot] Cleared global commands (default and all_private_chats scopes)");
        return;
      }

      logger.warn("[Bot] Could not clear global commands:", result.error);
    },
  });

  bot.catch((err) => {
    logger.error("[Bot] Unhandled error in bot:", err);
    container.resetInteractions("bot_unhandled_error");
    if (err.ctx) {
      logger.error(
        "[Bot] Error context - update type:",
        err.ctx.update ? Object.keys(err.ctx.update) : "unknown",
      );
    }
  });

  return bot;
}

export function restoreFollowedSessionOnPollingStart(
  bot: Bot<Context>,
  container: AppContainer,
): void {
  safeBackgroundTask({
    taskName: "bot.restoreAfterPollingStart",
    task: () =>
      restoreAttachedCurrentSession({
        bot,
        chatId: config.telegram.allowedUserId,
        ensureEventSubscription: container.ensureEventSubscription,
        forceFullRestore: true,
      }),
  });
}
