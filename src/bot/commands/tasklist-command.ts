import { CommandContext, Context } from "grammy";
import { t } from "../../i18n/index.js";
import { interactionManager } from "../../app/managers/interaction-manager.js";
import { listScheduledTasks } from "../../app/stores/scheduled-task-store.js";
import type { ScheduledTask } from "../../app/types/scheduled-task.js";
import { buildTaskListKeyboard } from "../menus/scheduled-task-menu.js";
import { logger } from "../../utils/logger.js";

function sortTasks(tasks: ScheduledTask[]): ScheduledTask[] {
  return [...tasks].sort((left, right) => {
    const leftNextRun = left.nextRunAt ? Date.parse(left.nextRunAt) : Number.POSITIVE_INFINITY;
    const rightNextRun = right.nextRunAt ? Date.parse(right.nextRunAt) : Number.POSITIVE_INFINITY;

    if (leftNextRun !== rightNextRun) {
      return leftNextRun - rightNextRun;
    }

    return left.createdAt.localeCompare(right.createdAt);
  });
}

export async function taskListCommand(ctx: CommandContext<Context>): Promise<void> {
  try {
    const tasks = sortTasks(listScheduledTasks());
    if (tasks.length === 0) {
      await ctx.reply(t("tasklist.empty"));
      return;
    }

    const message = await ctx.reply(t("tasklist.select"), {
      reply_markup: buildTaskListKeyboard(tasks),
    });

    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "tasklist",
        stage: "list",
        messageId: message.message_id,
      },
    });
  } catch (error) {
    logger.error("[TaskList] Failed to open task list", error);
    await ctx.reply(t("tasklist.load_error"));
  }
}
