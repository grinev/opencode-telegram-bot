import type { Bot, CommandContext, Context } from "grammy";
import { getCurrentProject } from "../../settings/manager.js";
import { getCurrentSession } from "../../session/manager.js";
import { attachToSession } from "../../attach/service.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";

export interface AttachCommandDeps {
  bot: Bot<Context>;
  ensureEventSubscription: (directory: string) => Promise<void>;
}

function buildAttachReply(params: {
  title: string;
  busy: boolean;
  alreadyAttached: boolean;
  restoredQuestion: boolean;
  restoredPermissions: number;
}): string {
  const lines = [
    params.alreadyAttached
      ? t("attach.already_connected", { title: params.title })
      : t("attach.connected", { title: params.title }),
    t(params.busy ? "attach.status.busy_message" : "attach.status.idle_message"),
  ];

  if (params.restoredQuestion) {
    lines.push(t("attach.restored_question"));
  }

  if (params.restoredPermissions > 0) {
    lines.push(t("attach.restored_permissions", { count: params.restoredPermissions }));
  }

  lines.push(t("attach.disconnect_hint"));
  return lines.join("\n\n");
}

export async function attachCommand(
  ctx: CommandContext<Context>,
  deps: AttachCommandDeps,
): Promise<void> {
  try {
    const currentProject = getCurrentProject();
    if (!currentProject) {
      await ctx.reply(t("attach.project_not_selected"));
      return;
    }

    const currentSession = getCurrentSession();
    if (!currentSession) {
      await ctx.reply(t("attach.session_not_selected"));
      return;
    }

    if (currentSession.directory !== currentProject.worktree) {
      await ctx.reply(t("attach.session_project_mismatch"));
      return;
    }

    const result = await attachToSession({
      bot: deps.bot,
      chatId: ctx.chat.id,
      session: currentSession,
      ensureEventSubscription: deps.ensureEventSubscription,
    });

    await ctx.reply(
      buildAttachReply({
        title: currentSession.title,
        busy: result.busy,
        alreadyAttached: result.alreadyAttached,
        restoredQuestion: result.restoredQuestion,
        restoredPermissions: result.restoredPermissions,
      }),
    );
  } catch (error) {
    logger.error("[Attach] Failed to attach current session:", error);
    await ctx.reply(t("attach.error"));
  }
}
