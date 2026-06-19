import path from "node:path";
import type { CommandContext, Context } from "grammy";
import { InlineKeyboard } from "grammy";
import {
  createGitWorktree,
  getGitWorktreeContext,
} from "../../app/services/worktree-service.js";
import { getProjectByWorktree } from "../../app/services/project-service.js";
import { switchToProject } from "../../app/services/project-switch-service.js";
import { upsertSessionDirectory } from "../../app/services/session-cache-service.js";
import { isForegroundBusy } from "../../app/services/run-control-service.js";
import { getCurrentProject } from "../../app/stores/settings-store.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { replyBusyBlocked } from "../messages/busy-blocked-renderer.js";
import { createProjectSwitchPresentation } from "../services/project-switch-presentation.js";
import {
  appendInlineMenuCancelButton,
  replyWithInlineMenu,
} from "../menus/inline-menu.js";
import { buildWorktreeMenuView } from "../menus/worktree-selection-menu.js";
import { interactionManager } from "../../app/managers/interaction-manager.js";
import type { GitWorktreeEntry } from "../../app/types/worktree.js";

const WORKTREE_HELP = `🌿 <b>Worktree Manager</b>

Manage git worktrees for the current repository.

<b>Usage:</b>
/worktree add [name] — Create a worktree (optional branch name)
/worktree list       — Show existing worktrees
/worktree switch       — Show menu to select a worktree
/worktree switch &lt;name&gt; — Switch directly by name or path
/worktree delete &lt;name&gt; — Delete a worktree (not yet implemented)
/worktree help       — Show this message`;

async function loadCurrentWorktreeContext() {
  const currentProject = getCurrentProject();
  if (!currentProject) {
    return { currentProject: null, context: null };
  }

  const context = await getGitWorktreeContext(currentProject.worktree);
  return { currentProject, context };
}

function matchWorktreeEntry(
  entries: GitWorktreeEntry[],
  name: string,
): GitWorktreeEntry | undefined {
  // Try exact path match first
  const byPath = entries.find((e) => e.path === name);
  if (byPath) return byPath;

  // Try path basename match
  const byBaseName = entries.find((e) => path.basename(e.path) === name);
  if (byBaseName) return byBaseName;

  // Try branch name match
  const byBranch = entries.find((e) => e.branch === name);
  if (byBranch) return byBranch;

  return undefined;
}

async function handleWorktreeAdd(
  ctx: CommandContext<Context>,
  name?: string,
): Promise<void> {
  const currentProject = getCurrentProject();
  if (!currentProject) {
    await ctx.reply(t("worktree_add.no_project"));
    return;
  }

  const nameArg = name?.trim();

  if (nameArg) {
    logger.info(`[WorktreeCommand] Creating worktree with name: ${nameArg}`);
    const result = await createGitWorktree(nameArg);

    if (result.error) {
      logger.error(`[WorktreeCommand] Creation failed: ${result.error}`);
      await ctx.reply(t("worktree_add.error", { error: result.error }));
      return;
    }

    logger.info(`[WorktreeCommand] Worktree created: ${result.path}`);
    await ctx.reply(
      t("worktree_add.success", {
        name: nameArg,
        api_branch: result.apiBranch ?? nameArg,
        path: result.path,
      }),
    );
  } else {
    await ctx.reply(t("worktree_add.name_prompt"));

    interactionManager.start({
      kind: "worktree-add",
      expectedInput: "text",
      metadata: {},
    });

    logger.debug("[WorktreeCommand] Started worktree-add text input interaction");
  }
}

async function handleWorktreeList(ctx: CommandContext<Context>): Promise<void> {
  const { currentProject, context } = await loadCurrentWorktreeContext();

  if (!currentProject) {
    await ctx.reply(t("worktree.project_not_selected"));
    return;
  }

  if (!context) {
    await ctx.reply(t("worktree.not_git_repo"));
    return;
  }

  if (context.worktrees.length === 0) {
    await ctx.reply(t("worktree.empty"));
    return;
  }

  const lines = context.worktrees.map((entry) => {
    const marker = entry.isCurrent ? "✅" : "•";
    const branch = entry.branch ?? "(detached HEAD)";
    const mainLabel = entry.isMain ? " (main)" : "";
    return `${marker} ${entry.path}${mainLabel} — ${branch}`;
  });

  const header = `📋 Worktrees for current repository:\n\n`;
  await ctx.reply(header + lines.join("\n"));
}

