import { InlineKeyboard } from "grammy";
import type { GitChangedFile } from "../../app/services/git-service.js";
import { t } from "../../i18n/index.js";

export const DIFF_FILE_CALLBACK_PREFIX = "diff:f:";
export const DIFF_PATCH_CALLBACK = "diff:patch";

const MAX_PATH_LABEL_LENGTH = 40;

const STATUS_EMOJIS: Record<string, string> = {
  "??": "🆕",
  A: "➕",
  M: "✏️",
  D: "🗑️",
  R: "🔀",
  C: "📋",
};

function truncatePath(filePath: string): string {
  if (filePath.length <= MAX_PATH_LABEL_LENGTH) {
    return filePath;
  }

  return `…${filePath.slice(-(MAX_PATH_LABEL_LENGTH - 1))}`;
}

function formatFileLabel(file: GitChangedFile): string {
  const emoji = STATUS_EMOJIS[file.untracked ? "??" : file.status[0]] ?? "📄";

  let counts = "";
  if (file.binary) {
    counts = ` (${t("diff.binary_label")})`;
  } else if (file.additions !== null || file.deletions !== null) {
    counts = ` (+${file.additions ?? 0}/−${file.deletions ?? 0})`;
  }

  return `${emoji} ${truncatePath(file.path)}${counts}`;
}

export function buildDiffMenuView(files: GitChangedFile[]): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const keyboard = new InlineKeyboard();

  for (const [index, file] of files.entries()) {
    keyboard.text(formatFileLabel(file), `${DIFF_FILE_CALLBACK_PREFIX}${index}`).row();
  }

  keyboard.text(t("diff.button.patch"), DIFF_PATCH_CALLBACK);

  return {
    text: t("diff.menu.title", { count: files.length }),
    keyboard,
  };
}
