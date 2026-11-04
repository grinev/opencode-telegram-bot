import type { Context } from "grammy";
import type { AppContainer } from "../../app/bootstrap/app-container.js";
import { formatGoalStatusText } from "../../app/formatters/goal-text.js";
import { isForegroundBusy } from "../../app/services/run-control-service.js";
import { getCurrentSession } from "../../app/services/session-service.js";
import { t } from "../../i18n/index.js";
import { isRecord } from "../../utils/type-guards.js";
import { alert, cancelMenu } from "./feedback.js";
import { sendGoalText } from "../messages/goal-delivery.js";
import { goalCancelData, goalConfirmData } from "../commands/goal-command.js";

type GoalCallbackDeps = Pick<
  AppContainer,
  "attachManager" | "foregroundSessionState" | "goalService" | "interactionManager"
>;

interface GoalConfirmation {
  messageId: number;
  sessionId: string;
  directory: string;
  goalId: string | null;
  shownGoal: unknown;
  action: "start" | "replace" | "resume";
  objective: string;
}

export async function handleGoalCallback(ctx: Context, deps: GoalCallbackDeps): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (data !== goalConfirmData() && data !== goalCancelData()) {
    return false;
  }

  const confirmation = readConfirmation(deps);
  const messageId = callbackMessageId(ctx);
  if (!confirmation || messageId === null || confirmation.messageId !== messageId) {
    await alert(ctx, "inline.inactive_callback");
    await ctx.editMessageText(t("inline.inactive_callback")).catch(() => {});
    return true;
  }

  if (data === goalCancelData()) {
    deps.interactionManager.clear("goal_cancelled");
    await cancelMenu(ctx);
    return true;
  }

  if (isForegroundBusy(deps) || getCurrentSession()?.id !== confirmation.sessionId) {
    deps.interactionManager.clear("goal_invalidated");
    await alert(ctx, "inline.inactive_callback");
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
    isForegroundBusy(deps)
  ) {
    await alert(ctx, "inline.inactive_callback");
    return true;
  }
  if (current.kind === "error") {
    await alert(ctx, "goal.read_error");
    return true;
  }
  if (current.kind === "unsupported" || !matchesShownGoal(confirmation, current)) {
    deps.interactionManager.clear("goal_invalidated");
    await alert(ctx, current.kind === "unsupported" ? "goal.unsupported" : "inline.inactive_callback");
    return true;
  }

  deps.interactionManager.clear("goal_confirmed");
  await ctx.answerCallbackQuery();
  await ctx.deleteMessage().catch(() => {});

  const text = confirmation.action === "resume" ? "resume" : confirmation.objective;
  const ran = await deps.goalService.command(confirmation.sessionId, confirmation.directory, text);
  if (ran.kind === "unsupported") {
    await ctx.reply(t("goal.unsupported"));
    return true;
  }
  if (ran.kind === "rejected") {
    await ctx.reply(ran.message);
    return true;
  }
  if (ran.kind === "error") {
    await ctx.reply(t("goal.action_error"));
    return true;
  }

  const next = await deps.goalService.refresh(confirmation.sessionId, confirmation.directory, false);
  if (next.kind !== "goal") {
    await ctx.reply(next.kind === "unsupported" ? t("goal.unsupported") : t("goal.read_error"));
    return true;
  }

  await sendGoalText(ctx.api, ctx.chat!.id, formatGoalStatusText(next.goal));
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
    (metadata.action !== "start" && metadata.action !== "replace" && metadata.action !== "resume")
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
  };
}

function callbackMessageId(ctx: Context): number | null {
  const message = ctx.callbackQuery?.message;
  if (!message || !("message_id" in message)) {
    return null;
  }
  return message.message_id;
}
