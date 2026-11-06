import { randomUUID } from "node:crypto";
import { CommandContext, Context, InlineKeyboard } from "grammy";
import type { AppContainer } from "../../app/bootstrap/app-container.js";
import {
  formatGoalConfirmation,
  formatGoalNotice,
  formatGoalStatusText,
  formatObjectiveTooLong,
} from "../../app/formatters/goal-text.js";
import { isForegroundBusy } from "../../app/services/run-control-service.js";
import { getCurrentProject } from "../../app/stores/settings-store.js";
import { getCurrentSession } from "../../app/services/session-service.js";
import { parseGoalObjective, type GoalState } from "../../app/types/goal.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { resolveGoalButton, type GoalButtonAction } from "../keyboards/goal-button.js";
import { replyBusyBlocked } from "../messages/busy-blocked-renderer.js";
import { sendGoalText } from "../messages/goal-delivery.js";
import { convertRichMessage, getIncomingPrompt } from "../handlers/rich-message-handler.js";

export type GoalCommandDeps = Pick<
  AppContainer,
  | "foregroundSessionState"
  | "attachManager"
  | "goalService"
  | "goalManager"
  | "interactionManager"
  | "keyboardManager"
>;

export const goalConfirmData = (): string => "goal:confirm";
export const goalCancelData = (): string => "goal:cancel";
export const goalDeleteData = (token: string): string => `goal:delete:${token}`;

export async function replyGoalText(
  ctx: Context,
  deps: GoalCommandDeps,
  text: string,
): Promise<void> {
  await sendGoalText(ctx.api, ctx.chat!.id, text, deps.keyboardManager.getKeyboard());
}

export async function goalCommand(
  ctx: CommandContext<Context>,
  deps: GoalCommandDeps,
): Promise<void> {
  try {
    if (deps.interactionManager.getSnapshot()) {
      await ctx.reply(t("interaction.blocked.finish_current"));
      return;
    }
    if (typeof ctx.match === "string" && ctx.match.trim()) {
      await replyGoalText(ctx, deps, t("goal.arguments_not_supported"));
      return;
    }
    const session = await selectedSession(ctx);
    if (!session) return;
    if (getCurrentSession()?.id !== session.id) {
      await replyGoalText(ctx, deps, t("inline.inactive_callback"));
      return;
    }
    deps.goalService.follow(session.id);
    const result = await deps.goalService.refresh(session.id, session.directory, false);
    if (getCurrentSession()?.id !== session.id || deps.interactionManager.getSnapshot()) {
      await replyGoalText(ctx, deps, t("inline.inactive_callback"));
      return;
    }
    if (result.kind === "goal") {
      await showGoalDetails(ctx, deps, result.goal);
    } else if (result.kind === "none") {
      if (isForegroundBusy(deps)) {
        await replyBusyBlocked(ctx);
        return;
      }
      await openGoalInput(ctx, deps, session);
    } else {
      await replyGoalText(
        ctx,
        deps,
        t(result.kind === "unsupported" ? "goal.unsupported" : "goal.read_error"),
      );
    }
  } catch (error) {
    logger.error("[Goal] Command failed", error);
    await replyGoalText(ctx, deps, t("goal.action_error"));
  }
}

async function selectedSession(ctx: Context): Promise<{ id: string; directory: string } | null> {
  const project = getCurrentProject();
  const session = getCurrentSession();
  const key = !project
    ? "messages.project_not_selected"
    : !session
      ? "messages.session_not_selected"
      : session.directory !== project.worktree
        ? "messages.session_project_mismatch"
        : null;
  if (key) {
    await ctx.reply(t(key));
    return null;
  }
  return session;
}

async function openGoalInput(
  ctx: Context,
  deps: GoalCommandDeps,
  session: { id: string; directory: string },
): Promise<void> {
  const requestId = randomUUID();
  deps.interactionManager.start({
    kind: "custom",
    expectedInput: "text",
    metadata: {
      flow: "goal",
      stage: "objective",
      requestId,
      sessionId: session.id,
      directory: session.directory,
    },
  });
  try {
    const message = await ctx.reply(t("goal.input.prompt"), {
      reply_markup: new InlineKeyboard().text(t("goal.confirm.cancel"), goalCancelData()),
    });
    if (deps.interactionManager.getSnapshot()?.metadata.requestId === requestId) {
      deps.interactionManager.transition({
        metadata: {
          ...deps.interactionManager.getSnapshot()!.metadata,
          messageId: message.message_id,
        },
      });
    } else {
      await ctx.api
        .editMessageText(ctx.chat!.id, message.message_id, t("inline.inactive_callback"))
        .catch(() => {});
    }
  } catch (error) {
    if (deps.interactionManager.getSnapshot()?.metadata.requestId === requestId)
      deps.interactionManager.clear("goal_input_failed");
    throw error;
  }
}

