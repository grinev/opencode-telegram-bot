import type { Context, NextFunction } from "grammy";
import { resolveInteractionGuardDecision } from "./interaction-guard-decision.js";
import type { BlockReason, InteractionKind } from "../../app/types/interaction.js";
import { reconcileForegroundBusyState } from "../../app/services/run-control-service.js";
import {
  canQueueMediaPrompt,
  rejectQueuedMediaBeforePreparation,
  shouldSuggestPromptQueue,
  tryEnqueuePrompt,
} from "../handlers/prompt-queue-dispatch.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { getIncomingPrompt } from "../handlers/rich-message-handler.js";
import type { LocalCommandRegistry } from "../../app/services/local-command-registry.js";

function getInteractionBlockedMessage(
  reason: BlockReason | undefined,
  interactionKind: InteractionKind | undefined,
): string {
  if (interactionKind === "permission") {
    switch (reason) {
      case "command_not_allowed":
        return t("permission.blocked.command_not_allowed");
      case "expected_callback":
      case "expected_command":
      case "expected_text":
      default:
        return t("permission.blocked.expected_reply");
    }
  }

  if (interactionKind === "inline") {
    switch (reason) {
      case "command_not_allowed":
        return t("inline.blocked.command_not_allowed");
      case "expected_callback":
      case "expected_command":
      case "expected_text":
      default:
        return t("inline.blocked.expected_choice");
    }
  }

  if (interactionKind === "question") {
    switch (reason) {
      case "command_not_allowed":
        return t("question.blocked.command_not_allowed");
      case "expected_callback":
      case "expected_command":
      case "expected_text":
      default:
        return t("question.blocked.expected_answer");
    }
  }

  if (interactionKind === "rename") {
    switch (reason) {
      case "command_not_allowed":
        return t("rename.blocked.command_not_allowed");
      case "expected_callback":
      case "expected_command":
      case "expected_text":
      default:
        return t("rename.blocked.expected_name");
    }
  }

  if (interactionKind === "task") {
    switch (reason) {
      case "command_not_allowed":
        return t("task.blocked.command_not_allowed");
      case "expected_callback":
      case "expected_command":
      case "expected_text":
      default:
        return t("task.blocked.expected_input");
    }
  }

  switch (reason) {
    case "expired":
      return t("interaction.blocked.expired");
    case "expected_callback":
      return t("interaction.blocked.expected_callback");
    case "expected_command":
      return t("interaction.blocked.expected_command");
    case "command_not_allowed":
      return t("interaction.blocked.command_not_allowed");
    case "expected_text":
    default:
      return t("interaction.blocked.expected_text");
  }
}

function getQueuedPhotoMediaBytes(input: ReturnType<typeof getIncomingPrompt>): number | undefined {
  if (!input?.photos.length) {
    return 0;
  }

  let mediaBytes = 0;
  for (const photo of input.photos) {
    if (
      typeof photo.fileSize !== "number" ||
      !Number.isSafeInteger(photo.fileSize) ||
      photo.fileSize < 0
    ) {
      return undefined;
    }
    mediaBytes += photo.fileSize;
    if (!Number.isSafeInteger(mediaBytes)) {
      return undefined;
    }
  }

  return mediaBytes;
}

export async function interactionGuardMiddleware(
  ctx: Context,
  next: NextFunction,
  localCommandRegistry?: LocalCommandRegistry,
): Promise<void> {
  let decision = resolveInteractionGuardDecision(ctx, localCommandRegistry);

  if (!decision.allow && decision.busy) {
    await reconcileForegroundBusyState();
    decision = resolveInteractionGuardDecision(ctx, localCommandRegistry);
  }

  if (decision.allow) {
    await next();
    return;
  }

  const incomingPrompt = getIncomingPrompt(ctx);
  if (decision.busy && !decision.state && canQueueMediaPrompt(ctx)) {
    await next();
    return;
  }

  const isQueueableInput = Boolean(
    decision.busy && decision.inputType === "text" && !decision.state && incomingPrompt,
  );

  if (isQueueableInput && incomingPrompt) {
    const mediaBytes = getQueuedPhotoMediaBytes(incomingPrompt);
    if (incomingPrompt.photos.length > 0) {
      if (await rejectQueuedMediaBeforePreparation(ctx, mediaBytes)) {
        return;
      }
    }
    const queued = await tryEnqueuePrompt(
      ctx,
      mediaBytes === undefined ? incomingPrompt : { ...incomingPrompt, mediaBytes },
    );
    if (queued) {
      return;
    }
  }

  let message = decision.busy
    ? decision.state?.kind === "question" || decision.state?.kind === "permission"
      ? getInteractionBlockedMessage(decision.reason, decision.state.kind)
      : t("bot.session_busy")
    : getInteractionBlockedMessage(decision.reason, decision.state?.kind);

  // Only hint where the message would actually have been queued - not for button
  // presses or commands that are turned down while the agent is busy.
  if (isQueueableInput && incomingPrompt && shouldSuggestPromptQueue(incomingPrompt)) {
    message = `${message} ${t("queue.disabled_hint")}`;
  }

  logger.debug(
    `[InteractionGuard] Blocked input: interactionKind=${decision.state?.kind || "none"}, inputType=${decision.inputType}, reason=${decision.reason || "unknown"}, command=${decision.command || "-"}, busy=${decision.busy ? "yes" : "no"}`,
  );

  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery({ text: message }).catch(() => {});
    return;
  }

  if (ctx.chat) {
    await ctx.reply(message).catch((err) => {
      logger.error("[InteractionGuard] Failed to send blocked input message:", err);
    });
  }
}
