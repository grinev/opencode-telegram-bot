export type GoalStatus = "active" | "paused" | "complete";

/** Server-owned session goal, as `opencode.goal` get returns it. */
export interface GoalState {
  id: string;
  objective: string;
  status: GoalStatus;
  reason?: string;
  rounds: number;
  maxRounds: number;
  updatedAt: number;
}

export interface GoalNotice {
  status: "paused" | "complete";
  reason?: string;
}

export type GoalArgument =
  | { kind: "status" }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "clear" }
  | { kind: "objective"; text: string }
  | { kind: "too_long"; length: number };

/** The server rejects an objective longer than this and does not start it. */
export const GOAL_OBJECTIVE_LIMIT = 4000;

export function parseGoalArgument(raw: string): GoalArgument {
  const text = raw.trim();
  if (text.length === 0) {
    return { kind: "status" };
  }

  const control = text.toLowerCase();
  if (control === "pause" || control === "resume" || control === "clear") {
    return { kind: control };
  }

  if (text.length > GOAL_OBJECTIVE_LIMIT) {
    return { kind: "too_long", length: text.length };
  }

  return { kind: "objective", text };
}
