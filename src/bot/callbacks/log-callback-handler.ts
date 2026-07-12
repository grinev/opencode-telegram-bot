import type { Context } from "grammy";
import { interactionManager } from "../../app/managers/interaction-manager.js";
import { getCommitDiff, type GitLogEntry } from "../../app/services/git-service.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { clearActiveInlineMenu, ensureActiveInlineMenu } from "../menus/inline-menu.js";
import { LOG_COMMIT_CALLBACK_PREFIX } from "../menus/log-menu.js";
import { sendDiffText } from "./diff-callback-handler.js";

interface LogMenuMetadata {
  dir: string;
  commits: GitLogEntry[];
}

function parseLogEntries(value: unknown): GitLogEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) {
      return [];
    }

    const candidate = item as Partial<GitLogEntry>;
    if (typeof candidate.hash !== "string" || !candidate.hash) {
      return [];
    }

    return [
      {
        hash: candidate.hash,
        relativeDate: typeof candidate.relativeDate === "string" ? candidate.relativeDate : "",
        subject: typeof candidate.subject === "string" ? candidate.subject : "",
      },
    ];
  });
}

function parseLogMenuMetadata(): LogMenuMetadata | null {
  const state = interactionManager.getSnapshot();
  if (!state || state.kind !== "inline" || state.metadata.menuKind !== "log") {
    return null;
  }

  const dir = state.metadata.dir;
  if (typeof dir !== "string" || !dir) {
    return null;
  }

  return {
    dir,
    commits: parseLogEntries(state.metadata.commits),
  };
}

export async function handleLogCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith(LOG_COMMIT_CALLBACK_PREFIX)) {
    return false;
  }

  const isActiveMenu = await ensureActiveInlineMenu(ctx, "log");
  if (!isActiveMenu) {
    return true;
  }

  const metadata = parseLogMenuMetadata();
  if (!metadata) {
    clearActiveInlineMenu("log_missing_metadata");
    await ctx.answerCallbackQuery({ text: t("log.error"), show_alert: true }).catch(() => {});
    return true;
  }

  try {
    const indexText = data.slice(LOG_COMMIT_CALLBACK_PREFIX.length);
    const index = /^\d+$/.test(indexText) ? Number.parseInt(indexText, 10) : NaN;
    const commit = metadata.commits[index];

    if (!commit) {
      await ctx.answerCallbackQuery({ text: t("log.error"), show_alert: true }).catch(() => {});
      return true;
    }

    await ctx.answerCallbackQuery().catch(() => {});

    const diffText = await getCommitDiff(metadata.dir, commit.hash);

    // Keep the menu open so more commits can be inspected.
    await sendDiffText(ctx, diffText);
    return true;
  } catch (error) {
    logger.error("[LogHandler] Error handling log callback:", error);
    await ctx.reply(t("log.error")).catch(() => {});
    return true;
  }
}
