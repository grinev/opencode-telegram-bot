import { randomUUID } from "node:crypto";
import { CommandContext, Context, InlineKeyboard } from "grammy";
import { getDateLocale, t } from "../../i18n/index.js";
import { interactionManager } from "../../interaction/manager.js";
import type { InteractionState } from "../../interaction/types.js";
import { getStoredModel } from "../../model/manager.js";
import { getCurrentProject } from "../../settings/manager.js";
import { taskCreationManager } from "../../scheduled-task/creation-manager.js";
import { parseTaskSchedule } from "../../scheduled-task/schedule-parser.js";
import { addScheduledTask } from "../../scheduled-task/store.js";
import { scheduledTaskRuntime } from "../../scheduled-task/runtime.js";
import {
  createScheduledTaskModel,
  type ParsedTaskSchedule,
  type ScheduledTask,
  type TaskCreationState,
} from "../../scheduled-task/types.js";
import { logger } from "../../utils/logger.js";

const TASK_RETRY_SCHEDULE_CALLBACK = "task:retry-schedule";
const TASK_CANCEL_CALLBACK = "task:cancel";
const TASK_PROMPT_PREVIEW_LENGTH = 100;

interface TaskInteractionMetadata {
  flow: "task";
  stage: "awaiting_schedule" | "parsing_schedule" | "awaiting_prompt";
  projectId: string;
  projectWorktree: string;
  previewMessageId?: number;
}

function buildRetryScheduleKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(t("task.button.retry_schedule"), TASK_RETRY_SCHEDULE_CALLBACK)
    .text(t("task.button.cancel"), TASK_CANCEL_CALLBACK);
}

function buildCancelKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text(t("task.button.cancel"), TASK_CANCEL_CALLBACK);
}

