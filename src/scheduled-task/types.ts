import type { ModelInfo } from "../model/types.js";

export type ScheduledTaskKind = "cron" | "once";

export type ScheduledTaskStatus = "idle" | "running" | "success" | "error";

export interface ScheduledTaskModel {
  providerID: string;
  modelID: string;
  variant: string | null;
}

export interface ScheduledTaskBase {
  id: string;
  projectId: string;
  projectWorktree: string;
  model: ScheduledTaskModel;
  scheduleText: string;
  scheduleSummary: string;
  timezone: string;
  prompt: string;
  createdAt: string;
  nextRunAt: string;
  lastRunAt: string | null;
  runCount: number;
  lastStatus: ScheduledTaskStatus;
  lastError: string | null;
}

export interface ScheduledCronTask extends ScheduledTaskBase {
  kind: "cron";
  cron: string;
  runAt?: undefined;
}

export interface ScheduledOnceTask extends ScheduledTaskBase {
  kind: "once";
  cron?: undefined;
  runAt: string;
}

export type ScheduledTask = ScheduledCronTask | ScheduledOnceTask;

export interface ParsedCronSchedule {
  kind: "cron";
  cron: string;
  timezone: string;
  summary: string;
  nextRunAt: string;
}

export interface ParsedOnceSchedule {
  kind: "once";
  runAt: string;
  timezone: string;
  summary: string;
  nextRunAt: string;
}

export type ParsedTaskSchedule = ParsedCronSchedule | ParsedOnceSchedule;

export interface TaskCreationState {
  stage: "awaiting_schedule" | "parsing_schedule" | "awaiting_prompt";
  projectId: string;
  projectWorktree: string;
  model: ScheduledTaskModel;
  scheduleText: string | null;
  parsedSchedule: ParsedTaskSchedule | null;
  scheduleRequestMessageId: number | null;
  previewMessageId: number | null;
  promptRequestMessageId: number | null;
}

export function createScheduledTaskModel(model: ModelInfo): ScheduledTaskModel {
  return {
    providerID: model.providerID,
    modelID: model.modelID,
    variant: model.variant ?? null,
  };
}

export function cloneParsedTaskSchedule(schedule: ParsedTaskSchedule): ParsedTaskSchedule {
  return { ...schedule };
}

export function cloneScheduledTaskModel(model: ScheduledTaskModel): ScheduledTaskModel {
  return { ...model };
}

export function cloneScheduledTask(task: ScheduledTask): ScheduledTask {
  return {
    ...task,
    model: cloneScheduledTaskModel(task.model),
  };
}
