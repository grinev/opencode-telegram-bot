import { getScheduledTasks, setScheduledTasks } from "../settings/manager.js";
import { logger } from "../utils/logger.js";
import type { ScheduledTask } from "./types.js";
import { cloneScheduledTask } from "./types.js";

export function listScheduledTasks(): ScheduledTask[] {
  return getScheduledTasks().map((task) => cloneScheduledTask(task));
}

export async function addScheduledTask(task: ScheduledTask): Promise<void> {
  const tasks = listScheduledTasks();
  tasks.push(cloneScheduledTask(task));
  await setScheduledTasks(tasks);
  logger.info(`[ScheduledTaskStore] Added scheduled task: id=${task.id}, kind=${task.kind}`);
}

export async function replaceScheduledTasks(tasks: ScheduledTask[]): Promise<void> {
  await setScheduledTasks(tasks.map((task) => cloneScheduledTask(task)));
  logger.info(`[ScheduledTaskStore] Replaced scheduled task collection: count=${tasks.length}`);
}

export async function removeScheduledTask(taskId: string): Promise<boolean> {
  const tasks = listScheduledTasks();
  const nextTasks = tasks.filter((task) => task.id !== taskId);

  if (nextTasks.length === tasks.length) {
    return false;
  }

  await setScheduledTasks(nextTasks);
  logger.info(`[ScheduledTaskStore] Removed scheduled task: id=${taskId}`);
  return true;
}
