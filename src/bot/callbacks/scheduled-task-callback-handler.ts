import type { Context } from "grammy";
import { getDateLocale, t } from "../../i18n/index.js";
import { interactionManager } from "../../app/managers/interaction-manager.js";
import { taskCreationManager } from "../../app/managers/scheduled-task-creation-manager.js";
import type { InteractionState } from "../../app/types/interaction.js";
import type { ScheduledTask, TaskCreationState } from "../../app/types/scheduled-task.js";
import { getScheduledTask, removeScheduledTask } from "../../app/stores/scheduled-task-store.js";
import { scheduledTaskRuntime } from "../../app/services/scheduled-task-runtime-service.js";
import { logger } from "../../utils/logger.js";
import {
  buildCancelKeyboard,
  buildTaskDetailsKeyboard,
  TASK_CANCEL_CALLBACK,
  TASK_RETRY_SCHEDULE_CALLBACK,
  TASKLIST_CALLBACK_PREFIX,
  TASKLIST_CANCEL_CALLBACK,
  TASKLIST_DELETE_PREFIX,
  TASKLIST_OPEN_PREFIX,
} from "../menus/scheduled-task-menu.js";

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

async function deleteMessageIfPresent(
  ctx: Context,
  messageId: number | null | undefined,
): Promise<void> {
  if (!ctx.chat || typeof messageId !== "number") {
    return;
  }

  await ctx.api.deleteMessage(ctx.chat.id, messageId).catch(() => {});
}

function buildTaskInteractionMetadata(
  stage: "awaiting_schedule" | "parsing_schedule" | "awaiting_prompt",
  projectId: string,
  projectWorktree: string,
  previewMessageId?: number,
): Record<string, unknown> {
  return {
    flow: "task",
    stage,
    projectId,
    projectWorktree,
    previewMessageId,
  };
}

function isTaskInteraction(state: InteractionState | null): boolean {
  return state?.kind === "task";
}

function clearTaskInteraction(reason: string): void {
  const state = interactionManager.getSnapshot();
  if (state?.kind === "task") {
    interactionManager.clear(reason);
  }
}

function clearTaskFlow(reason: string): void {
  taskCreationManager.clear();
  clearTaskInteraction(reason);
}

function isTaskCallbackActive(flowState: TaskCreationState, messageId: number): boolean {
  return [
    flowState.scheduleRequestMessageId,
    flowState.previewMessageId,
    flowState.promptRequestMessageId,
  ].includes(messageId);
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

/**
 * Truncates text so its UTF-8 byte length does not exceed maxBytes.
 * Appends "..." when truncation occurs.
 * Uses TextEncoder to count bytes accurately (handles emoji, CJK, etc.).
 */
function truncateToByteLength(text: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= maxBytes) {
    return text;
  }

  // Binary-search for the longest prefix that fits within (maxBytes - 3) bytes.
  // We search over UTF-16 code unit indices (JS string positions).
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (encoder.encode(text.slice(0, mid)).length <= maxBytes - 3) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  // Snap back if `low` cuts in the middle of a surrogate pair.
  // If the last code unit in the slice is a high surrogate (0xD800–0xDBFF),
  // the slice ends with an unpaired surrogate — step back one code unit.
  if (low > 0 && text.charCodeAt(low - 1) >= 0xd800 && text.charCodeAt(low - 1) <= 0xdbff) {
    low -= 1;
  }

  return `${text.slice(0, low).trimEnd()}...`;
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

function formatTaskDetails(task: ScheduledTask): string {
  const variant = task.model.variant ? ` (${task.model.variant})` : "";
  const model = `${task.model.providerID}/${task.model.modelID}${variant}`;
  const cronLine =
    task.kind === "cron" ? `${t("tasklist.details.cron", { cron: task.cron })}\n` : "";

  return t("tasklist.details", {
    // Telegram editMessageText hard limit is 4096 bytes (UTF-8).
    // The prompt budget (3800 bytes) is derived from the English locale:
    // 4096 − ~230 (template chrome: title, labels, schedule, etc.) − 66 (safety margin) = 3800.
    // NOTE: Non-English locales may have longer template chrome. If a locale's
    // chrome exceeds ~296 bytes (230 + 66), the total could exceed 4096.
    // This budget is safe for all current locales; re-calculate if new locales
    // with significantly longer translations are added.
    prompt: truncateToByteLength(task.prompt, 3800),
    project: `${task.projectWorktree}\n${t("status.line.model", { model })}`,
    schedule: task.scheduleSummary,
    cronLine,
    timezone: task.timezone,
    nextRunAt: formatDateTime(task.nextRunAt, task.timezone),
    lastRunAt: formatDateTime(task.lastRunAt, task.timezone),
    runCount: String(task.runCount),
  });
}

export async function handleTaskCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (data !== TASK_RETRY_SCHEDULE_CALLBACK && data !== TASK_CANCEL_CALLBACK) {
    return false;
  }

  const flowState = taskCreationManager.getState();
  const interactionState = interactionManager.getSnapshot();
  const callbackMessageId = getCallbackMessageId(ctx);

  if (
    !flowState ||
    !isTaskInteraction(interactionState) ||
    callbackMessageId === null ||
    !isTaskCallbackActive(flowState, callbackMessageId)
  ) {
    if (!flowState && isTaskInteraction(interactionState)) {
      clearTaskInteraction("task_retry_inactive_state");
    }

    await ctx.answerCallbackQuery({ text: t("task.inactive_callback"), show_alert: true });
    return true;
  }

  if (data === TASK_CANCEL_CALLBACK) {
    await ctx.answerCallbackQuery({ text: t("task.cancel_callback") });
    await deleteMessageIfPresent(ctx, flowState.scheduleRequestMessageId);
    await deleteMessageIfPresent(ctx, flowState.previewMessageId);
    await deleteMessageIfPresent(ctx, flowState.promptRequestMessageId);
    clearTaskFlow("task_cancelled");
    await ctx.reply(t("task.cancelled"));
    return true;
  }

  if (
    !taskCreationManager.isWaitingForPrompt() ||
    callbackMessageId !== flowState.previewMessageId
  ) {
    await ctx.answerCallbackQuery({ text: t("task.inactive_callback"), show_alert: true });
    return true;
  }

  taskCreationManager.resetSchedule();
  interactionManager.transition({
    kind: "task",
    expectedInput: "text",
    metadata: buildTaskInteractionMetadata(
      "awaiting_schedule",
      flowState.projectId,
      flowState.projectWorktree,
    ),
  });

  await ctx.answerCallbackQuery({ text: t("task.retry_schedule_callback") });
  await deleteMessageIfPresent(ctx, flowState.promptRequestMessageId);
  await deleteMessageIfPresent(ctx, flowState.previewMessageId);
  const message = await ctx.reply(t("task.prompt.schedule"), {
    reply_markup: buildCancelKeyboard(),
  });
  taskCreationManager.setScheduleRequestMessageId(message.message_id);

  return true;
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
