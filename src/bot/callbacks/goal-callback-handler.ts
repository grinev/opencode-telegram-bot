import type { Context } from "grammy";
import { formatGoalStatusText } from "../../app/formatters/goal-text.js";
import { isForegroundBusy } from "../../app/services/run-control-service.js";
import { getCurrentSession } from "../../app/services/session-service.js";
import { getStoredAgent, resolveProjectAgent } from "../../app/services/agent-selection-service.js";
import { getStoredModel } from "../../app/services/model-selection-service.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { isRecord } from "../../utils/type-guards.js";
import { alert, cancelMenu } from "./feedback.js";
import {
  goalCancelData,
  goalConfirmData,
  handleGoalAction,
  replyGoalText,
  type GoalCommandDeps,
} from "../commands/goal-command.js";

type GoalCallbackDeps = GoalCommandDeps;

interface GoalConfirmation {
  messageId: number;
  sessionId: string;
  directory: string;
  goalId: string | null;
  shownGoal: unknown;
  action: "start" | "resume";
  objective: string;
  controlToken: string;
}

export async function handleGoalCallback(ctx: Context, deps: GoalCallbackDeps): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (data?.startsWith("goal:delete:")) {
    await ctx.answerCallbackQuery();
    await handleGoalAction(ctx, deps, "clear", data.slice("goal:delete:".length));
    return true;
  }
  if (data !== goalConfirmData() && data !== goalCancelData()) {
    return false;
  }

  const messageId = callbackMessageId(ctx);
  const metadata = deps.interactionManager.getSnapshot()?.metadata;
  if (data === goalCancelData() && metadata?.flow === "goal" && metadata.messageId === messageId) {
    deps.interactionManager.clear("goal_cancelled");
    await cancelMenu(ctx);
    return true;
  }
  const confirmation = readConfirmation(deps);
  if (!confirmation || messageId === null || confirmation.messageId !== messageId) {
    await alert(ctx, "inline.inactive_callback");
    await ctx.editMessageText(t("inline.inactive_callback")).catch(() => {});
    return true;
  }

  if (isForegroundBusy(deps) || getCurrentSession()?.id !== confirmation.sessionId) {
    deps.interactionManager.clear("goal_invalidated");
    await alert(ctx, "inline.inactive_callback");
    await ctx.editMessageText(t("inline.inactive_callback")).catch(() => {});
    return true;
  }

  let selection: {
    agent: string;
    model: { providerID: string; modelID: string };
    variant?: string;
  };
  try {
    const agent = await resolveProjectAgent(getStoredAgent());
    const model = getStoredModel();
    selection = {
      agent,
      model: { providerID: model.providerID, modelID: model.modelID },
      ...(model.variant ? { variant: model.variant } : {}),
    };
  } catch (error) {
    logger.warn("[Goal] Failed to resolve selected agent/model", {
      sessionId: confirmation.sessionId,
      error,
    });
    await alert(ctx, "goal.action_error");
    return true;
  }
  const current = await deps.goalService.read(confirmation.sessionId, confirmation.directory);
  const stillActive = readConfirmation(deps);
  const session = getCurrentSession();
  if (
    !stillActive ||
    stillActive.messageId !== confirmation.messageId ||
    session?.id !== confirmation.sessionId ||
    session.directory !== confirmation.directory ||
    deps.goalManager.getControlToken() !== confirmation.controlToken ||
    deps.goalManager.snapshot().goal?.id !== (confirmation.goalId ?? undefined) ||
    isForegroundBusy(deps)
  ) {
    if (stillActive?.messageId === confirmation.messageId)
      deps.interactionManager.clear("goal_invalidated");
    await alert(ctx, "inline.inactive_callback");
    await ctx.editMessageText(t("inline.inactive_callback")).catch(() => {});
    return true;
  }
  if (current.kind === "error") {
    await alert(ctx, "goal.read_error");
    return true;
  }
  if (current.kind === "unsupported" || !matchesShownGoal(confirmation, current)) {
    deps.interactionManager.clear("goal_invalidated");
    await alert(
      ctx,
      current.kind === "unsupported" ? "goal.unsupported" : "inline.inactive_callback",
    );
    return true;
  }

  if (
    confirmation.action === "resume" &&
    !deps.goalManager.claimControl(confirmation.controlToken)
  ) {
    deps.interactionManager.clear("goal_invalidated");
    await alert(ctx, "inline.inactive_callback");
    return true;
  }

  deps.interactionManager.clear("goal_confirmed");
  await ctx.answerCallbackQuery();
  await ctx.deleteMessage().catch(() => {});

  if (getCurrentSession()?.id !== confirmation.sessionId || isForegroundBusy(deps)) {
    await replyGoalText(ctx, deps, t("inline.inactive_callback"));
    return true;
  }

  const text = confirmation.action === "resume" ? "resume" : confirmation.objective;
  const ran = await deps.goalService.command(
    confirmation.sessionId,
    confirmation.directory,
    text,
    selection,
  );
  if (getCurrentSession()?.id !== confirmation.sessionId) return true;
  if (ran.kind === "unsupported") {
    await replyGoalText(ctx, deps, t("goal.unsupported"));
    return true;
  }
  if (ran.kind === "rejected") {
    await replyGoalText(ctx, deps, ran.message);
    return true;
  }
  if (ran.kind === "error") {
    await replyGoalText(ctx, deps, t("goal.action_error"));
    return true;
  }

  const next = await deps.goalService.refresh(
    confirmation.sessionId,
    confirmation.directory,
    false,
  );
  if (getCurrentSession()?.id !== confirmation.sessionId) return true;
  if (next.kind !== "goal") {
    await replyGoalText(
      ctx,
      deps,
      next.kind === "unsupported" ? t("goal.unsupported") : t("goal.read_error"),
    );
    return true;
  }

  await replyGoalText(ctx, deps, formatGoalStatusText(next.goal));
  return true;
}

function matchesShownGoal(
  confirmation: GoalConfirmation,
  current: Awaited<ReturnType<GoalCallbackDeps["goalService"]["read"]>>,
): boolean {
  if (confirmation.action === "start") {
    return current.kind === "none";
  }

  if (
    current.kind !== "goal" ||
    current.goal.id !== confirmation.goalId ||
    JSON.stringify(current.goal) !== JSON.stringify(confirmation.shownGoal)
  ) {
    return false;
  }

  if (confirmation.action === "resume") {
    return current.goal.status === "paused";
  }

  return true;
}

function readConfirmation(deps: GoalCallbackDeps): GoalConfirmation | null {
  const metadata = deps.interactionManager.getSnapshot()?.metadata;
  if (!isRecord(metadata) || metadata.flow !== "goal" || metadata.stage !== "confirm") {
    return null;
  }
  if (
    typeof metadata.messageId !== "number" ||
    typeof metadata.sessionId !== "string" ||
    typeof metadata.directory !== "string" ||
    typeof metadata.objective !== "string" ||
    typeof metadata.controlToken !== "string" ||
    (metadata.action !== "start" && metadata.action !== "resume")
  ) {
    return null;
  }

  return {
    messageId: metadata.messageId,
    sessionId: metadata.sessionId,
    directory: metadata.directory,
    goalId: typeof metadata.goalId === "string" ? metadata.goalId : null,
    shownGoal: metadata.shownGoal,
    action: metadata.action,
    objective: metadata.objective,
    controlToken: metadata.controlToken,
  };
}

function callbackMessageId(ctx: Context): number | null {
  const message = ctx.callbackQuery?.message;
  if (!message || !("message_id" in message)) {
    return null;
  }
  return message.message_id;
}