export async function handleGoalTextInput(ctx: Context, deps: GoalCommandDeps): Promise<boolean> {
  const state = deps.interactionManager.getSnapshot();
  if (state?.metadata.flow !== "goal" || state.metadata.stage !== "objective") return false;
  const message = ctx.message;
  const richMedia =
    message?.rich_message && convertRichMessage(message.rich_message.blocks).skippedMediaCount;
  if (
    message?.photo?.length ||
    message?.voice ||
    message?.audio ||
    message?.document ||
    getIncomingPrompt(ctx)?.photos.length ||
    richMedia
  ) {
    await ctx.reply(t("interaction.blocked.expected_text"));
    return true;
  }
  const text = ctx.message?.text;
  if (text === undefined || text.startsWith("/")) return false;
  const objective = parseGoalObjective(text);
  if (objective.kind !== "objective") {
    await ctx.reply(
      objective.kind === "too_long"
        ? formatObjectiveTooLong(objective.length)
        : t(objective.kind === "reserved" ? "goal.input.reserved" : "goal.input.empty"),
    );
    return true;
  }
  deps.interactionManager.transition({
    expectedInput: "callback",
    metadata: { ...state.metadata, stage: "validating" },
  });
  try {
    const session = getCurrentSession();
    if (
      !session ||
      session.id !== state.metadata.sessionId ||
      session.directory !== state.metadata.directory ||
      isForegroundBusy(deps)
    ) {
      deps.interactionManager.clear("goal_input_inactive");
      await replyGoalText(ctx, deps, t("inline.inactive_callback"));
      return true;
    }
    const current = await deps.goalService.read(session.id, session.directory);
    if (deps.interactionManager.getSnapshot()?.metadata.requestId !== state.metadata.requestId)
      return true;
    if (current.kind === "error" || current.kind === "unsupported") {
      deps.interactionManager.transition({ expectedInput: "text", metadata: state.metadata });
      await ctx.reply(t(current.kind === "unsupported" ? "goal.unsupported" : "goal.read_error"));
      return true;
    }
    if (
      current.kind !== "none" ||
      getCurrentSession()?.id !== session.id ||
      isForegroundBusy(deps)
    ) {
      deps.interactionManager.clear("goal_input_inactive");
      await replyGoalText(ctx, deps, t("inline.inactive_callback"));
      return true;
    }
    await openGoalConfirmation(ctx, deps, session, "start", objective.text, null);
  } catch (error) {
    logger.error("[Goal] Objective input failed", error);
    if (deps.interactionManager.getSnapshot()?.metadata.requestId === state.metadata.requestId) {
      deps.interactionManager.transition({ expectedInput: "text", metadata: state.metadata });
    }
    await replyGoalText(ctx, deps, t("goal.action_error"));
  }
  return true;
}

async function showGoalDetails(
  ctx: Context,
  deps: GoalCommandDeps,
  goal: GoalState,
): Promise<void> {
  const markup =
    goal.status === "paused"
      ? new InlineKeyboard().text(
          t("goal.delete"),
          goalDeleteData(deps.goalManager.getControlToken()),
        )
      : deps.keyboardManager.getKeyboard();
  await sendGoalText(ctx.api, ctx.chat!.id, formatGoalStatusText(goal), markup);
}

export async function handleGoalButton(ctx: Context, deps: GoalCommandDeps): Promise<void> {
  const label = ctx.message?.text ?? "";
  const action = resolveGoalButton(deps.goalManager, label);
  if (!action) {
    await replyGoalText(ctx, deps, t("inline.inactive_callback"));
    return;
  }
  await handleGoalAction(ctx, deps, action, deps.goalManager.getControlToken());
}