function getCallbackMessageId(ctx: Context): number | null {
  const message = ctx.callbackQuery?.message;
  if (!message || !("message_id" in message)) {
    return null;
  }

  const messageId = (message as { message_id?: number }).message_id;
  return typeof messageId === "number" ? messageId : null;
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

function truncateTaskPrompt(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (normalized.length <= TASK_PROMPT_PREVIEW_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, TASK_PROMPT_PREVIEW_LENGTH - 3)}...`;
}

function formatScheduledDate(dateIso: string, timezone: string): string {
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

function getTaskKindLabel(schedule: ParsedTaskSchedule): string {
  return schedule.kind === "cron" ? t("task.kind.cron") : t("task.kind.once");
}

function formatParsedScheduleMessage(schedule: ParsedTaskSchedule): string {
  return t("task.schedule_preview", {
    summary: schedule.summary,
    timezone: schedule.timezone,
    kind: getTaskKindLabel(schedule),
    nextRunAt: formatScheduledDate(schedule.nextRunAt, schedule.timezone),
  });
}

function formatParsedSchedulePromptMessage(schedule: ParsedTaskSchedule): string {
  return `${formatParsedScheduleMessage(schedule)}\n\n${t("task.prompt.body")}`;
}

function formatTaskCreatedMessage(task: ScheduledTask): string {
  const variant = task.model.variant ? ` (${task.model.variant})` : "";
  const model = `${task.model.providerID}/${task.model.modelID}${variant}`;

  return t("task.created", {
    description: truncateTaskPrompt(task.prompt),
    project: task.projectWorktree,
    model,
    schedule: task.scheduleSummary,
    nextRunAt: task.nextRunAt ? formatScheduledDate(task.nextRunAt, task.timezone) : "-",
  });
}

function validateCronMinutesFrequency(cron: string): void {
  const cronParts = cron.trim().split(/\s+/);
  if (cronParts.length < 5) {
    throw new Error("Invalid cron expression returned by parser");
  }

  const minuteValues = expandCronMinuteField(cronParts[0]);
  if (minuteValues.length <= 1) {
    return;
  }

  let minGap = 60;
  for (let index = 0; index < minuteValues.length; index++) {
    const currentValue = minuteValues[index];
    const nextValue =
      index === minuteValues.length - 1 ? minuteValues[0] + 60 : minuteValues[index + 1];
    minGap = Math.min(minGap, nextValue - currentValue);
  }

  if (minGap < 5) {
    throw new Error(t("task.schedule_too_frequent"));
  }
}

function expandCronMinuteField(field: string): number[] {
  const values = new Set<number>();

  for (const token of field.split(",")) {
    const trimmedToken = token.trim();
    if (!trimmedToken) {
      throw new Error("Invalid cron minute field returned by parser");
    }

    for (const value of expandCronMinuteToken(trimmedToken)) {
      values.add(value);
    }
  }

  return Array.from(values).sort((left, right) => left - right);
}

function expandCronMinuteToken(token: string): number[] {
  const [rawBase, rawStep] = token.split("/");
  if (rawStep !== undefined) {
    const step = Number.parseInt(rawStep, 10);
    if (!Number.isInteger(step) || step <= 0) {
      throw new Error("Invalid cron minute step returned by parser");
    }

    const baseValues = expandCronMinuteBase(rawBase);
    return baseValues.filter((value, index) => {
      if (baseValues.length === 0) {
        return false;
      }

      return index % step === 0;
    });
  }

  return expandCronMinuteBase(rawBase);
}

function expandCronMinuteBase(base: string): number[] {
  if (base === "*") {
    return Array.from({ length: 60 }, (_, index) => index);
  }

  if (base.includes("-")) {
    const [rawStart, rawEnd] = base.split("-");
    const start = parseCronMinuteNumber(rawStart);
    const end = parseCronMinuteNumber(rawEnd);
    if (start > end) {
      throw new Error("Invalid cron minute range returned by parser");
    }

    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }

  return [parseCronMinuteNumber(base)];
}

function parseCronMinuteNumber(value: string): number {
  const parsedValue = Number.parseInt(value, 10);
  if (!Number.isInteger(parsedValue) || parsedValue < 0 || parsedValue > 59) {
    throw new Error("Invalid cron minute value returned by parser");
  }

  return parsedValue;
}

function validateParsedSchedule(parsedSchedule: ParsedTaskSchedule): void {
  if (parsedSchedule.kind === "cron") {
    validateCronMinutesFrequency(parsedSchedule.cron);
  }
}

function buildTaskInteractionMetadata(
  stage: TaskInteractionMetadata["stage"],
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

function isTaskCallbackActive(flowState: TaskCreationState, messageId: number): boolean {
  return [
    flowState.scheduleRequestMessageId,
    flowState.previewMessageId,
    flowState.promptRequestMessageId,
  ].includes(messageId);
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

function buildScheduledTask(
  projectId: string,
  projectWorktree: string,
  model: ScheduledTask["model"],
  scheduleText: string,
  parsedSchedule: ParsedTaskSchedule,
  prompt: string,
): ScheduledTask {
  const baseTask = {
    id: randomUUID(),
    projectId,
    projectWorktree,
    model,
    scheduleText,
    scheduleSummary: parsedSchedule.summary,
    timezone: parsedSchedule.timezone,
    prompt,
    createdAt: new Date().toISOString(),
    nextRunAt: parsedSchedule.nextRunAt,
    lastRunAt: null,
    runCount: 0,
    lastStatus: "idle" as const,
    lastError: null,
  };

  if (parsedSchedule.kind === "cron") {
    return {
      ...baseTask,
      kind: "cron",
      cron: parsedSchedule.cron,
    };
  }

  return {
    ...baseTask,
    kind: "once",
    runAt: parsedSchedule.runAt,
  };
}

export async function taskCommand(ctx: CommandContext<Context>): Promise<void> {
  const currentProject = getCurrentProject();
  if (!currentProject) {
    await ctx.reply(t("bot.project_not_selected"));
    return;
  }

  const currentModel = createScheduledTaskModel(getStoredModel());

  taskCreationManager.start(currentProject.id, currentProject.worktree, currentModel);
  interactionManager.start({
    kind: "task",
    expectedInput: "text",
    metadata: buildTaskInteractionMetadata(
      "awaiting_schedule",
      currentProject.id,
      currentProject.worktree,
    ),
  });

  const message = await ctx.reply(t("task.prompt.schedule"), {
    reply_markup: buildCancelKeyboard(),
  });
  taskCreationManager.setScheduleRequestMessageId(message.message_id);
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

export async function handleTaskTextInput(ctx: Context): Promise<boolean> {
  const text = ctx.message?.text;
  if (!text || text.startsWith("/")) {
    return false;
  }

  if (!taskCreationManager.isActive()) {
    return false;
  }

  const interactionState = interactionManager.getSnapshot();
  if (!isTaskInteraction(interactionState)) {
    taskCreationManager.clear();
    await ctx.reply(t("task.inactive"));
    return true;
  }

  const flowState = taskCreationManager.getState();
  if (!flowState) {
    clearTaskFlow("task_state_missing");
    await ctx.reply(t("task.inactive"));
    return true;
  }

  if (taskCreationManager.isParsingSchedule()) {
    await ctx.reply(t("task.parse.in_progress"));
    return true;
  }

  if (taskCreationManager.isWaitingForSchedule()) {
    const scheduleText = text.trim();
    if (!scheduleText) {
      await ctx.reply(t("task.schedule_empty"));
      return true;
    }

    taskCreationManager.markScheduleParsing();
    interactionManager.transition({
      kind: "task",
      expectedInput: "text",
      metadata: buildTaskInteractionMetadata(
        "parsing_schedule",
        flowState.projectId,
        flowState.projectWorktree,
      ),
    });

    const parsingMessage = await ctx.reply(t("task.parse.in_progress"));

    try {
      const parsedSchedule = await parseTaskSchedule(scheduleText, flowState.projectWorktree);
      validateParsedSchedule(parsedSchedule);
      await deleteMessageIfPresent(ctx, parsingMessage.message_id);
      await deleteMessageIfPresent(ctx, flowState.scheduleRequestMessageId);

      const previewMessage = await ctx.reply(formatParsedSchedulePromptMessage(parsedSchedule), {
        reply_markup: buildRetryScheduleKeyboard(),
      });

      taskCreationManager.setParsedSchedule(
        scheduleText,
        parsedSchedule,
        previewMessage.message_id,
      );
      interactionManager.transition({
        kind: "task",
        expectedInput: "mixed",
        metadata: buildTaskInteractionMetadata(
          "awaiting_prompt",
          flowState.projectId,
          flowState.projectWorktree,
          previewMessage.message_id,
        ),
      });
      taskCreationManager.setPromptRequestMessageId(previewMessage.message_id);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t("common.unknown_error");
      logger.warn(`[TaskCommand] Failed to parse task schedule: ${errorMessage}`);
      await deleteMessageIfPresent(ctx, flowState.scheduleRequestMessageId);
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
      await deleteMessageIfPresent(ctx, parsingMessage.message_id);
      const errorReply = await ctx.reply(t("task.parse_error", { message: errorMessage }), {
        reply_markup: buildCancelKeyboard(),
      });
      taskCreationManager.setScheduleRequestMessageId(errorReply.message_id);
    }

    return true;
  }

  if (!taskCreationManager.isWaitingForPrompt()) {
    return false;
  }

  const prompt = text.trim();
  if (!prompt) {
    await ctx.reply(t("task.prompt_empty"));
    return true;
  }

  if (!flowState.parsedSchedule || !flowState.scheduleText) {
    clearTaskFlow("task_missing_schedule_before_save");
    await ctx.reply(t("task.inactive"));
    return true;
  }

  try {
    const task = buildScheduledTask(
      flowState.projectId,
      flowState.projectWorktree,
      flowState.model,
      flowState.scheduleText,
      flowState.parsedSchedule,
      prompt,
    );

    await addScheduledTask(task);
    scheduledTaskRuntime.registerTask(task);
    await deleteMessageIfPresent(ctx, flowState.previewMessageId);
    await deleteMessageIfPresent(ctx, flowState.promptRequestMessageId);
    clearTaskFlow("task_completed");
    await ctx.reply(formatTaskCreatedMessage(task));
  } catch (error) {
    logger.error("[TaskCommand] Failed to save scheduled task", error);
    await ctx.reply(t("error.generic"));
  }

  return true;
}
