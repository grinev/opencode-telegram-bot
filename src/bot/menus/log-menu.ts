import { InlineKeyboard } from "grammy";
import type { GitLogEntry } from "../../app/services/git-service.js";
import { t } from "../../i18n/index.js";

export const LOG_COMMIT_CALLBACK_PREFIX = "log:c:";

const MAX_SUBJECT_LENGTH = 34;

interface LogMenuView {
  text: string;
  keyboard: InlineKeyboard;
}

function truncateSubject(subject: string): string {
  if (subject.length <= MAX_SUBJECT_LENGTH) {
    return subject;
  }
  return `${subject.slice(0, MAX_SUBJECT_LENGTH - 1)}…`;
}

export function buildLogMenuView(commits: GitLogEntry[]): LogMenuView {
  const keyboard = new InlineKeyboard();

  commits.forEach((commit, index) => {
    if (index > 0) {
      keyboard.row();
    }
    const label = `${truncateSubject(commit.subject)} · ${commit.relativeDate}`;
    keyboard.text(label, `${LOG_COMMIT_CALLBACK_PREFIX}${index}`);
  });

  return {
    text: t("log.menu.title", { count: String(commits.length) }),
    keyboard,
  };
}
