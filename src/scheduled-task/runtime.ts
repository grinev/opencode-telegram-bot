import type { Bot, Context } from "grammy";
import { config } from "../config.js";
import { t } from "../i18n/index.js";
import { logger } from "../utils/logger.js";
import { safeBackgroundTask } from "../utils/safe-background-task.js";
import { sendBotText } from "../bot/utils/telegram-text.js";
import { executeScheduledTask } from "./executor.js";
import { foregroundSessionState } from "./foreground-state.js";
import { computeNextRunAt, isTaskDue } from "./next-run.js";
import {
  getScheduledTask,
  listScheduledTasks,
  removeScheduledTask,
  replaceScheduledTasks,
  updateScheduledTask,
} from "./store.js";
import type { QueuedScheduledTaskDelivery, ScheduledTask } from "./types.js";

const TELEGRAM_MESSAGE_LIMIT = 4096;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const TASK_DESCRIPTION_PREVIEW_LENGTH = 64;
const RESTART_INTERRUPTED_ERROR = "Interrupted by bot restart during scheduled task execution.";

function splitTelegramText(text: string): string[] {
  if (text.length <= TELEGRAM_MESSAGE_LIMIT) {
    return [text];
  }

  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > TELEGRAM_MESSAGE_LIMIT) {
    let splitIndex = remaining.lastIndexOf("\n", TELEGRAM_MESSAGE_LIMIT);
    if (splitIndex <= 0 || splitIndex < Math.floor(TELEGRAM_MESSAGE_LIMIT * 0.5)) {
      splitIndex = TELEGRAM_MESSAGE_LIMIT;
    }

    parts.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trimStart();
  }

  if (remaining.trim()) {
    parts.push(remaining.trim());
  }

  return parts;
}

