import type { GoalManager } from "../../app/managers/goal-manager.js";
import { formatGoalStatus, truncateGoalObjective } from "../../app/formatters/goal-text.js";
import { t } from "../../i18n/index.js";

export const GOAL_BUTTON_TEXT_PATTERN = /^(?:◎|⏸|▶|×)\s[\s\S]+$/;
export type GoalButtonAction = "details" | "pause" | "resume" | "clear";

export function getGoalButtonLabels(manager: GoalManager): string[] {
  const { goal, sessionId } = manager.snapshot();
  if (!goal || !sessionId) {
    return [];
  }
  const action = goal.status === "active" ? "pause" : goal.status === "paused" ? "resume" : "clear";
  return [
    t("goal.button.details", {
      status: formatGoalStatus(goal.status),
      objective: truncateGoalObjective(goal.objective, 28),
    }),
    t(`goal.button.${action}`),
  ];
}

export function resolveGoalButton(manager: GoalManager, label: string): GoalButtonAction | null {
  const labels = getGoalButtonLabels(manager);
  if (label === labels[0]) {
    return "details";
  }
  if (label !== labels[1]) {
    return null;
  }
  const status = manager.snapshot().goal?.status;
  return status === "active" ? "pause" : status === "paused" ? "resume" : "clear";
}
