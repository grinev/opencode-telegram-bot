import { InlineKeyboard } from "grammy";
import { t } from "../../i18n/index.js";
import { formatTaskListBadge } from "../../app/formatters/scheduled-task-display-formatter.js";
import type { ScheduledTask } from "../../app/types/scheduled-task.js";

export const TASK_RETRY_SCHEDULE_CALLBACK = "task:retry-schedule";
export const TASK_CANCEL_CALLBACK = "task:cancel";
export const TASKLIST_CALLBACK_PREFIX = "tasklist:";
export const TASKLIST_OPEN_PREFIX = `${TASKLIST_CALLBACK_PREFIX}open:`;
export const TASKLIST_DELETE_PREFIX = `${TASKLIST_CALLBACK_PREFIX}delete:`;
export const TASKLIST_CANCEL_CALLBACK = `${TASKLIST_CALLBACK_PREFIX}cancel`;

const MAX_INLINE_BUTTON_LABEL_LENGTH = 64;

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function formatTaskButtonLabel(task: ScheduledTask): string {
  const prefix = `[${formatTaskListBadge(task)}]`;
  const prompt = task.prompt.replace(/\s+/g, " ").trim();
  return truncateText(`${prefix} ${prompt}`, MAX_INLINE_BUTTON_LABEL_LENGTH);
}

export function buildRetryScheduleKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(t("task.button.retry_schedule"), TASK_RETRY_SCHEDULE_CALLBACK)
    .text(t("task.button.cancel"), TASK_CANCEL_CALLBACK);
}

export function buildCancelKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text(t("task.button.cancel"), TASK_CANCEL_CALLBACK);
}

export function buildTaskListKeyboard(tasks: ScheduledTask[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  tasks.forEach((task) => {
    keyboard.text(formatTaskButtonLabel(task), `${TASKLIST_OPEN_PREFIX}${task.id}`).row();
  });

  keyboard.text(t("tasklist.button.cancel"), TASKLIST_CANCEL_CALLBACK);
  return keyboard;
}

export function buildTaskDetailsKeyboard(taskId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text(t("tasklist.button.delete"), `${TASKLIST_DELETE_PREFIX}${taskId}`)
    .text(t("tasklist.button.cancel"), TASKLIST_CANCEL_CALLBACK);
}
