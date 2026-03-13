import { CommandContext, Context } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { processManager } from "../../process/manager.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { editBotText } from "../utils/telegram-text.js";

/**
 * Wait for OpenCode server to become ready by polling health endpoint
 * @param maxWaitMs Maximum time to wait in milliseconds
 * @returns true if server became ready, false if timeout
 */
async function waitForServerReady(maxWaitMs: number = 10000): Promise<boolean> {
  const startTime = Date.now();
  const pollInterval = 500;

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const { data, error } = await opencodeClient.global.health();

      if (!error && data?.healthy) {
        return true;
      }
    } catch {
      // Server not ready yet
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  return false;
}

/**
 * Command handler for /opencode-start
 * Starts the OpenCode server process
 */
export async function opencodeStartCommand(ctx: CommandContext<Context>) {
  try {
    // 1. Check if process is already running under our management
    if (processManager.isRunning()) {
      const uptime = processManager.getUptime();
      const uptimeStr = uptime ? Math.floor(uptime / 1000) : 0;

      await ctx.reply(
        t("opencode_start.already_running_managed", {
          pid: processManager.getPID() ?? "-",
          seconds: uptimeStr,
        }),
      );
      return;
    }

    // 2. Check if server is accessible (external process)
    try {
      const { data, error } = await opencodeClient.global.health();

      if (!error && data?.healthy) {
        await ctx.reply(
          t("opencode_start.already_running_external", {
            version: data.version || t("common.unknown"),
          }),
        );
        return;
      }
    } catch {
      // Server not accessible, continue with start
    }

    // 3. Notify user that we're starting the server
    const statusMessage = await ctx.reply(t("opencode_start.starting"));

    // 4. Start the process
    const { success, error } = await processManager.start();

    if (!success) {
      await editBotText({
        api: ctx.api,
        chatId: ctx.chat.id,
        messageId: statusMessage.message_id,
        text: t("opencode_start.start_error", { error: error || t("common.unknown_error") }),
      });
      return;
    }

    // 5. Wait for server to become ready
    logger.info("[Bot] Waiting for OpenCode server to become ready...");
    const ready = await waitForServerReady(10000);

    if (!ready) {
      await editBotText({
        api: ctx.api,
        chatId: ctx.chat.id,
        messageId: statusMessage.message_id,
        text: t("opencode_start.started_not_ready", {
          pid: processManager.getPID() ?? "-",
        }),
      });
      return;
    }

    // 6. Get server version and send success message
    const { data: health } = await opencodeClient.global.health();
    await editBotText({
      api: ctx.api,
      chatId: ctx.chat.id,
      messageId: statusMessage.message_id,
      text: t("opencode_start.success", {
        pid: processManager.getPID() ?? "-",
        version: health?.version || t("common.unknown"),
      }),
    });

    logger.info(`[Bot] OpenCode server started successfully, PID=${processManager.getPID()}`);
  } catch (err) {
    logger.error("[Bot] Error in /opencode-start command:", err);
    await ctx.reply(t("opencode_start.error"));
  }
}
