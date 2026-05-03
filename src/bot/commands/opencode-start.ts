import { CommandContext, Context } from "grammy";
import { config } from "../../config.js";
import { opencodeClient } from "../../opencode/client.js";
import { resolveLocalOpencodeTarget, startLocalOpencodeServer } from "../../opencode/process.js";
import { opencodeReadyLifecycle } from "../../opencode/ready-lifecycle.js";
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
    const localTarget = resolveLocalOpencodeTarget(config.opencode.apiUrl);
    if (!localTarget) {
      await ctx.reply(t("opencode_start.remote_configured"));
      return;
    }

    // Check if server is already accessible.
    try {
      const { data, error } = await opencodeClient.global.health();

      if (!error && data?.healthy) {
        await ctx.reply(
          t("opencode_start.already_running", { version: data.version || t("common.unknown") }),
        );
        await opencodeReadyLifecycle.notifyReady("opencode_start_already_running");
        return;
      }
    } catch {
      // Server not accessible, continue with start.
    }

    const statusMessage = await ctx.reply(t("opencode_start.starting"));

    const childProcess = startLocalOpencodeServer(localTarget);

    childProcess.once("error", (error) => {
      logger.error("[Bot] OpenCode server process failed to start", error);
    });

    const pid = childProcess.pid;
    if (!pid) {
      await editBotText({
        api: ctx.api,
        chatId: ctx.chat.id,
        messageId: statusMessage.message_id,
        text: t("opencode_start.start_error", { error: t("common.unknown_error") }),
      });
      return;
    }

    childProcess.unref();

    logger.info("[Bot] Waiting for OpenCode server to become ready...");
    const ready = await waitForServerReady(10000);

    if (!ready) {
      await editBotText({
        api: ctx.api,
        chatId: ctx.chat.id,
        messageId: statusMessage.message_id,
        text: t("opencode_start.started_not_ready", {
          pid,
        }),
      });
      return;
    }

    const { data: health } = await opencodeClient.global.health();
    await editBotText({
      api: ctx.api,
      chatId: ctx.chat.id,
      messageId: statusMessage.message_id,
      text: t("opencode_start.success", {
        pid,
        version: health?.version || t("common.unknown"),
      }),
    });

    logger.info(`[Bot] OpenCode server started successfully, PID=${pid}, port=${localTarget.port}`);
    await opencodeReadyLifecycle.notifyReady("opencode_start_success");
  } catch (err) {
    logger.error("[Bot] Error in /opencode-start command:", err);
    await ctx.reply(t("opencode_start.error"));
  }
}
