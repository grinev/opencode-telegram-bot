import { CommandContext, Context } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { stopEventListening } from "../../opencode/events.js";
import { getCurrentSession } from "../../session/manager.js";
import { clearAllInteractionState } from "../../interaction/cleanup.js";
import { summaryAggregator } from "../../summary/aggregator.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";

type SessionState = "idle" | "busy" | "not-found";

interface StopCurrentOperationOptions {
  notifyUser?: boolean;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function stopLocalStreaming(): void {
  stopEventListening();
  summaryAggregator.clear();
  clearAllInteractionState("stop_command");
}

async function pollSessionStatus(
  sessionId: string,
  directory: string,
  maxWaitMs: number = 5000,
): Promise<SessionState> {
  const startedAt = Date.now();
  const pollIntervalMs = 500;

  while (Date.now() - startedAt < maxWaitMs) {
    try {
      const { data, error } = await opencodeClient.session.status({ directory });

      if (error || !data) {
        break;
      }

      const sessionStatus = (data as Record<string, { type?: string }>)[sessionId];
      if (!sessionStatus) {
        return "not-found";
      }

      if (sessionStatus.type === "idle" || sessionStatus.type === "error") {
        return "idle";
      }

      if (sessionStatus.type !== "busy") {
        return "not-found";
      }

      await sleep(pollIntervalMs);
    } catch (error) {
      logger.warn("[Stop] Failed to poll session status:", error);
      break;
    }
  }

  return "busy";
}

export async function stopCurrentOperation(
  ctx: Context,
  options: StopCurrentOperationOptions = {},
): Promise<void> {
  const notifyUser = options.notifyUser ?? true;

  try {
    stopLocalStreaming();

    const currentSession = getCurrentSession();

    if (!currentSession) {
      if (notifyUser) {
        await ctx.reply(t("stop.no_active_session"));
      }
      return;
    }

    let waitingMessageId: number | null = null;
    let chatId: number | null = null;

    if (notifyUser) {
      const waitingMessage = await ctx.reply(t("stop.in_progress"));
      waitingMessageId = waitingMessage.message_id;
      chatId = ctx.chat?.id ?? null;

      if (!chatId) {
        logger.warn("[Stop] Chat context is missing while aborting active session");
        return;
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const { data: abortResult, error: abortError } = await opencodeClient.session.abort(
        {
          sessionID: currentSession.id,
          directory: currentSession.directory,
        },
        { signal: controller.signal },
      );

      clearTimeout(timeoutId);

      if (abortError) {
        logger.warn("[Stop] Abort request failed:", abortError);
        if (notifyUser && chatId !== null && waitingMessageId !== null) {
          await ctx.api.editMessageText(chatId, waitingMessageId, t("stop.warn_unconfirmed"));
        }
        return;
      }

      if (abortResult !== true) {
        if (notifyUser && chatId !== null && waitingMessageId !== null) {
          await ctx.api.editMessageText(chatId, waitingMessageId, t("stop.warn_maybe_finished"));
        }
        return;
      }

      const finalStatus = await pollSessionStatus(
        currentSession.id,
        currentSession.directory,
        5000,
      );

      if (finalStatus === "idle" || finalStatus === "not-found") {
        if (notifyUser && chatId !== null && waitingMessageId !== null) {
          await ctx.api.editMessageText(chatId, waitingMessageId, t("stop.success"));
        }
      } else {
        if (notifyUser && chatId !== null && waitingMessageId !== null) {
          await ctx.api.editMessageText(chatId, waitingMessageId, t("stop.warn_still_busy"));
        }
      }
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === "AbortError") {
        if (notifyUser && chatId !== null && waitingMessageId !== null) {
          await ctx.api.editMessageText(chatId, waitingMessageId, t("stop.warn_timeout"));
        }
      } else {
        logger.error("[Stop] Error while aborting session:", error);
        if (notifyUser && chatId !== null && waitingMessageId !== null) {
          await ctx.api.editMessageText(chatId, waitingMessageId, t("stop.warn_local_only"));
        }
      }
    }
  } catch (error) {
    logger.error("[Stop] Unexpected error:", error);
    await ctx.reply(t("stop.error"));
  }
}

export async function stopCommand(ctx: CommandContext<Context>): Promise<void> {
  await stopCurrentOperation(ctx);
}
