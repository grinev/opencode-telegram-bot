import { CommandContext, Context, InlineKeyboard } from "grammy";
import type { AppContainer } from "../../app/bootstrap/app-container.js";
import {
  formatGoalConfirmation,
  formatGoalNotice,
  formatGoalStatusText,
  formatObjectiveTooLong,
  localizeGoalReason,
} from "../../app/formatters/goal-text.js";
import { isForegroundBusy } from "../../app/services/run-control-service.js";
import { getCurrentProject } from "../../app/stores/settings-store.js";
import { getCurrentSession } from "../../app/services/session-service.js";
import { parseGoalArgument } from "../../app/types/goal.js";
import type { GoalState } from "../../app/types/goal.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { replyBusyBlocked } from "../messages/busy-blocked-renderer.js";
import { sendGoalText } from "../messages/goal-delivery.js";

export type GoalCommandDeps = Pick<
  AppContainer,
  "foregroundSessionState" | "attachManager" | "goalService" | "interactionManager"
>;

const GOAL_CONFIRM = "goal:confirm";
const GOAL_CANCEL = "goal:cancel";

export function goalConfirmData(): string {
  return GOAL_CONFIRM;
}

export function goalCancelData(): string {
  return GOAL_CANCEL;
}

/**
 * `/goal` on OpenCode V2. V1 never registers it.
 */
export async function goalCommand(ctx: CommandContext<Context>, deps: GoalCommandDeps): Promise<void> {
  try {
    if (isForegroundBusy(deps)) {
      await replyBusyBlocked(ctx);
      return;
    }

    if (deps.interactionManager.getSnapshot()) {
      await ctx.reply(t("interaction.blocked.finish_current"));
      return;
    }

    const session = await selectedSession(ctx);
    if (!session) {
      return;
    }

    const argument = parseGoalArgument(typeof ctx.match === "string" ? ctx.match : "");
    if (argument.kind === "too_long") {
      await ctx.reply(formatObjectiveTooLong(argument.length));
      return;
    }

    if (argument.kind === "status") {
      await replyStatus(ctx, deps, session.id, session.directory);
      return;
    }

    if (argument.kind === "pause") {
      await pauseGoal(ctx, deps, session.id, session.directory);
      return;
    }

    if (argument.kind === "clear") {
      await clearGoal(ctx, deps, session.id, session.directory);
      return;
    }

    if (argument.kind === "resume") {
      await confirmResume(ctx, deps, session.id, session.directory);
      return;
    }

    await confirmObjective(ctx, deps, session.id, session.directory, argument.text);
  } catch (error) {
    logger.error("[Goal] Command failed", error);
    await ctx.reply(t("goal.action_error")).catch(() => {});
  }
}

async function selectedSession(ctx: Context): Promise<{ id: string; directory: string } | null> {
  const project = getCurrentProject();
  if (!project) {
    await ctx.reply(t("messages.project_not_selected"));
    return null;
  }

  const session = getCurrentSession();
  if (!session) {
    await ctx.reply(t("messages.session_not_selected"));
    return null;
  }

  if (session.directory !== project.worktree) {
    await ctx.reply(t("messages.session_project_mismatch"));
    return null;
  }

  return session;
}

async function replyStatus(
  ctx: Context,
  deps: GoalCommandDeps,
  sessionId: string,
  directory: string,
): Promise<void> {
  const result = await deps.goalService.refresh(sessionId, directory, false);
  await replyRead(ctx, result);
}

async function replyRead(
  ctx: Context,
  result: Awaited<ReturnType<GoalCommandDeps["goalService"]["read"]>>,
): Promise<void> {
  if (result.kind === "unsupported") {
    await ctx.reply(t("goal.unsupported"));
    return;
  }
  if (result.kind === "error") {
    await ctx.reply(t("goal.read_error"));
    return;
  }
  if (result.kind === "none") {
    await ctx.reply(t("goal.none"));
    return;
  }

  await sendGoalText(ctx.api, ctx.chat!.id, formatGoalStatusText(result.goal));
}

async function pauseGoal(
  ctx: Context,
  deps: GoalCommandDeps,
  sessionId: string,
  directory: string,
): Promise<void> {
  const outcome = await deps.goalService.pauseFromCommand(sessionId, directory);
  if (outcome.kind === "unsupported") {
    await ctx.reply(t("goal.unsupported"));
    return;
  }
  if (outcome.kind === "rejected") {
    await ctx.reply(outcome.message);
    return;
  }
  if (outcome.kind === "error") {
    await ctx.reply(t("goal.action_error"));
    return;
  }

  await ctx.reply(formatGoalNotice(outcome.notice));
}

