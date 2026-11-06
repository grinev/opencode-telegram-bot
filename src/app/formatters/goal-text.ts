import { getDateLocale, t } from "../../i18n/index.js";
import type { GoalNotice, GoalState, GoalStatus } from "../types/goal.js";
import { GOAL_OBJECTIVE_LIMIT } from "../types/goal.js";

const DASHBOARD_OBJECTIVE_LIMIT = 120;
const CONFIRMATION_LIMIT = 3800;
const ELLIPSIS = "…";

export type AbortPauseOutcome =
  | { kind: "silent" }
  | { kind: "paused"; reason: string }
  | { kind: "failed"; reason: string };

export function flattenGoalObjective(objective: string): string {
  return objective.replace(/\s+/g, " ").trim();
}

export function truncateGoalObjective(objective: string, limit = DASHBOARD_OBJECTIVE_LIMIT): string {
  const line = flattenGoalObjective(objective);
  if (line.length <= limit) {
    return line;
  }

  return `${line.slice(0, Math.max(0, limit - 1)).trimEnd()}${ELLIPSIS}`;
}

export function formatGoalStatus(status: GoalStatus): string {
  if (status === "paused") {
    return t("goal.status.paused");
  }
  if (status === "complete") {
    return t("goal.status.complete");
  }
  return t("goal.status.active");
}

export function formatDashboardGoalLine(goal: GoalState | null): string | null {
  if (!goal) {
    return null;
  }

  return t("pinned.line.goal", {
    status: formatGoalStatus(goal.status),
    objective: truncateGoalObjective(goal.objective),
  });
}

export function formatGoalUpdatedAt(updatedAt: number): string {
  return new Intl.DateTimeFormat(getDateLocale(), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(updatedAt));
}

export function formatGoalStatusText(goal: GoalState): string {
  const lines = [
    goal.objective,
    "",
    `◎ ${formatGoalStatus(goal.status)}`,
    t("goal.status.rounds", { rounds: goal.rounds, maxRounds: goal.maxRounds }),
  ];

  if (goal.reason) {
    lines.push(localizeGoalReason(goal.reason));
  }

  lines.push(t("goal.status.updated", { time: formatGoalUpdatedAt(goal.updatedAt) }));
  return lines.join("\n");
}

export function formatGoalNotice(notice: GoalNotice): string {
  const reason = notice.reason ? localizeGoalReason(notice.reason) : t("goal.notice.no_reason");
  const key = notice.status === "complete" ? "goal.notice.complete" : "goal.notice.paused";
  return t(key, { status: formatGoalStatus(notice.status), reason });
}

export function formatGoalWarning(maxRounds?: number): string {
  const warning = t("goal.confirm.warning");
  if (maxRounds === undefined) {
    return warning;
  }

  return `${warning}\n${t("goal.confirm.round_limit", { rounds: maxRounds })}`;
}

export function formatGoalConfirmation(options: {
  action: "start" | "resume";
  objective: string;
  maxRounds?: number;
}): string {
  const warning = formatGoalWarning(options.maxRounds);
  const body = options.action === "resume"
        ? t("goal.confirm.resume", { objective: options.objective })
        : t("goal.confirm.start", { objective: options.objective });

  return fitConfirmation(warning, body);
}

export function formatAbortWithGoalPause(abortText: string, outcome: AbortPauseOutcome): string {
  if (outcome.kind === "silent") {
    return abortText;
  }

  const clause =
    outcome.kind === "paused"
      ? t("goal.abort.paused", { reason: outcome.reason })
      : t("goal.abort.failed", { reason: outcome.reason });
  return `${clause}\n\n${abortText}`;
}

/** Known fixed server sentences, including a fixed prefix with a free-form tail. */
export function localizeGoalReason(reason: string): string {
  const exact: Record<string, string> = {
    "Paused by the user": t("goal.reason.paused_by_user"),
    "Stopped by the user": t("goal.reason.stopped_by_user"),
    "The server restarted while the goal was active": t("goal.reason.server_restarted"),
    "The goal stopped after an error": t("goal.reason.stopped_after_error"),
    "The goal reviewer gave no usable verdict": t("goal.reason.no_verdict"),
    "The goal reviewer's request is too large for the model": t("goal.reason.review_too_large"),
    "No active goal to pause.": t("goal.reason.no_active"),
    "No paused goal to resume.": t("goal.reason.no_paused"),
    "No goal is set.": t("goal.reason.none_set"),
  };
  const known = exact[reason];
  if (known) {
    return known;
  }

  const roundLimit = /^Reached the limit of (\d+) rounds$/.exec(reason);
  if (roundLimit?.[1]) {
    return t("goal.reason.round_limit", { rounds: roundLimit[1] });
  }

  const waitLimit = /^Nothing ran for (\d+) minutes while the goal waited on background work$/.exec(
    reason,
  );
  if (waitLimit?.[1]) {
    return t("goal.reason.wait_limit", { minutes: waitLimit[1] });
  }

  const stalled = /^Not making progress: ([\s\S]+)$/.exec(reason);
  if (stalled?.[1]) {
    return t("goal.reason.not_progress", { reason: stalled[1] });
  }

  const failed = /^The session failed: ([\s\S]+)$/.exec(reason);
  if (failed?.[1]) {
    return t("goal.reason.session_failed", { reason: failed[1] });
  }

  const tooLong = /^A goal objective is limited to (\d+) characters \(got (\d+)\)\.$/.exec(reason);
  if (tooLong?.[1] && tooLong[2]) {
    return t("goal.reason.objective_limit", { limit: tooLong[1], count: tooLong[2] });
  }

  return reason;
}

export function isNoActiveGoalReason(reason: string): boolean {
  const trimmed = reason.trim();
  return trimmed === "No active goal to pause." || trimmed === t("goal.reason.no_active");
}

export function formatObjectiveTooLong(length: number): string {
  return t("goal.too_long", { limit: GOAL_OBJECTIVE_LIMIT, count: length });
}

function fitConfirmation(warning: string, body: string): string {
  const combined = `${warning}\n\n${body}`;
  if (combined.length <= CONFIRMATION_LIMIT) {
    return combined;
  }

  const room = CONFIRMATION_LIMIT - warning.length - 2;
  if (room <= ELLIPSIS.length) {
    return warning;
  }

  return `${warning}\n\n${body.slice(0, room - ELLIPSIS.length).trimEnd()}${ELLIPSIS}`;
}
