import { CommandContext, Context } from "grammy";
import { config } from "../../config.js";
import { opencodeClient } from "../../opencode/client.js";
import {
  findServerPid,
  killServerProcess,
  resolveLocalOpencodeTarget,
} from "../../opencode/process.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { editBotText } from "../messages/telegram-text.js";

/**
 * Command handler for /opencode-stop
 * Stops the OpenCode server process
 */
export async function opencodeStopCommand(ctx: CommandContext<Context>) {
  try {
    const localTarget = resolveLocalOpencodeTarget(config.opencode.apiUrl);
    if (!localTarget) {
      await ctx.reply(t("opencode_stop.remote_configured"));
      return;
    }

    try {
      const { data, error } = await opencodeClient.global.health();
      if (error || !data?.healthy) {
        await ctx.reply(t("opencode_stop.not_running"));
        return;
      }
    } catch {
      await ctx.reply(t("opencode_stop.not_running"));
      return;
    }

    const pid = await findServerPid(localTarget.port);
    if (!pid) {
      await ctx.reply(t("opencode_stop.pid_not_found", { port: localTarget.port }));
      return;
    }

    const statusMessage = await ctx.reply(t("opencode_stop.stopping", { pid }));

    const stopped = await killServerProcess(pid, 5000);
    if (!stopped) {
      await editBotText({
        api: ctx.api,
        chatId: ctx.chat.id,
        messageId: statusMessage.message_id,
        text: t("opencode_stop.stop_error", { error: t("common.unknown_error") }),
      });
      return;
    }

    try {
      const { data, error } = await opencodeClient.global.health();
      if (!error && data?.healthy) {
        await editBotText({
          api: ctx.api,
          chatId: ctx.chat.id,
          messageId: statusMessage.message_id,
          text: t("opencode_stop.stop_error", { error: t("opencode_stop.still_running") }),
        });
        return;
      }
    } catch {
      // Health check failure after stop is expected.
    }

    await editBotText({
      api: ctx.api,
      chatId: ctx.chat.id,
      messageId: statusMessage.message_id,
      text: t("opencode_stop.success"),
    });

    logger.info(`[Bot] OpenCode server stopped successfully, PID=${pid}, port=${localTarget.port}`);
  } catch (err) {
    logger.error("[Bot] Error in /opencode-stop command:", err);
    await ctx.reply(t("opencode_stop.error"));
  }
}