async function clearGoal(
  ctx: Context,
  deps: GoalCommandDeps,
  sessionId: string,
  directory: string,
): Promise<void> {
  const result = await deps.goalService.command(sessionId, directory, "clear");
  if (result.kind === "unsupported") {
    await ctx.reply(t("goal.unsupported"));
    return;
  }
  if (result.kind === "rejected") {
    await ctx.reply(result.message);
    return;
  }
  if (result.kind === "error") {
    await ctx.reply(t("goal.action_error"));
    return;
  }

  await deps.goalService.refresh(sessionId, directory, false);
  await ctx.reply(t("goal.none"));
}

async function confirmResume(
  ctx: Context,
  deps: GoalCommandDeps,
  sessionId: string,
  directory: string,
): Promise<void> {
  const current = await deps.goalService.read(sessionId, directory);
  if (current.kind !== "goal" || current.goal.status !== "paused") {
    if (current.kind === "unsupported") {
      await ctx.reply(t("goal.unsupported"));
      return;
    }
    if (current.kind === "error") {
      await ctx.reply(t("goal.read_error"));
      return;
    }
    if (current.kind === "goal" && current.goal.status === "complete") {
      await ctx.reply(`${t("goal.status.complete")}: ${localizeGoalReason("No paused goal to resume.")}`);
      return;
    }
    await ctx.reply(localizeGoalReason("No paused goal to resume."));
    return;
  }

  await openConfirmation(ctx, deps, {
    action: "resume",
    sessionId,
    directory,
    goalId: current.goal.id,
    shownGoal: current.goal,
    objective: current.goal.objective,
    maxRounds: current.goal.maxRounds,
  });
}

async function confirmObjective(
  ctx: Context,
  deps: GoalCommandDeps,
  sessionId: string,
  directory: string,
  objective: string,
): Promise<void> {
  const current = await deps.goalService.read(sessionId, directory);
  if (current.kind === "unsupported") {
    await ctx.reply(t("goal.unsupported"));
    return;
  }
  if (current.kind === "error") {
    await ctx.reply(t("goal.read_error"));
    return;
  }

  await openConfirmation(ctx, deps, {
    action: current.kind === "goal" ? "replace" : "start",
    sessionId,
    directory,
    goalId: current.kind === "goal" ? current.goal.id : null,
    shownGoal: current.kind === "goal" ? current.goal : null,
    objective,
    ...(current.kind === "goal"
      ? { current: current.goal.objective, maxRounds: current.goal.maxRounds }
      : {}),
  });
}

interface ConfirmationRequest {
  action: "start" | "replace" | "resume";
  sessionId: string;
  directory: string;
  goalId: string | null;
  shownGoal: GoalState | null;
  objective: string;
  current?: string;
  maxRounds?: number;
}

async function openConfirmation(
  ctx: Context,
  deps: GoalCommandDeps,
  request: ConfirmationRequest,
): Promise<void> {
  const keyboard = new InlineKeyboard()
    .text(t("goal.confirm.confirm"), GOAL_CONFIRM)
    .text(t("goal.confirm.cancel"), GOAL_CANCEL);
  const sent = await ctx.reply(
    formatGoalConfirmation({
      action: request.action,
      objective: request.objective,
      ...(request.current !== undefined ? { current: request.current } : {}),
      ...(request.maxRounds !== undefined ? { maxRounds: request.maxRounds } : {}),
    }),
    { reply_markup: keyboard, link_preview_options: { is_disabled: true } },
  );

  deps.interactionManager.start({
    kind: "custom",
    expectedInput: "callback",
    metadata: {
      flow: "goal",
      stage: "confirm",
      messageId: sent.message_id,
      sessionId: request.sessionId,
      directory: request.directory,
      goalId: request.goalId,
      shownGoal: request.shownGoal,
      action: request.action,
      objective: request.objective,
    },
  });
}

export function isGoalConfirmation(metadata: Record<string, unknown> | undefined): boolean {
  return metadata?.flow === "goal" && metadata.stage === "confirm";
}

export type { GoalState };
