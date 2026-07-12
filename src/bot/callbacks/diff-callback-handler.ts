import { Context, InputFile } from "grammy";
import { interactionManager } from "../../app/managers/interaction-manager.js";
import {
  getFileDiff,
  getFullPatch,
  type GitChangedFile,
} from "../../app/services/git-service.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { clearActiveInlineMenu, ensureActiveInlineMenu } from "../menus/inline-menu.js";
import { DIFF_FILE_CALLBACK_PREFIX, DIFF_PATCH_CALLBACK } from "../menus/diff-menu.js";
import { renderTelegramParts } from "../render/pipeline.js";

const MAX_DIFF_MESSAGE_PARTS = 5;
const MAX_MESSAGE_LENGTH = 4096;

interface DiffMenuMetadata {
  dir: string;
  files: GitChangedFile[];
}

function parseChangedFiles(value: unknown): GitChangedFile[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null || !("path" in item)) {
      return [];
    }

    const candidate = item as Partial<GitChangedFile>;
    if (typeof candidate.path !== "string") {
      return [];
    }

    return [
      {
        path: candidate.path,
        status: typeof candidate.status === "string" ? candidate.status : "",
        additions: typeof candidate.additions === "number" ? candidate.additions : null,
        deletions: typeof candidate.deletions === "number" ? candidate.deletions : null,
        binary: candidate.binary === true,
        untracked: candidate.untracked === true,
      },
    ];
  });
}

function parseDiffMenuMetadata(): DiffMenuMetadata | null {
  const state = interactionManager.getSnapshot();
  if (!state || state.kind !== "inline" || state.metadata.menuKind !== "diff") {
    return null;
  }

  const dir = state.metadata.dir;
  if (typeof dir !== "string" || !dir) {
    return null;
  }

  return {
    dir,
    files: parseChangedFiles(state.metadata.files),
  };
}

async function sendDiffText(ctx: Context, diffText: string): Promise<void> {
  const markdown = `\`\`\`diff\n${diffText}\n\`\`\``;
  const parts = renderTelegramParts(markdown, { maxPartLength: MAX_MESSAGE_LENGTH });

  for (const part of parts.slice(0, MAX_DIFF_MESSAGE_PARTS)) {
    try {
      await ctx.reply(part.text, { entities: part.entities });
    } catch {
      await ctx.reply(part.fallbackText);
    }
  }

  if (parts.length > MAX_DIFF_MESSAGE_PARTS) {
    await ctx.reply(t("diff.truncated_hint"));
  }
}

export async function handleDiffCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith("diff:")) {
    return false;
  }

  const isActiveMenu = await ensureActiveInlineMenu(ctx, "diff");
  if (!isActiveMenu) {
    return true;
  }

  const metadata = parseDiffMenuMetadata();
  if (!metadata) {
    clearActiveInlineMenu("diff_missing_metadata");
    await ctx.answerCallbackQuery({ text: t("diff.file_error"), show_alert: true }).catch(() => {});
    return true;
  }

  try {
    if (data === DIFF_PATCH_CALLBACK) {
      await ctx.answerCallbackQuery().catch(() => {});

      const patch = await getFullPatch(metadata.dir);
      if (!patch.trim()) {
        await ctx.reply(t("diff.no_changes"));
        return true;
      }

      await ctx.replyWithDocument(new InputFile(Buffer.from(patch, "utf-8"), "changes.patch"), {
        caption: t("diff.patch_caption"),
      });

      clearActiveInlineMenu("diff_patch_downloaded");
      await ctx.deleteMessage().catch(() => {});
      return true;
    }

    if (data.startsWith(DIFF_FILE_CALLBACK_PREFIX)) {
      const indexText = data.slice(DIFF_FILE_CALLBACK_PREFIX.length);
      const index = /^\d+$/.test(indexText) ? Number.parseInt(indexText, 10) : NaN;
      const file = metadata.files[index];

      if (!file) {
        await ctx
          .answerCallbackQuery({ text: t("diff.file_error"), show_alert: true })
          .catch(() => {});
        return true;
      }

      await ctx.answerCallbackQuery().catch(() => {});

      const diffText = await getFileDiff(metadata.dir, file.path, {
        untracked: file.untracked,
      });

      if (!diffText.trim()) {
        await ctx.reply(t("diff.no_changes"));
        return true;
      }

      // Keep the menu open so more files can be inspected.
      await sendDiffText(ctx, diffText);
      return true;
    }

    return false;
  } catch (error) {
    logger.error("[DiffHandler] Error handling diff callback:", error);
    await ctx.reply(t("diff.file_error")).catch(() => {});
    return true;
  }
}
