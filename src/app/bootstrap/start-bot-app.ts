import fs from "node:fs/promises";
import { readFile } from "node:fs/promises";

import { cleanupBotRuntime, createBot } from "../../bot/index.js";
import { createScheduledTaskDeliverySender } from "../../bot/messages/scheduled-task-delivery.js";
import { config } from "../../config.js";
import { opencodeAutoRestartService } from "../../opencode/auto-restart.js";
import {
  notifyOpencodeReadyIfHealthy,
  registerOpenCodeReadyRefreshHandler,
} from "../../opencode/ready-refresh.js";
import { flushSettings, loadSettings } from "../stores/settings-store.js";
import { scheduledTaskRuntime } from "../services/scheduled-task-runtime-service.js";
import { reconcileStoredModelSelection } from "../services/model-selection-service.js";
import { getRuntimeMode } from "../../runtime/mode.js";
import { getRuntimePaths } from "../../runtime/paths.js";
import { clearServiceStateFile } from "../../runtime/service/manager.js";
import { getServiceStateFilePathFromEnv, isServiceChildProcess } from "../../runtime/service/env.js";
import { flushLogger, getLogFilePath, initializeLogger, logger } from "../../utils/logger.js";
import { safeBackgroundTask } from "../../utils/safe-background-task.js";
import { startHealthServer, stopHealthServer } from "../../health/server.js";

const SHUTDOWN_TIMEOUT_MS = 5000;
const SETTINGS_FLUSH_TIMEOUT_MS = 1000;
const LOG_FLUSH_TIMEOUT_MS = 1000;

async function getBotVersion(): Promise<string> {
  try {
    const packageJsonPath = new URL("../../../package.json", import.meta.url);
    const packageJsonContent = await readFile(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(packageJsonContent) as { version?: string };

    return packageJson.version ?? "unknown";
  } catch (error) {
    logger.warn("[App] Failed to read bot version", error);
    return "unknown";
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
  await startHealthServer(config.health.port, version);
  const bot = createBot();
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
    scheduledTaskRuntime.shutdown();
    void stopHealthServer();

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

  const webhookInfo = await bot.api.getWebhookInfo();
  if (webhookInfo.pending_update_count > 0) {
    // Approximate: more updates can arrive before long polling actually drops
    // the queue, and Telegram does not report how many were discarded.
    logger.info(
      `[Bot] Dropping ~${webhookInfo.pending_update_count} update(s) queued while the bot was offline`,
    );
  }
  if (webhookInfo.url) {
    logger.info(`[Bot] Webhook detected: ${webhookInfo.url}, removing...`);
    await bot.api.deleteWebhook();
    logger.info("[Bot] Webhook removed, switching to long polling");
  }

  try {
    await bot.start({
      drop_pending_updates: true,
      onStart: (botInfo) => {
        logger.info(`Bot @${botInfo.username} started!`);
      },
    });
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
    scheduledTaskRuntime.shutdown();
    await stopHealthServer();
    await clearManagedServiceState().catch((error) => {
      logger.warn("[App] Failed to clear managed service state", error);
    });
    await flushSettings();
  }
}
