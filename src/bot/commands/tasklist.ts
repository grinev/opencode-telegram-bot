import { CommandContext, Context, InlineKeyboard } from "grammy";
import { getDateLocale, t } from "../../i18n/index.js";
import { interactionManager } from "../../interaction/manager.js";
import type { InteractionState } from "../../interaction/types.js";
import { formatTaskListBadge } from "../../scheduled-task/display.js";
import { scheduledTaskRuntime } from "../../scheduled-task/runtime.js";
import {
  getScheduledTask,
  listScheduledTasks,
  removeScheduledTask,
} from "../../scheduled-task/store.js";
import type { ScheduledTask } from "../../scheduled-task/types.js";
import { logger } from "../../utils/logger.js";

const TASKLIST_CALLBACK_PREFIX = "tasklist:";
const TASKLIST_OPEN_PREFIX = `${TASKLIST_CALLBACK_PREFIX}open:`;
const TASKLIST_DELETE_PREFIX = `${TASKLIST_CALLBACK_PREFIX}delete:`;
const TASKLIST_CANCEL_CALLBACK = `${TASKLIST_CALLBACK_PREFIX}cancel`;
const MAX_INLINE_BUTTON_LABEL_LENGTH = 64;

interface TaskListListMetadata {
  flow: "tasklist";
  stage: "list";
  messageId: number;
}

interface TaskListDetailMetadata {
  flow: "tasklist";
  stage: "detail";
  messageId: number;
  taskId: string;
}

type TaskListMetadata = TaskListListMetadata | TaskListDetailMetadata;

function getCallbackMessageId(ctx: Context): number | null {
  const message = ctx.callbackQuery?.message;
  if (!message || !("message_id" in message)) {
    return null;
  }

  const messageId = (message as { message_id?: number }).message_id;
  return typeof messageId === "number" ? messageId : null;
}

function parseTaskListMetadata(state: InteractionState | null): TaskListMetadata | null {
  if (!state || state.kind !== "custom") {
    return null;
  }

  const flow = state.metadata.flow;
  const stage = state.metadata.stage;
  const messageId = state.metadata.messageId;

  if (flow !== "tasklist" || typeof messageId !== "number") {
    return null;
  }

  if (stage === "list") {
    return {
      flow,
      stage,
      messageId,
    };
  }

  if (stage === "detail") {
    const taskId = state.metadata.taskId;
    if (typeof taskId !== "string" || !taskId) {
      return null;
    }

    return {
      flow,
      stage,
      messageId,
      taskId,
    };
  }

  return null;
}

function clearTaskListInteraction(reason: string): void {
  const metadata = parseTaskListMetadata(interactionManager.getSnapshot());
  if (metadata) {
    interactionManager.clear(reason);
  }
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function formatDateTime(dateIso: string | null, timezone: string): string {
  if (!dateIso) {
    return "-";
  }

  try {
    return new Intl.DateTimeFormat(getDateLocale(), {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone,
    }).format(new Date(dateIso));
  } catch {
    return dateIso;
  }
}

function formatTaskButtonPrefix(task: ScheduledTask): string {
  return formatTaskListBadge(task);
}

function formatTaskButtonLabel(task: ScheduledTask): string {
  const prefix = `[${formatTaskButtonPrefix(task)}]`;
  const prompt = task.prompt.replace(/\s+/g, " ").trim();
  return truncateText(`${prefix} ${prompt}`, MAX_INLINE_BUTTON_LABEL_LENGTH);
}

function buildTaskListKeyboard(tasks: ScheduledTask[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  tasks.forEach((task) => {
    keyboard.text(formatTaskButtonLabel(task), `${TASKLIST_OPEN_PREFIX}${task.id}`).row();
  });

  keyboard.text(t("tasklist.button.cancel"), TASKLIST_CANCEL_CALLBACK);
  return keyboard;
}

function buildTaskDetailsKeyboard(taskId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text(t("tasklist.button.delete"), `${TASKLIST_DELETE_PREFIX}${taskId}`)
    .text(t("tasklist.button.cancel"), TASKLIST_CANCEL_CALLBACK);
}

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

function formatTaskDetails(task: ScheduledTask): string {
  const cronLine =
    task.kind === "cron" ? `${t("tasklist.details.cron", { cron: task.cron })}\n` : "";

  return t("tasklist.details", {
    prompt: task.prompt,
    project: task.projectWorktree,
    schedule: task.scheduleSummary,
    cronLine,
    timezone: task.timezone,
    nextRunAt: formatDateTime(task.nextRunAt, task.timezone),
    lastRunAt: formatDateTime(task.lastRunAt, task.timezone),
    runCount: String(task.runCount),
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

export async function handleTaskListCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith(TASKLIST_CALLBACK_PREFIX)) {
    return false;
  }

  const metadata = parseTaskListMetadata(interactionManager.getSnapshot());
  const callbackMessageId = getCallbackMessageId(ctx);

  if (!metadata || callbackMessageId === null || metadata.messageId !== callbackMessageId) {
    await ctx.answerCallbackQuery({ text: t("tasklist.inactive_callback"), show_alert: true });
    return true;
  }

  try {
    if (data === TASKLIST_CANCEL_CALLBACK) {
      clearTaskListInteraction("tasklist_cancelled");
      await ctx.answerCallbackQuery({ text: t("tasklist.cancelled_callback") });
      await ctx.deleteMessage().catch(() => {});
      return true;
    }

    if (data.startsWith(TASKLIST_OPEN_PREFIX)) {
      if (metadata.stage !== "list") {
        await ctx.answerCallbackQuery({ text: t("tasklist.inactive_callback"), show_alert: true });
        return true;
      }

      const taskId = data.slice(TASKLIST_OPEN_PREFIX.length);
      const task = getScheduledTask(taskId);
      if (!task) {
        clearTaskListInteraction("tasklist_selected_task_missing");
        await ctx.answerCallbackQuery({ text: t("tasklist.inactive_callback"), show_alert: true });
        await ctx.deleteMessage().catch(() => {});
        return true;
      }

      await ctx.answerCallbackQuery();
      await ctx.editMessageText(formatTaskDetails(task), {
        reply_markup: buildTaskDetailsKeyboard(task.id),
      });

      interactionManager.transition({
        expectedInput: "callback",
        metadata: {
          flow: "tasklist",
          stage: "detail",
          messageId: metadata.messageId,
          taskId: task.id,
        },
      });

      return true;
    }

    if (data.startsWith(TASKLIST_DELETE_PREFIX)) {
      if (metadata.stage !== "detail") {
        await ctx.answerCallbackQuery({ text: t("tasklist.inactive_callback"), show_alert: true });
        return true;
      }

      const taskId = data.slice(TASKLIST_DELETE_PREFIX.length);
      if (taskId !== metadata.taskId) {
        await ctx.answerCallbackQuery({ text: t("tasklist.inactive_callback"), show_alert: true });
        return true;
      }

      await removeScheduledTask(taskId);
      scheduledTaskRuntime.removeTask(taskId);
      clearTaskListInteraction("tasklist_deleted");
      await ctx.answerCallbackQuery({ text: t("tasklist.deleted_callback") });
      await ctx.deleteMessage().catch(() => {});
      return true;
    }

    await ctx.answerCallbackQuery({ text: t("callback.processing_error"), show_alert: true });
    return true;
  } catch (error) {
    logger.error("[TaskList] Failed to handle task list callback", error);
    clearTaskListInteraction("tasklist_callback_error");
    await ctx.answerCallbackQuery({ text: t("callback.processing_error") }).catch(() => {});
    return true;
  }
}