async function handleWorktreeSwitch(
  ctx: CommandContext<Context>,
  name: string | undefined,
): Promise<void> {
  const { currentProject, context: worktreeContext } = await loadCurrentWorktreeContext();

  if (!currentProject) {
    await ctx.reply(t("worktree.project_not_selected"));
    return;
  }

  if (!worktreeContext) {
    await ctx.reply(t("worktree.not_git_repo"));
    return;
  }

  if (!name) {
    if (worktreeContext.worktrees.length === 0) {
      await ctx.reply(t("worktree.empty"));
      return;
    }

    const { text, keyboard } = buildWorktreeMenuView(worktreeContext.worktrees, 0);
    await replyWithInlineMenu(ctx, { menuKind: "worktree", text, keyboard });
    return;
  }

  const matched = matchWorktreeEntry(worktreeContext.worktrees, name);
  if (!matched) {
    const available = worktreeContext.worktrees
      .map((e: GitWorktreeEntry) => `  • ${path.basename(e.path)} (${e.path})`)
      .join("\n");
    await ctx.reply(
      `⚠️ Worktree "${name}" not found.\n\nAvailable worktrees:\n${available}`,
    );
    return;
  }

  if (matched.isCurrent) {
    await ctx.reply(`✅ Already on worktree: ${matched.path}`);
    return;
  }

  logger.info(`[WorktreeCommand] Switching to worktree: ${matched.path}`);
  const statusMsg = await ctx.reply(`⏳ Switching to worktree: ${matched.path}...`);

  try {
    await upsertSessionDirectory(matched.path, Date.now());
    const projectInfo = await getProjectByWorktree(matched.path);
    const selectedProjectInfo = { ...projectInfo, name: matched.path };
    const replyKeyboard = await switchToProject(ctx, selectedProjectInfo, "worktree_switched", {
      presentation: createProjectSwitchPresentation(),
    });

    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      `✅ Switched to worktree: ${matched.path}`,
    );
    await ctx.reply(
      `✅ Worktree selected: ${matched.path}\n\n📋 Session was reset. Use /sessions or /new to continue.`,
      { reply_markup: replyKeyboard },
    );
  } catch (error) {
    logger.error(`[WorktreeCommand] Failed to switch worktree:`, error);
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      `🔴 Failed to switch to worktree: ${matched.path}`,
    );
  }
}

async function handleWorktreeDelete(
  ctx: CommandContext<Context>,
  name: string | undefined,
): Promise<void> {
  const { currentProject, context } = await loadCurrentWorktreeContext();

  if (!currentProject) {
    await ctx.reply(t("worktree.project_not_selected"));
    return;
  }

  if (!context) {
    await ctx.reply(t("worktree.not_git_repo"));
    return;
  }

  if (!name) {
    if (context.worktrees.length === 0) {
      await ctx.reply(t("worktree.empty"));
      return;
    }

    const { text, keyboard } = buildWorktreeMenuView(context.worktrees, 0);
    await replyWithInlineMenu(ctx, { menuKind: "worktree", text, keyboard });
    return;
  }

  const matched = matchWorktreeEntry(context.worktrees, name);
  if (!matched) {
    const available = context.worktrees
      .map((e: GitWorktreeEntry) => `  • ${path.basename(e.path)} (${e.path})`)
      .join("\n");
    await ctx.reply(
      `⚠️ Worktree "${name}" not found.\n\nAvailable worktrees:\n${available}`,
    );
    return;
  }

  if (matched.isCurrent) {
    await ctx.reply(`✅ Cannot delete worktree that is currently checked out: ${matched.path}`);
    return;
  }

  logger.info(`[WorktreeCommand] Deleting worktree: ${matched.path}`);

  const confirmationId = `worktree_delete_${matched.path.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}`;
  const confirmationCallbackData = `worktree_delete:confirm:${confirmationId}`;
  const cancelCallbackData = `worktree_delete:cancel:${confirmationId}`;

  const menuText = t("worktree.delete.confirmation", {
    path: matched.path,
    name: path.basename(matched.path),
  });

  const menuKeyboard = InlineKeyboard.from([
    [
      { text: t("worktree.delete.button.yes"), callback_data: confirmationCallbackData },
      { text: t("worktree.delete.button.no"), callback_data: cancelCallbackData },
    ],
  ]);

  appendInlineMenuCancelButton(menuKeyboard, "worktree");

  const confirmationMessage = await ctx.reply(menuText, {
    reply_markup: menuKeyboard,
  });

  interactionManager.start({
    kind: "inline",
    expectedInput: "callback",
    metadata: {
      menuKind: "worktree-delete",
      messageId: confirmationMessage.message_id,
      confirmationId,
      worktreePath: matched.path,
      requestTime: Date.now(),
      ctxId: ctx.from?.id,
    },
  });

  logger.debug("[WorktreeCommand] Deletion confirmation requested for worktree", {
    path: matched.path,
    userId: ctx.chat.id,
    confirmationId,
  });
}

function handleWorktreeHelp(ctx: CommandContext<Context>): void {
  void ctx.reply(WORKTREE_HELP, { parse_mode: "HTML" });
}

export async function worktreeCommand(ctx: CommandContext<Context>): Promise<void> {
  try {
    if (isForegroundBusy()) {
      await replyBusyBlocked(ctx);
      return;
    }

    const args = ctx.match?.trim() ?? "";
    const parts = args.split(/\s+/).filter(Boolean);
    const subcommand = parts[0]?.toLowerCase();
    const subarg = parts.slice(1).join(" ") || undefined;

    switch (subcommand) {
      case "add":
        await handleWorktreeAdd(ctx, subarg);
        break;
      case "list":
        await handleWorktreeList(ctx);
        break;
      case "switch":
        await handleWorktreeSwitch(ctx, subarg);
        break;
      case "delete":
        await handleWorktreeDelete(ctx, subarg);
        break;
      case "help":
      case undefined:
      case "":
        handleWorktreeHelp(ctx);
        break;
      default:
        await ctx.reply(
          `⚠️ Unknown subcommand: "${subcommand}". Use /worktree help to see available commands.`,
        );
        break;
    }
  } catch (error) {
    logger.error("[WorktreeCommand] Error in command handler:", error);
    await ctx.reply(t("worktree.fetch_error"));
  }
}
