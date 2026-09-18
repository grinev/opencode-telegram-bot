import fs from "node:fs/promises";
import { cleanupBotRuntime, createBot, restoreFollowedSessionOnPollingStart } from "../../bot/index.js";
import { createScheduledTaskDeliverySender } from "../../bot/messages/scheduled-task-delivery.js";
import { config } from "../../config.js";
import { opencodeAutoRestartService } from "../../opencode/auto-restart.js";
import { stopManagedServers } from "../../opencode/process.js";
import {
  notifyOpencodeReadyIfHealthy,
  registerOpenCodeReadyRefreshHandler,
} from "../../opencode/ready-refresh.js";
import { flushSettings, loadSettings } from "../stores/settings-store.js";
import { scheduledTaskRuntime } from "../services/scheduled-task-runtime-service.js";
import { LocalCommandRegistry } from "../services/local-command-registry.js";
import { BUILT_IN_COMMAND_NAMES } from "../../bot/commands/definitions.js";
import { reconcileStoredModelSelection } from "../services/model-selection-service.js";
import { getBotVersion } from "../../runtime/bot-version.js";
import { getRuntimeMode } from "../../runtime/mode.js";
import { getRuntimePaths } from "../../runtime/paths.js";
import { clearServiceStateFile } from "../../runtime/service/manager.js";
import { getServiceStateFilePathFromEnv, isServiceChildProcess } from "../../runtime/service/env.js";
import { flushLogger, getLogFilePath, initializeLogger, logger } from "../../utils/logger.js";
import { safeBackgroundTask } from "../../utils/safe-background-task.js";
import { getTelegramRetryAfterMs } from "../../utils/telegram-rate-limit-retry.js";

const SHUTDOWN_TIMEOUT_MS = 5000;
const SETTINGS_FLUSH_TIMEOUT_MS = 1000;
const LOG_FLUSH_TIMEOUT_MS = 1000;
const TELEGRAM_STARTUP_RETRY_BASE_MS = 1000;
const TELEGRAM_STARTUP_RETRY_CAP_MS = 60_000;
const TELEGRAM_FATAL_TOKEN_CODES = new Set([401, 404]);

function getTelegramErrorCode(error: unknown): number | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  const errorCode = Reflect.get(error, "error_code");
  if (typeof errorCode === "number" && Number.isFinite(errorCode)) {
    return errorCode;
  }

  return null;
}

function isFatalTelegramTokenError(error: unknown): boolean {
  const errorCode = getTelegramErrorCode(error);
  return errorCode !== null && TELEGRAM_FATAL_TOKEN_CODES.has(errorCode);
}

function isTelegramStartupServerError(error: unknown): boolean {
  const errorCode = getTelegramErrorCode(error);
  return errorCode !== null && errorCode >= 500 && errorCode < 600;
}

function isRetryableTelegramStartupError(error: unknown): boolean {
  if (isTelegramStartupServerError(error) || getTelegramRetryAfterMs(error) !== null) {
    return true;
  }

  if (typeof error === "object" && error !== null && Reflect.get(error, "name") === "HttpError") {
    return true;
  }

  if (error instanceof Error && /Network request for '.+' failed/i.test(error.message)) {
    return true;
  }

  return false;
}

function nextTelegramStartupRetryDelayMs(error: unknown, attempt: number): number {
  const exponentialMs = Math.min(
    TELEGRAM_STARTUP_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1),
    TELEGRAM_STARTUP_RETRY_CAP_MS,
  );
  const fromErrorMs = getTelegramRetryAfterMs(error, TELEGRAM_STARTUP_RETRY_BASE_MS, attempt - 1);
  if (fromErrorMs === null) {
    return exponentialMs;
  }

  return Math.min(Math.max(exponentialMs, fromErrorMs), TELEGRAM_STARTUP_RETRY_CAP_MS);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function callTelegramAtStartup<T>(
  label: string,
  operation: () => Promise<T>,
  isShutdown: () => boolean,
): Promise<T | "shutdown"> {
  let attempt = 0;

  while (true) {
    if (isShutdown()) {
      return "shutdown";
    }

    try {
      return await operation();
    } catch (error) {
      if (isShutdown()) {
        return "shutdown";
      }

      if (isFatalTelegramTokenError(error)) {
        logger.error("[App] Telegram rejected the bot token; not retrying", error);
        throw error;
      }

      if (!isRetryableTelegramStartupError(error)) {
        logger.error("[App] Telegram startup failed; not retrying", error);
        throw error;
      }

      attempt += 1;
      const delayMs = nextTelegramStartupRetryDelayMs(error, attempt);
      logger.warn(
        `[App] Telegram ${label} failed (attempt ${attempt}); retrying in ${delayMs}ms`,
        error,
      );
      await wait(delayMs);
    }
  }
}

