import { InlineKeyboard } from "grammy";
import type { GitRepoStatus } from "../../app/services/git-service.js";
import { t } from "../../i18n/index.js";

export const GIT_DIFF_CALLBACK = "git:diff";
export const GIT_COMMIT_CALLBACK = "git:commit";
export const GIT_WORKTREE_CALLBACK = "git:worktree";

interface GitMenuView {
  text: string;
  keyboard: InlineKeyboard;
}

function buildSyncLabel(status: GitRepoStatus): string {
  if (!status.hasUpstream) {
    return t("git.status.no_upstream");
  }

  if (status.ahead === 0 && status.behind === 0) {
    return t("git.status.synced");
  }

  return t("git.status.ahead_behind", {
    ahead: String(status.ahead),
    behind: String(status.behind),
  });
}

function buildChangesLabel(status: GitRepoStatus): string {
  const changes =
    status.changedCount === 0
      ? t("git.status.clean")
      : t("git.status.changed_files", { count: String(status.changedCount) });

  if (status.conflictCount > 0) {
    return `${changes} · ${t("git.status.conflicts", { count: String(status.conflictCount) })}`;
  }

  return changes;
}

export function buildGitMenuView(status: GitRepoStatus): GitMenuView {
  const keyboard = new InlineKeyboard()
    .text(t("git.button.diff"), GIT_DIFF_CALLBACK)
    .row()
    .text(t("git.button.commit"), GIT_COMMIT_CALLBACK)
    .row()
    .text(t("git.button.worktree"), GIT_WORKTREE_CALLBACK);

  const branch = status.detached ? t("git.status.detached") : status.branch;

  return {
    text: t("git.menu.title", {
      branch,
      sync: buildSyncLabel(status),
      changes: buildChangesLabel(status),
    }),
    keyboard,
  };
}
