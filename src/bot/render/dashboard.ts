import type { SessionMetrics } from "../../app/managers/session-metrics-manager.js";
import type { ProjectInfo } from "../../app/types/project.js";
import type { SessionInfo } from "../../app/types/session.js";
import { t } from "../../i18n/index.js";
import { formatContextLine, formatCostLine } from "../pinned/pinned-message-format.js";
import { TELEGRAM_TEXT_MESSAGE_LIMIT } from "./limits.js";

interface DashboardProject {
  mainProjectPath: string;
  activeWorktreePath: string;
  branch: string | null;
  isLinkedWorktree: boolean;
}

function relativeFilePath(file: string, directory: string): string {
  const normalized = file.replace(/\\/g, "/");
  const prefix = `${directory.replace(/\\/g, "/").replace(/\/+$/u, "")}/`;
  if (normalized.startsWith(prefix)) return normalized.slice(prefix.length);
  const segments = normalized.split("/");
  return segments.length <= 3 ? normalized : `.../${segments.slice(-3).join("/")}`;
}

/** Keep short headings intact and share the remaining budget between longer names. */
function fitHeadings(headings: string[], budget: number): string[] {
  let remaining = budget - (headings.length - 1);
  const byLength = headings.map((line, index) => ({ line, index }));
  byLength.sort((left, right) => left.line.length - right.line.length);
  const result = [...headings];
  for (const [position, { line, index }] of byLength.entries()) {
    const allowance = Math.floor(remaining / (headings.length - position));
    const fitted = line.length > allowance
      ? `${line.slice(0, allowance - 1).replace(/[\uD800-\uDBFF]$/u, "")}…`
      : line;
    result[index] = fitted;
    remaining -= fitted.length;
  }
  return result;
}

export function renderDashboard({
  project,
  session,
  git,
  goal,
  metrics,
}: {
  project: ProjectInfo | undefined;
  session: SessionInfo | undefined;
  git: DashboardProject | null;
  goal: string | null;
  metrics: (SessionMetrics & { tokensLimit: number }) | null;
}): string {
  if (!project) return t("dashboard.card.no_project");
  const projectPath = git?.mainProjectPath ?? project.worktree;
  const projectName =
    project.name && project.name !== projectPath && project.name !== project.worktree
      ? `${project.name} (${projectPath})`
      : projectPath;
  const projectLine = t("pinned.line.project", {
    project: git?.branch ? `${projectName}: ${git.branch}` : projectName,
  });
  const headings = session
    ? [session.title.trim() || t("dashboard.button.unnamed_session"), ...(goal ? [goal] : []), projectLine]
    : [projectLine];
  if (git?.isLinkedWorktree) {
    headings.push(t("pinned.line.worktree", { worktree: git.activeWorktreePath }));
  }
  const details: string[] = [];
  if (!session) {
    details.push(t("dashboard.card.no_session"));
  }
  if (metrics?.tokensUsed != null) {
    details.push(formatContextLine(metrics.tokensUsed, metrics.tokensLimit));
  }
  if (metrics?.cost != null) details.push(formatCostLine(metrics.cost));
  const files = session ? metrics?.changedFiles : null;
  const moreFiles = (count: number) => t("pinned.files.more", { count });
  if (files?.length) {
    details.push("", t("pinned.files.title", { count: files.length }));
  }
  const detailsLength = details.reduce((length, line) => length + line.length + 1, 0);
  const moreLength = files?.length ? moreFiles(files.length).length + 1 : 0;
  const headingBudget = TELEGRAM_TEXT_MESSAGE_LIMIT - detailsLength - moreLength;
  const lines = [...fitHeadings(headings, headingBudget), ...details];

  if (files?.length) {
    let shown = 0;
    let totalLength = lines.join("\n").length;
    for (const file of files.slice(0, 10)) {
      const path = relativeFilePath(file.file, project.worktree);
      const counts = [
        ...(file.additions > 0 ? [`+${file.additions}`] : []),
        ...(file.deletions > 0 ? [`-${file.deletions}`] : []),
      ];
      const line = t("pinned.files.item", { path, diff: counts.length ? ` (${counts.join(" ")})` : "" });
      const remainingFiles = files.length - shown - 1;
      const tailLength = remainingFiles ? moreFiles(remainingFiles).length + 1 : 0;
      if (totalLength + line.length + 1 + tailLength > TELEGRAM_TEXT_MESSAGE_LIMIT) break;
      lines.push(line);
      totalLength += line.length + 1;
      shown++;
    }
    if (shown < files.length) lines.push(moreFiles(files.length - shown));
  }
  return lines.join("\n");
}
