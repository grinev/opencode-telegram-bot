import type { Context, NextFunction } from "grammy";
import { resolveInteractionGuardDecision } from "../../interaction/guard.js";
import type { BlockReason, InteractionKind } from "../../interaction/types.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";

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

export async function interactionGuardMiddleware(ctx: Context, next: NextFunction): Promise<void> {
  const decision = resolveInteractionGuardDecision(ctx);

  if (decision.allow) {
    await next();
    return;
  }

  const message = getInteractionBlockedMessage(decision.reason, decision.state?.kind);

  logger.debug(
    `[InteractionGuard] Blocked input: interactionKind=${decision.state?.kind || "none"}, inputType=${decision.inputType}, reason=${decision.reason || "unknown"}, command=${decision.command || "-"}`,
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