function normalizeTaskPrompt(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (normalized.length <= TASK_DESCRIPTION_PREVIEW_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, TASK_DESCRIPTION_PREVIEW_LENGTH)}...`;
}

function buildSuccessDelivery(
  task: ScheduledTask,
  runAt: string,
  resultText: string,
): QueuedScheduledTaskDelivery {
  return {
    taskId: task.id,
    scheduleSummary: task.scheduleSummary,
    prompt: task.prompt,
    runAt,
    status: "success",
    messageText: t("task.run.success", {
      description: normalizeTaskPrompt(task.prompt),
      result: resultText,
    }),
  };
}

function buildErrorDelivery(
  task: ScheduledTask,
  runAt: string,
  errorMessage: string,
): QueuedScheduledTaskDelivery {
  return {
    taskId: task.id,
    scheduleSummary: task.scheduleSummary,
    prompt: task.prompt,
    runAt,
    status: "error",
    messageText: t("task.run.error", {
      description: normalizeTaskPrompt(task.prompt),
      error: errorMessage,
    }),
  };
}

export class ScheduledTaskRuntime {
  private botApi: Bot<Context>["api"] | null = null;
  private chatId: number | null = null;
  private initialized = false;
  private timersByTaskId = new Map<string, ReturnType<typeof setTimeout>>();
  private runningTaskIds = new Set<string>();
  private deliveryQueue: QueuedScheduledTaskDelivery[] = [];
  private flushInProgress = false;

  async initialize(bot: Bot<Context>): Promise<void> {
    this.botApi = bot.api;
    this.chatId = config.telegram.allowedUserId;

    if (this.initialized) {
      return;
    }

    this.initialized = true;
    await this.recoverTasksOnStartup();
    await this.flushDeferredDeliveries();
  }

  registerTask(task: ScheduledTask): void {
    if (!this.initialized) {
      return;
    }

    this.scheduleTask(task);
  }

  removeTask(taskId: string): void {
    const timer = this.timersByTaskId.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.timersByTaskId.delete(taskId);
    }

    this.runningTaskIds.delete(taskId);
    this.deliveryQueue = this.deliveryQueue.filter((delivery) => delivery.taskId !== taskId);
  }

  async flushDeferredDeliveries(): Promise<void> {
    if (
      this.flushInProgress ||
      !this.botApi ||
      this.chatId === null ||
      foregroundSessionState.isBusy() ||
      this.deliveryQueue.length === 0
    ) {
      return;
    }

    this.flushInProgress = true;

    try {
      while (this.deliveryQueue.length > 0 && !foregroundSessionState.isBusy()) {
        const nextDelivery = this.deliveryQueue[0];
        const sent = await this.sendDelivery(nextDelivery);
        if (!sent) {
          break;
        }

        this.deliveryQueue.shift();
      }
    } finally {
      this.flushInProgress = false;
    }
  }

  __resetForTests(): void {
    for (const timer of this.timersByTaskId.values()) {
      clearTimeout(timer);
    }

    this.botApi = null;
    this.chatId = null;
    this.initialized = false;
    this.timersByTaskId.clear();
    this.runningTaskIds.clear();
    this.deliveryQueue = [];
    this.flushInProgress = false;
  }

  private async recoverTasksOnStartup(): Promise<void> {
    const tasks = listScheduledTasks();
    if (tasks.length === 0) {
      return;
    }

    const now = new Date();
    let hasChanges = false;
    const normalizedTasks = tasks.map((task) => {
      const normalizedTask: ScheduledTask = { ...task, model: { ...task.model } };

      if (normalizedTask.lastStatus === "running") {
        normalizedTask.lastStatus = "error";
        normalizedTask.lastError = RESTART_INTERRUPTED_ERROR;
        hasChanges = true;
      }

      if (normalizedTask.kind === "cron") {
        if (!normalizedTask.nextRunAt || Number.isNaN(Date.parse(normalizedTask.nextRunAt))) {
          try {
            normalizedTask.nextRunAt = computeNextRunAt(normalizedTask, now);
          } catch (error) {
            logger.error(
              `[ScheduledTaskRuntime] Failed to recover next run for cron task: id=${normalizedTask.id}`,
              error,
            );
            normalizedTask.nextRunAt = null;
            normalizedTask.lastStatus = "error";
            normalizedTask.lastError =
              normalizedTask.lastError || "Failed to recover cron schedule.";
          }
          hasChanges = true;
        }
      } else {
        const runAtMs = Date.parse(normalizedTask.runAt);
        if (Number.isNaN(runAtMs)) {
          normalizedTask.nextRunAt = null;
          normalizedTask.lastStatus = "error";
          normalizedTask.lastError =
            normalizedTask.lastError || "Invalid one-time task runAt value.";
          hasChanges = true;
        } else if (normalizedTask.nextRunAt === null && normalizedTask.lastStatus === "idle") {
          normalizedTask.nextRunAt = new Date(runAtMs).toISOString();
          hasChanges = true;
        }
      }

      return normalizedTask;
    });

    if (hasChanges) {
      await replaceScheduledTasks(normalizedTasks);
    }

    for (const task of normalizedTasks) {
      this.scheduleTask(task);
    }
  }

  private scheduleTask(task: ScheduledTask): void {
    this.removeTaskTimer(task.id);

    if (!task.nextRunAt) {
      return;
    }

    const nextRunAtMs = Date.parse(task.nextRunAt);
    if (Number.isNaN(nextRunAtMs)) {
      logger.warn(
        `[ScheduledTaskRuntime] Invalid nextRunAt: id=${task.id}, value=${task.nextRunAt}`,
      );
      return;
    }

    const delayMs = nextRunAtMs - Date.now();
    if (delayMs <= 0) {
      this.startExecution(task.id);
      return;
    }

    const timeoutMs = Math.min(delayMs, MAX_TIMER_DELAY_MS);
    const timer = setTimeout(() => {
      this.timersByTaskId.delete(task.id);
      const currentTask = getScheduledTask(task.id);
      if (!currentTask) {
        return;
      }

      if (isTaskDue(currentTask)) {
        this.startExecution(task.id);
        return;
      }

      this.scheduleTask(currentTask);
    }, timeoutMs);

    this.timersByTaskId.set(task.id, timer);
  }

  private removeTaskTimer(taskId: string): void {
    const timer = this.timersByTaskId.get(taskId);
    if (!timer) {
      return;
    }

    clearTimeout(timer);
    this.timersByTaskId.delete(taskId);
  }

  private startExecution(taskId: string): void {
    if (this.runningTaskIds.has(taskId)) {
      return;
    }

    const task = getScheduledTask(taskId);
    if (!task) {
      this.removeTask(taskId);
      return;
    }

    if (!isTaskDue(task)) {
      this.scheduleTask(task);
      return;
    }

    this.runningTaskIds.add(taskId);
    safeBackgroundTask({
      taskName: `scheduledTask.run.${taskId}`,
      task: async () => {
        await this.executeTask(taskId);
      },
      onError: (error) => {
        logger.error(`[ScheduledTaskRuntime] Scheduled task run crashed: id=${taskId}`, error);
        this.runningTaskIds.delete(taskId);
      },
    });
  }

  private async executeTask(taskId: string): Promise<void> {
    const taskSnapshot = getScheduledTask(taskId);
    if (!taskSnapshot) {
      this.removeTask(taskId);
      this.runningTaskIds.delete(taskId);
      return;
    }

    const startedAt = new Date().toISOString();
    const runningTask = await updateScheduledTask(taskId, (task) => ({
      ...task,
      lastStatus: "running",
      lastError: null,
      lastRunAt: startedAt,
      runCount: task.runCount + 1,
    }));

    if (!runningTask) {
      this.removeTask(taskId);
      this.runningTaskIds.delete(taskId);
      return;
    }

    try {
      const result = await executeScheduledTask(runningTask);

      if (result.status === "success") {
        await this.handleSuccessfulExecution(
          runningTask,
          result.finishedAt,
          result.resultText || "",
        );
      } else {
        await this.handleFailedExecution(
          runningTask,
          result.finishedAt,
          result.errorMessage || "Unknown error",
        );
      }
    } finally {
      this.runningTaskIds.delete(taskId);
    }
  }

  private async handleSuccessfulExecution(
    task: ScheduledTask,
    finishedAt: string,
    resultText: string,
  ): Promise<void> {
    const delivery = buildSuccessDelivery(task, finishedAt, resultText);

    if (task.kind === "once") {
      await removeScheduledTask(task.id);
      this.removeTask(task.id);
      await this.enqueueDelivery(delivery);
      return;
    }

    let nextRunAt: string | null;
    try {
      nextRunAt = computeNextRunAt(task, new Date(finishedAt));
    } catch (error) {
      logger.error(
        `[ScheduledTaskRuntime] Failed to compute next run after success: id=${task.id}`,
        error,
      );
      nextRunAt = null;
    }

    const updatedTask = await updateScheduledTask(task.id, (currentTask) => ({
      ...currentTask,
      lastStatus: "success",
      lastError: null,
      nextRunAt,
    }));

    if (updatedTask) {
      this.scheduleTask(updatedTask);
    }

    await this.enqueueDelivery(delivery);
  }

  private async handleFailedExecution(
    task: ScheduledTask,
    finishedAt: string,
    errorMessage: string,
  ): Promise<void> {
    const delivery = buildErrorDelivery(task, finishedAt, errorMessage);

    let nextRunAt: string | null = null;
    if (task.kind === "cron") {
      try {
        nextRunAt = computeNextRunAt(task, new Date(finishedAt));
      } catch (error) {
        logger.error(
          `[ScheduledTaskRuntime] Failed to compute next run after error: id=${task.id}`,
          error,
        );
      }
    }

    const updatedTask = await updateScheduledTask(task.id, (currentTask) => ({
      ...currentTask,
      lastStatus: "error",
      lastError: errorMessage,
      nextRunAt,
    }));

    if (updatedTask) {
      this.scheduleTask(updatedTask);
    }

    await this.enqueueDelivery(delivery);
  }

  private async enqueueDelivery(delivery: QueuedScheduledTaskDelivery): Promise<void> {
    if (
      this.deliveryQueue.length === 0 &&
      !this.flushInProgress &&
      !foregroundSessionState.isBusy() &&
      (await this.sendDelivery(delivery))
    ) {
      return;
    }

    this.deliveryQueue.push(delivery);
  }

  private async sendDelivery(delivery: QueuedScheduledTaskDelivery): Promise<boolean> {
    if (!this.botApi || this.chatId === null) {
      return false;
    }

    try {
      const messageParts = splitTelegramText(delivery.messageText);
      for (const part of messageParts) {
        await sendBotText({
          api: this.botApi,
          chatId: this.chatId,
          text: part,
          format: "raw",
        });
      }

      return true;
    } catch (error) {
      logger.error(
        `[ScheduledTaskRuntime] Failed to send delivery: id=${delivery.taskId}, status=${delivery.status}`,
        error,
      );
      return false;
    }
  }
}

export const scheduledTaskRuntime = new ScheduledTaskRuntime();
