import type { Context } from "grammy";
import type { AppContainer } from "../../app/bootstrap/app-container.js";
import { getDateLocale, t } from "../../i18n/index.js";
import type { InteractionState } from "../../app/types/interaction.js";
import type { ScheduledTask, TaskCreationState } from "../../app/types/scheduled-task.js";
import { getScheduledTask, removeScheduledTask } from "../../app/stores/scheduled-task-store.js";
import { getAgentDisplayName } from "../../app/types/agent.js";
import { logger } from "../../utils/logger.js";
import { cancelMenu, notify } from "./feedback.js";
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

export type TaskCallbackDeps = Pick<
  AppContainer,
  "interactionManager" | "scheduledTaskRuntime" | "taskCreationManager"
>;

function clearTaskInteraction(deps: TaskCallbackDeps, reason: string): void {
  const state = deps.interactionManager.getSnapshot();
  if (state?.kind === "task") {
    deps.interactionManager.clear(reason);
  }
}

function clearTaskFlow(deps: TaskCallbackDeps, reason: string): void {
  // Clear the slot first so the log keeps the specific reason.
  clearTaskInteraction(deps, reason);
  deps.taskCreationManager.clear();
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

function clearTaskListInteraction(deps: TaskCallbackDeps, reason: string): void {
  const metadata = parseTaskListMetadata(deps.interactionManager.getSnapshot());
  if (metadata) {
    deps.interactionManager.clear(reason);
  }
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

const TASK_DETAIL_PROMPT_BYTE_BUDGET = 3400;

function truncatePromptForDetails(prompt: string): string {
  if (Buffer.byteLength(prompt, "utf-8") <= TASK_DETAIL_PROMPT_BYTE_BUDGET) {
    return prompt;
  }

  const budget = TASK_DETAIL_PROMPT_BYTE_BUDGET - 3;
  let lo = 0;
  let hi = prompt.length;

  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (Buffer.byteLength(prompt.slice(0, mid), "utf-8") <= budget) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  return `${prompt.slice(0, lo)}...`;
}

function formatTaskDetails(task: ScheduledTask): string {
  const variant = task.model.variant ? ` (${task.model.variant})` : "";
  const model = `${task.model.providerID}/${task.model.modelID}${variant}`;
  const cronLine =
    task.kind === "cron" ? `${t("tasklist.details.cron", { cron: task.cron })}\n` : "";

  return t("tasklist.details", {
    prompt: truncatePromptForDetails(task.prompt),
    project: `${task.projectWorktree}\n${t("status.line.mode", {
      mode: getAgentDisplayName(task.agent),
    })}\n${t("status.line.model", { model })}`,
    schedule: task.scheduleSummary,
    cronLine,
    timezone: task.timezone,
    nextRunAt: formatDateTime(task.nextRunAt, task.timezone),
    lastRunAt: formatDateTime(task.lastRunAt, task.timezone),
    runCount: String(task.runCount),
  });
}

export async function handleTaskCallback(ctx: Context, deps: TaskCallbackDeps): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (data !== TASK_RETRY_SCHEDULE_CALLBACK && data !== TASK_CANCEL_CALLBACK) {
    return false;
  }

  const flowState = deps.taskCreationManager.getState();
  const interactionState = deps.interactionManager.getSnapshot();
  const callbackMessageId = getCallbackMessageId(ctx);

  if (
    !flowState ||
    !isTaskInteraction(interactionState) ||
    callbackMessageId === null ||
    !isTaskCallbackActive(flowState, callbackMessageId)
  ) {
    if (!flowState && isTaskInteraction(interactionState)) {
      clearTaskInteraction(deps, "task_retry_inactive_state");
    }

    await ctx.answerCallbackQuery({ text: t("task.inactive_callback"), show_alert: true });
    return true;
  }

  if (data === TASK_CANCEL_CALLBACK) {
    // The flow deletes its own messages by id, so only the toast is needed here.
    await notify(ctx, "common.cancelled");
    await deleteMessageIfPresent(ctx, flowState.scheduleRequestMessageId);
    await deleteMessageIfPresent(ctx, flowState.previewMessageId);
    await deleteMessageIfPresent(ctx, flowState.promptRequestMessageId);
    clearTaskFlow(deps, "task_cancelled");
    return true;
  }

  if (
    !deps.taskCreationManager.isWaitingForPrompt() ||
    callbackMessageId !== flowState.previewMessageId
  ) {
    await ctx.answerCallbackQuery({ text: t("task.inactive_callback"), show_alert: true });
    return true;
  }

  deps.taskCreationManager.resetSchedule();
  deps.interactionManager.transition({
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
  deps.taskCreationManager.setScheduleRequestMessageId(message.message_id);

  return true;
}

export async function handleTaskListCallback(
  ctx: Context,
  deps: TaskCallbackDeps,
): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith(TASKLIST_CALLBACK_PREFIX)) {
    return false;
  }

  const metadata = parseTaskListMetadata(deps.interactionManager.getSnapshot());
  const callbackMessageId = getCallbackMessageId(ctx);

  if (!metadata || callbackMessageId === null || metadata.messageId !== callbackMessageId) {
    await ctx.answerCallbackQuery({ text: t("tasklist.inactive_callback"), show_alert: true });
    return true;
  }

  try {
    if (data === TASKLIST_CANCEL_CALLBACK) {
      clearTaskListInteraction(deps, "tasklist_cancelled");
      await cancelMenu(ctx);
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
        clearTaskListInteraction(deps, "tasklist_selected_task_missing");
        await ctx.answerCallbackQuery({ text: t("tasklist.inactive_callback"), show_alert: true });
        await ctx.deleteMessage().catch(() => {});
        return true;
      }

      await ctx.answerCallbackQuery();
      await ctx.editMessageText(formatTaskDetails(task), {
        reply_markup: buildTaskDetailsKeyboard(task.id),
      });

      deps.interactionManager.transition({
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
      deps.scheduledTaskRuntime.removeTask(taskId);
      clearTaskListInteraction(deps, "tasklist_deleted");
      await ctx.answerCallbackQuery({ text: t("tasklist.deleted_callback") });
      await ctx.deleteMessage().catch(() => {});
      return true;
    }

    await ctx.answerCallbackQuery({ text: t("callback.processing_error") });
    return true;
  } catch (error) {
    logger.error("[TaskList] Failed to handle task list callback", error);
    clearTaskListInteraction(deps, "tasklist_callback_error");
    await ctx.answerCallbackQuery({ text: t("callback.processing_error") }).catch(() => {});
    return true;
  }
}