export async function startBotApp(): Promise<void> {
  await initializeLogger();

  const mode = getRuntimeMode();
  const runtimePaths = getRuntimePaths();
  const version = await getBotVersion();
  const logFilePath = getLogFilePath();

  logger.info(`Starting OpenCode Telegram Bot v${version}...`);
  logger.info(`Node.js ${process.version} on ${process.platform} ${process.arch}`);
  logger.info(`Config loaded from ${runtimePaths.envFilePath}`);
  if (logFilePath) {
    logger.info(`Logs are written to ${logFilePath}`);
  }
  logger.info(`Allowed User ID: ${config.telegram.allowedUserId}`);
  logger.debug(`[Runtime] Application start mode: ${mode}`);

  let serviceStateCleared = false;

  const clearManagedServiceState = async (): Promise<void> => {
    if (!isServiceChildProcess() || serviceStateCleared) {
      return;
    }

    const stateFilePath = getServiceStateFilePathFromEnv();
    if (!stateFilePath) {
      return;
    }

    try {
      await fs.access(stateFilePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        serviceStateCleared = true;
        return;
      }

      throw error;
    }

    await clearServiceStateFile(stateFilePath);
    serviceStateCleared = true;
  };

  // Bounded so a stalled write cannot cancel an emergency exit.
  const flushSettingsWithTimeout = (): Promise<void> =>
    Promise.race([
      flushSettings(),
      new Promise<void>((resolve) => setTimeout(resolve, SETTINGS_FLUSH_TIMEOUT_MS)),
    ]);

  // Same bound for the file log, so the records written right before the exit
  // (the crash report or the forcing-exit warning itself) reach the file.
  const flushLoggerWithTimeout = (): Promise<void> =>
    Promise.race([
      flushLogger(),
      new Promise<void>((resolve) => setTimeout(resolve, LOG_FLUSH_TIMEOUT_MS)),
    ]);

  // Keep the process alive: a single unhandled rejection must not take the bot
  // down while the user is away and there is no supervisor to restart it.
  const unhandledRejectionHandler = (reason: unknown): void => {
    logger.error("[App] Unhandled promise rejection", reason);
  };

  const uncaughtExceptionHandler = (error: Error): void => {
    logger.error("[App] Uncaught exception", error);
    void clearManagedServiceState()
      .catch(() => {})
      .then(() => flushSettingsWithTimeout())
      .then(() => flushLoggerWithTimeout())
      .finally(() => process.exit(1));
  };

  process.on("unhandledRejection", unhandledRejectionHandler);
  process.on("uncaughtException", uncaughtExceptionHandler);

  await loadSettings();
  await reconcileStoredModelSelection();
  registerOpenCodeReadyRefreshHandler();
  const localCommandRegistry = await LocalCommandRegistry.load({
    directoryPath: runtimePaths.localCommandsDirPath,
    builtInCommands: BUILT_IN_COMMAND_NAMES,
  });
  const bot = createBot(localCommandRegistry);
  await scheduledTaskRuntime.initialize(
    bot,
    createScheduledTaskDeliverySender(bot.api, config.telegram.allowedUserId),
  );
  safeBackgroundTask({
    taskName: "app.opencodeStartup",
    task: async () => {
      await opencodeAutoRestartService.start();
      await notifyOpencodeReadyIfHealthy("startup");
    },
  });

  let shutdownStarted = false;
  let shutdownTimeout: ReturnType<typeof setTimeout> | null = null;

  const shutdown = (signal: NodeJS.Signals): void => {
    if (shutdownStarted) {
      return;
    }

    shutdownStarted = true;
    logger.info(`[App] Received ${signal}, shutting down...`);
    cleanupBotRuntime(`app_shutdown_${signal.toLowerCase()}`);
    opencodeAutoRestartService.stop();
    void stopManagedServers().catch((error) => {
      logger.warn("[App] Failed to stop managed OpenCode server(s)", error);
    });
    scheduledTaskRuntime.shutdown();

    shutdownTimeout = setTimeout(() => {
      logger.warn(`[App] Shutdown did not finish in ${SHUTDOWN_TIMEOUT_MS}ms, forcing exit.`);
      void flushSettingsWithTimeout()
        .then(() => flushLoggerWithTimeout())
        .finally(() => process.exit(0));
    }, SHUTDOWN_TIMEOUT_MS);
    shutdownTimeout.unref?.();

    try {
      bot.stop();
    } catch (error) {
      logger.warn("[App] Failed to stop Telegram bot cleanly", error);
    }

    void clearManagedServiceState().catch((error) => {
      logger.warn("[App] Failed to clear managed service state", error);
    });
  };

  const handleSigint = (): void => shutdown("SIGINT");
  const handleSigterm = (): void => shutdown("SIGTERM");
  process.on("SIGINT", handleSigint);
  process.on("SIGTERM", handleSigterm);

  const isShutdown = (): boolean => shutdownStarted;
  const webhookInfo = await callTelegramAtStartup(
    "getWebhookInfo",
    () => bot.api.getWebhookInfo(),
    isShutdown,
  );
  if (webhookInfo === "shutdown") {
    return;
  }

  if (webhookInfo.pending_update_count > 0) {
    // Approximate: more updates can arrive before long polling actually drops
    // the queue, and Telegram does not report how many were discarded.
    logger.info(
      `[Bot] Dropping ~${webhookInfo.pending_update_count} update(s) queued while the bot was offline`,
    );
  }
  if (webhookInfo.url) {
    logger.info(`[Bot] Webhook detected: ${webhookInfo.url}, removing...`);
    const deleted = await callTelegramAtStartup("deleteWebhook", () => bot.api.deleteWebhook(), isShutdown);
    if (deleted === "shutdown") {
      return;
    }
    logger.info("[Bot] Webhook removed, switching to long polling");
  }

  const identity = await callTelegramAtStartup("getMe", () => bot.api.getMe(), isShutdown);
  if (identity === "shutdown" || shutdownStarted) {
    return;
  }
  bot.botInfo = identity;

  try {
    await bot.start({
      drop_pending_updates: true,
      onStart: (botInfo) => {
        logger.info(`Bot @${botInfo.username} started!`);
        restoreFollowedSessionOnPollingStart(bot);
      },
    });
  } catch (error) {
    if (isFatalTelegramTokenError(error)) {
      logger.error("[App] Telegram rejected the bot token; not retrying", error);
    } else {
      logger.error("[App] Telegram startup failed; not retrying", error);
    }
    throw error;
  } finally {
    process.off("unhandledRejection", unhandledRejectionHandler);
    process.off("uncaughtException", uncaughtExceptionHandler);
    process.off("SIGINT", handleSigint);
    process.off("SIGTERM", handleSigterm);
    if (shutdownTimeout) {
      clearTimeout(shutdownTimeout);
      shutdownTimeout = null;
    }
    cleanupBotRuntime("app_shutdown_complete");
    opencodeAutoRestartService.stop();
    await stopManagedServers().catch((error) => {
      logger.warn("[App] Failed to stop managed OpenCode server(s)", error);
    });
    scheduledTaskRuntime.shutdown();
    await clearManagedServiceState().catch((error) => {
      logger.warn("[App] Failed to clear managed service state", error);
    });
    await flushSettings();
  }
}
