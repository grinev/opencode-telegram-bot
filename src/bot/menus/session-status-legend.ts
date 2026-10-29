import { t } from "../../i18n/index.js";
import type { SessionRunStatus } from "../../app/services/session-status-service.js";

/** Shared by /sessions and /recent: the glyph before each session and the legend line. */
export const SESSION_STATUS_GLYPHS: Record<SessionRunStatus, string> = {
  running: "⏳",
  idle: "○",
  question: "❓",
  permission: "🔐",
};

const LEGEND_KEYS: Array<[SessionRunStatus, "recent.running" | "recent.idle" | "recent.question" | "recent.permission"]> = [
  ["running", "recent.running"],
  ["idle", "recent.idle"],
  ["question", "recent.question"],
  ["permission", "recent.permission"],
];

export function buildSessionStatusLegend(): string {
  return LEGEND_KEYS.map(([status, key]) => `${SESSION_STATUS_GLYPHS[status]} ${t(key)}`).join(
    " · ",
  );
}
