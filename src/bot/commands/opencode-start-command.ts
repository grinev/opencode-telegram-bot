import { CommandContext, Context } from "grammy";
import { config } from "../../config.js";
import { opencodeClient } from "../../opencode/client.js";
import { resolveLocalOpencodeTarget, startLocalOpencodeServer } from "../../opencode/process.js";
import { opencodeReadyLifecycle } from "../../opencode/ready-lifecycle.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { editBotText } from "../messages/telegram-text.js";

const SERVER_READY_TIMEOUT_MS = 10_000;
const SERVER_READY_POLL_INTERVAL_MS = 500;
const HEALTH_CHECK_TIMEOUT_MS = 3_000;
const HEALTH_CHECK_TIMED_OUT = Symbol("health-check-timed-out");

type HealthCheckResult = Awaited<ReturnType<typeof opencodeClient.global.health>>;

async function healthWithTimeout(
  timeoutMs: number = HEALTH_CHECK_TIMEOUT_MS,
): Promise<HealthCheckResult | typeof HEALTH_CHECK_TIMED_OUT> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      opencodeClient.global.health({ signal: controller.signal }),
      new Promise<typeof HEALTH_CHECK_TIMED_OUT>((resolve) => {
        timeout = setTimeout(() => {
          controller.abort();
          resolve(HEALTH_CHECK_TIMED_OUT);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function getHealthIfAvailable(): Promise<HealthCheckResult | null> {
  try {
    const result = await healthWithTimeout();
    if (result === HEALTH_CHECK_TIMED_OUT) {
      logger.warn(`[Bot] OpenCode health check timed out after ${HEALTH_CHECK_TIMEOUT_MS}ms`);
      return null;
    }

    return result;
  } catch {
    return null;
  }
}

/**
 * Wait for OpenCode server to become ready by polling health endpoint
 * @param maxWaitMs Maximum time to wait in milliseconds
 * @returns true if server became ready, false if timeout
 */
async function waitForServerReady(maxWaitMs: number = 10000): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const health = await getHealthIfAvailable();
    if (health?.data?.healthy) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, SERVER_READY_POLL_INTERVAL_MS));
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
      const health = await getHealthIfAvailable();
      const data = health?.data;

      if (data?.healthy) {
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
    const ready = await waitForServerReady(SERVER_READY_TIMEOUT_MS);

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

    const health = (await getHealthIfAvailable())?.data;
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
