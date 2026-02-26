import { readFile } from "node:fs/promises";

import { createBot, ensureEventSubscription } from "../bot/index.js";
import { config } from "../config.js";
import { loadSettings, getCurrentProject } from "../settings/manager.js";
import { processManager } from "../process/manager.js";
import { warmupSessionDirectoryCache } from "../session/cache-manager.js";
import { getRuntimeMode } from "../runtime/mode.js";
import { logger } from "../utils/logger.js";

async function getBotVersion(): Promise<string> {
  try {
    const packageJsonPath = new URL("../../package.json", import.meta.url);
    const packageJsonContent = await readFile(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(packageJsonContent) as { version?: string };

    return packageJson.version ?? "unknown";
  } catch (error) {
    logger.warn("[App] Failed to read bot version", error);
    return "unknown";
  }
}

export async function startBotApp(): Promise<void> {
  const mode = getRuntimeMode();
  const version = await getBotVersion();

  logger.info(`Starting OpenCode Telegram Bot v${version}...`);
  logger.info(`Allowed User ID: ${config.telegram.allowedUserId}`);
  logger.debug(`[Runtime] Application start mode: ${mode}`);

  await loadSettings();
  await processManager.initialize();
  await warmupSessionDirectoryCache();

  const bot = createBot();

  const webhookInfo = await bot.api.getWebhookInfo();
  if (webhookInfo.url) {
    logger.info(`[Bot] Webhook detected: ${webhookInfo.url}, removing...`);
    await bot.api.deleteWebhook();
    logger.info("[Bot] Webhook removed, switching to long polling");
  }

  // Subscribe to events for the stored project at startup so questions from
  // TUI-initiated sessions are forwarded to Telegram without needing a first message.
  const currentProject = getCurrentProject();
  if (currentProject?.worktree) {
    logger.info(`[App] Auto-subscribing to events for project: ${currentProject.worktree}`);
    await ensureEventSubscription(currentProject.worktree);
  } else {
    logger.warn("[App] No stored project found, event subscription skipped until first message");
  }

  await bot.start({
    onStart: (botInfo) => {
      logger.info(`Bot @${botInfo.username} started!`);
    },
  });
}
