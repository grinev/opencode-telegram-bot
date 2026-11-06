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

export type GoalObjective =
  | { kind: "empty" }
  | { kind: "reserved" }
  | { kind: "objective"; text: string }
  | { kind: "too_long"; length: number };

/** The server rejects an objective longer than this and does not start it. */
export const GOAL_OBJECTIVE_LIMIT = 4000;

export function parseGoalObjective(raw: string): GoalObjective {
  const text = raw.trim();
  if (text.length === 0) {
    return { kind: "empty" };
  }

  const pairs: Record<string, string> = { '"': '"', "'": "'", "“": "”", "‘": "’" };
  const unquoted = pairs[text.charAt(0)] === text.at(-1) ? text.slice(1, -1).trim() : text;
  if (!unquoted) {
    return { kind: "empty" };
  }
  const control = unquoted.toLowerCase();
  if (control === "pause" || control === "resume" || control === "clear") {
    return { kind: "reserved" };
  }

  if (text.length > GOAL_OBJECTIVE_LIMIT) {
    return { kind: "too_long", length: text.length };
  }

  return { kind: "objective", text };
}