export async function handleGoalAction(
  ctx: Context,
  deps: GoalCommandDeps,
  action: GoalButtonAction,
  token: string,
): Promise<void> {
  try {
    if (deps.interactionManager.getSnapshot()) {
      await ctx.reply(t("interaction.blocked.finish_current"));
      return;
    }
    if (action !== "details" && action !== "pause" && isForegroundBusy(deps)) {
      await replyBusyBlocked(ctx);
      return;
    }
    const shown = deps.goalManager.snapshot();
    const session = getCurrentSession();
    if (
      !shown.goal ||
      !session ||
      shown.sessionId !== session.id ||
      token !== deps.goalManager.getControlToken()
    ) {
      await replyGoalText(ctx, deps, t("inline.inactive_callback"));
      return;
    }
    const current = await deps.goalService.refresh(session.id, session.directory, false);
    if (current.kind === "error" || current.kind === "unsupported") {
      await replyGoalText(
        ctx,
        deps,
        t(current.kind === "unsupported" ? "goal.unsupported" : "goal.read_error"),
      );
      return;
    }
    if (
      getCurrentSession()?.id !== session.id ||
      deps.interactionManager.getSnapshot() ||
      token !== deps.goalManager.getControlToken() ||
      current.kind !== "goal" ||
      current.goal.id !== shown.goal.id
    ) {
      await replyGoalText(ctx, deps, t("inline.inactive_callback"));
      return;
    }
    if (action === "details") {
      await showGoalDetails(ctx, deps, current.goal);
      return;
    }
    if (
      (action === "pause" && current.goal.status !== "active") ||
      (action === "resume" && current.goal.status !== "paused") ||
      (action === "clear" && current.goal.status === "active")
    ) {
      await replyGoalText(ctx, deps, t("inline.inactive_callback"));
      return;
    }
    if (action !== "pause" && isForegroundBusy(deps)) {
      await replyBusyBlocked(ctx);
      return;
    }
    if (action === "resume") {
      await openGoalConfirmation(
        ctx,
        deps,
        session,
        "resume",
        current.goal.objective,
        current.goal,
      );
      return;
    }
    if (!deps.goalManager.claimControl(token)) {
      await replyGoalText(ctx, deps, t("inline.inactive_callback"));
      return;
    }
    if (action === "pause") {
      const result = await deps.goalService.pauseFromCommand(session.id, session.directory);
      if (getCurrentSession()?.id !== session.id) return;
      if (
        result.kind !== "paused" &&
        (deps.goalManager.snapshot().goal?.id !== shown.goal.id ||
          deps.goalManager.snapshot().goal?.status !== shown.goal.status)
      ) {
        await replyGoalText(ctx, deps, t("inline.inactive_callback"));
        return;
      }
      await replyGoalText(
        ctx,
        deps,
        result.kind === "paused"
          ? formatGoalNotice(result.notice)
          : result.kind === "rejected"
            ? result.message
            : t(result.kind === "unsupported" ? "goal.unsupported" : "goal.action_error"),
      );
      return;
    }
    const result = await deps.goalService.command(session.id, session.directory, "clear");
    if (getCurrentSession()?.id !== session.id) return;
    if (result.kind !== "ok") {
      await replyGoalText(
        ctx,
        deps,
        result.kind === "rejected"
          ? result.message
          : t(result.kind === "unsupported" ? "goal.unsupported" : "goal.action_error"),
      );
      return;
    }
    const next = await deps.goalService.refresh(session.id, session.directory, false);
    if (getCurrentSession()?.id !== session.id) return;
    await replyGoalText(
      ctx,
      deps,
      next.kind === "none"
        ? t("goal.deleted")
        : t(next.kind === "unsupported" ? "goal.unsupported" : "goal.read_error"),
    );
  } catch (error) {
    logger.error("[Goal] Button action failed", error);
    await replyGoalText(ctx, deps, t("goal.action_error"));
  }
}

async function openGoalConfirmation(
  ctx: Context,
  deps: GoalCommandDeps,
  session: { id: string; directory: string },
  action: "start" | "resume",
  objective: string,
  goal: GoalState | null,
): Promise<void> {
  const requestId = randomUUID();
  deps.interactionManager.start({
    kind: "custom",
    expectedInput: "callback",
    metadata: { flow: "goal", stage: "opening", requestId },
  });
  try {
    const sent = await ctx.reply(
      formatGoalConfirmation({ action, objective, ...(goal ? { maxRounds: goal.maxRounds } : {}) }),
      {
        reply_markup: new InlineKeyboard()
          .text(t(action === "start" ? "goal.start" : "goal.continue"), goalConfirmData())
          .text(t("goal.confirm.cancel"), goalCancelData()),
        link_preview_options: { is_disabled: true },
      },
    );
    if (deps.interactionManager.getSnapshot()?.metadata.requestId !== requestId) {
      await ctx.api
        .editMessageText(ctx.chat!.id, sent.message_id, t("inline.inactive_callback"))
        .catch(() => {});
      return;
    }
    deps.interactionManager.transition({
      metadata: {
        flow: "goal",
        stage: "confirm",
        requestId,
        messageId: sent.message_id,
        sessionId: session.id,
        directory: session.directory,
        goalId: goal?.id ?? null,
        shownGoal: goal,
        action,
        objective,
        controlToken: deps.goalManager.getControlToken(),
      },
    });
  } catch (error) {
    if (deps.interactionManager.getSnapshot()?.metadata.requestId === requestId)
      deps.interactionManager.clear("goal_confirmation_failed");
    throw error;
  }
}
