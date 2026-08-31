import { CommandContext, Context } from "grammy";
import { config } from "../../config.js";
import {
  findServerPid,
  killServerProcess,
  resolveLocalOpencodeTarget,
} from "../../opencode/process.js";
import { opencodeReadyLifecycle } from "../../opencode/ready-lifecycle.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { isContainerRuntime } from "../../runtime/container.js";
import { editBotText } from "../messages/telegram-text.js";
import { foregroundSessionState } from "../../app/managers/foreground-session-state-manager.js";
import { attachManager } from "../../app/managers/attach-manager.js";
import { promptQueue } from "../../app/managers/prompt-queue-manager.js";
import { clearAllInteractionState } from "../../app/managers/interaction-manager.js";
import { markAttachedSessionIdle } from "../../app/services/attach-service.js";
import { clearPromptResponseMode } from "../handlers/prompt.js";

export interface OpencodeStopCommandDeps {
  clearRuntimeState: (reason: string) => void;
}

const STOP_REASON = "opencode_stop";

async function releaseLocalStateAfterServerStop(
  clearRuntimeState: (reason: string) => void,
): Promise<void> {
  const sessionIds = new Set<string>();

  for (const session of foregroundSessionState.getBusySessions()) {
    sessionIds.add(session.sessionId);
  }

  const attached = attachManager.getSnapshot();
  if (attached) {
    sessionIds.add(attached.sessionId);
  }

  clearRuntimeState(STOP_REASON);
  foregroundSessionState.clearAll(STOP_REASON);

  if (attached) {
    await markAttachedSessionIdle(attached.sessionId);
  }

  for (const sessionId of sessionIds) {
    clearPromptResponseMode(sessionId);
  }

  promptQueue.clear(STOP_REASON);
  clearAllInteractionState(STOP_REASON);
  opencodeReadyLifecycle.notifyUnavailable(STOP_REASON);
}

/**
 * Command handler for /opencode-stop
 * Stops the OpenCode server process
 */
export async function opencodeStopCommand(
  ctx: CommandContext<Context>,
  deps: OpencodeStopCommandDeps,
) {
  try {
    if (isContainerRuntime()) {
      await ctx.reply(t("runtime.container.command_unavailable"));
      return;
    }

    const localTarget = resolveLocalOpencodeTarget(config.opencode.apiUrl);
    if (!localTarget) {
      await ctx.reply(t("opencode_stop.remote_configured"));
      return;
    }

    const pid = await findServerPid(localTarget.port);
    if (!pid) {
      await ctx.reply(t("opencode_stop.not_running"));
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

    await releaseLocalStateAfterServerStop(deps.clearRuntimeState);

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
