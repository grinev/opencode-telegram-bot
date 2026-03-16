import type { ParsedTaskSchedule, ScheduledTaskModel, TaskCreationState } from "./types.js";
import { cloneParsedTaskSchedule, cloneScheduledTaskModel } from "./types.js";
import { logger } from "../utils/logger.js";

function cloneState(state: TaskCreationState): TaskCreationState {
  return {
    ...state,
    model: cloneScheduledTaskModel(state.model),
    parsedSchedule: state.parsedSchedule ? cloneParsedTaskSchedule(state.parsedSchedule) : null,
  };
}

class TaskCreationManager {
  private state: TaskCreationState | null = null;

  start(projectId: string, projectWorktree: string, model: ScheduledTaskModel): TaskCreationState {
    this.state = {
      stage: "awaiting_schedule",
      projectId,
      projectWorktree,
      model: cloneScheduledTaskModel(model),
      scheduleText: null,
      parsedSchedule: null,
      scheduleRequestMessageId: null,
      previewMessageId: null,
      promptRequestMessageId: null,
    };

    logger.info(`[TaskCreationManager] Started task creation flow for project=${projectWorktree}`);

    return cloneState(this.state);
  }

  isActive(): boolean {
    return this.state !== null;
  }

  isWaitingForSchedule(): boolean {
    return this.state?.stage === "awaiting_schedule";
  }

  isParsingSchedule(): boolean {
    return this.state?.stage === "parsing_schedule";
  }

  isWaitingForPrompt(): boolean {
    return this.state?.stage === "awaiting_prompt";
  }

  getState(): TaskCreationState | null {
    return this.state ? cloneState(this.state) : null;
  }

  setParsedSchedule(
    scheduleText: string,
    parsedSchedule: ParsedTaskSchedule,
    previewMessageId: number,
  ): TaskCreationState | null {
    if (!this.state) {
      return null;
    }

    this.state = {
      ...this.state,
      stage: "awaiting_prompt",
      scheduleText,
      parsedSchedule: cloneParsedTaskSchedule(parsedSchedule),
      scheduleRequestMessageId: null,
      previewMessageId,
      promptRequestMessageId: null,
    };

    logger.info("[TaskCreationManager] Parsed schedule and switched flow to prompt input");

    return cloneState(this.state);
  }

  markScheduleParsing(): TaskCreationState | null {
    if (!this.state) {
      return null;
    }

    this.state = {
      ...this.state,
      stage: "parsing_schedule",
    };

    logger.info("[TaskCreationManager] Schedule parsing started");

    return cloneState(this.state);
  }

  setPromptRequestMessageId(messageId: number): TaskCreationState | null {
    if (!this.state) {
      return null;
    }

    this.state = {
      ...this.state,
      promptRequestMessageId: messageId,
    };

    return cloneState(this.state);
  }

  setScheduleRequestMessageId(messageId: number): TaskCreationState | null {
    if (!this.state) {
      return null;
    }

    this.state = {
      ...this.state,
      scheduleRequestMessageId: messageId,
    };

    return cloneState(this.state);
  }

  resetSchedule(): TaskCreationState | null {
    if (!this.state) {
      return null;
    }

    this.state = {
      ...this.state,
      stage: "awaiting_schedule",
      scheduleText: null,
      parsedSchedule: null,
      scheduleRequestMessageId: null,
      previewMessageId: null,
      promptRequestMessageId: null,
    };

    logger.info("[TaskCreationManager] Reset task creation flow back to schedule input");

    return cloneState(this.state);
  }

  clear(): void {
    if (!this.state) {
      return;
    }

    logger.debug("[TaskCreationManager] Clearing task creation state");
    this.state = null;
  }
}

export const taskCreationManager = new TaskCreationManager();
