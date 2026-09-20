import { CommandContext, Context } from "grammy";
import { getBusySessionStatuses, opencodeV2 } from "../../opencode/client.js";
import { getCurrentSession } from "../../app/services/session-service.js";
import { clearAllInteractionState } from "../../app/managers/interaction-manager.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { foregroundSessionState } from "../../app/managers/foreground-session-state-manager.js";
import { assistantRunState } from "../../app/managers/assistant-run-state-manager.js";
import { markAttachedSessionIdle } from "../../app/services/attach-service.js";
import { clearPromptResponseMode } from "../handlers/prompt.js";
import { markUserAbortRequested } from "../../app/managers/abort-suppression-manager.js";
import { promptQueue } from "../../app/managers/prompt-queue-manager.js";
import { promptAttachment } from "../../app/managers/prompt-attachment-manager.js";

type SessionState = "idle" | "busy" | "not-found";

interface AbortCurrentOperationOptions {
  notifyUser?: boolean;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function abortLocalStreaming(): void {
  clearAllInteractionState("abort_command");
}

async function releaseAbortBusyState(sessionId: string, reason: string): Promise<void> {
  foregroundSessionState.markIdle(sessionId);
  assistantRunState.clearRun(sessionId, reason);
  await markAttachedSessionIdle(sessionId);
  clearPromptResponseMode(sessionId);
}

async function pollSessionStatus(
  sessionId: string,
  _directory: string,
  maxWaitMs: number = 5000,
): Promise<SessionState> {
  const startedAt = Date.now();
  const pollIntervalMs = 500;

  while (Date.now() - startedAt < maxWaitMs) {
    try {
      const { data, error } = await getBusySessionStatuses();

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
      logger.warn("[Abort] Failed to poll session status:", error);
      break;
    }
  }

  return "busy";
}

export async function abortCurrentOperation(
  ctx: Context,
  options: AbortCurrentOperationOptions = {},
): Promise<void> {
  const notifyUser = options.notifyUser ?? true;

  try {
    abortLocalStreaming();
    promptQueue.clear("abort_command");
    // abortLocalStreaming drops the waiting mode, so the attachment has to go with it -
    // otherwise it would ride along on the next, unrelated prompt with no confirmation left.
    promptAttachment.clear("abort_command");

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
      // No reply_markup here: this message is edited below, and Telegram
      // refuses to edit a message that carries a custom reply keyboard.
      const waitingMessage = await ctx.reply(t("stop.in_progress"));
      waitingMessageId = waitingMessage.message_id;
      chatId = ctx.chat?.id ?? null;

      if (!chatId) {
        logger.warn("[Abort] Chat context is missing while aborting active session");
        return;
      }
    }

    markUserAbortRequested(currentSession.id);

    try {
      // v2 interrupt answers 204 with no payload; confirmation happens via the status poll below.
      const { error: abortError } = await opencodeV2.session.interrupt({
        sessionID: currentSession.id,
      });

      if (abortError) {
        logger.warn("[Abort] Abort request failed:", abortError);
        await releaseAbortBusyState(currentSession.id, "abort_unconfirmed");
        if (notifyUser && chatId !== null && waitingMessageId !== null) {
          await ctx.api.editMessageText(chatId, waitingMessageId, t("stop.warn_unconfirmed"));
        }
        return;
      }

      const finalStatus = await pollSessionStatus(
        currentSession.id,
        currentSession.directory,
        5000,
      );

      if (finalStatus === "idle" || finalStatus === "not-found") {
        await releaseAbortBusyState(currentSession.id, "abort_confirmed");
        if (notifyUser && chatId !== null && waitingMessageId !== null) {
          await ctx.api.editMessageText(chatId, waitingMessageId, t("stop.success"));
        }
      } else {
        if (notifyUser && chatId !== null && waitingMessageId !== null) {
          await ctx.api.editMessageText(chatId, waitingMessageId, t("stop.warn_still_busy"));
        }
      }
    } catch (error) {
      await releaseAbortBusyState(currentSession.id, "abort_error");

      if (error instanceof Error && error.name === "AbortError") {
        if (notifyUser && chatId !== null && waitingMessageId !== null) {
          await ctx.api.editMessageText(chatId, waitingMessageId, t("stop.warn_timeout"));
        }
      } else {
        logger.error("[Abort] Error while aborting session:", error);
        if (notifyUser && chatId !== null && waitingMessageId !== null) {
          await ctx.api.editMessageText(chatId, waitingMessageId, t("stop.warn_local_only"));
        }
      }
    }
  } catch (error) {
    logger.error("[Abort] Unexpected error:", error);
    await ctx.reply(t("stop.error"));
  }
}

export async function abortCommand(ctx: CommandContext<Context>): Promise<void> {
  await abortCurrentOperation(ctx);
}
