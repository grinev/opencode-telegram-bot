import { InlineKeyboard } from "grammy";
import { t } from "../../i18n/index.js";

export const GIT_DIFF_CALLBACK = "git:diff";
export const GIT_COMMIT_CALLBACK = "git:commit";

interface GitMenuView {
  text: string;
  keyboard: InlineKeyboard;
}

export function buildGitMenuView(): GitMenuView {
  const keyboard = new InlineKeyboard()
    .text(t("git.button.diff"), GIT_DIFF_CALLBACK)
    .row()
    .text(t("git.button.commit"), GIT_COMMIT_CALLBACK);

  return {
    text: t("git.menu.title"),
    keyboard,
  };
}
