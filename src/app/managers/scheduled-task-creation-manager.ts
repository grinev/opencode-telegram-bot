import type { ParsedTaskSchedule, ScheduledTaskModel, TaskCreationState } from "../types/scheduled-task.js";
import { cloneParsedTaskSchedule, cloneScheduledTaskModel } from "../types/scheduled-task.js";
import { interactionManager } from "./interaction-manager.js";
import { logger } from "../../utils/logger.js";

function cloneState(state: TaskCreationState): TaskCreationState {
  return {
    ...state,
    model: cloneScheduledTaskModel(state.model),
    parsedSchedule: state.parsedSchedule ? cloneParsedTaskSchedule(state.parsedSchedule) : null,
  };
}

class TaskCreationManager {
  private get state(): TaskCreationState | null {
    return interactionManager.getPayload("task");
  }

  private update(changes: Partial<TaskCreationState>): TaskCreationState | null {
    const state = this.state;
    if (!state) {
      return null;
    }

    Object.assign(state, changes);
    return cloneState(state);
  }

  start(
    projectId: string,
    projectWorktree: string,
    model: ScheduledTaskModel,
    agent: string,
  ): TaskCreationState {
    const state: TaskCreationState = {
      stage: "awaiting_schedule",
      projectId,
      projectWorktree,
      agent,
      model: cloneScheduledTaskModel(model),
      scheduleText: null,
      parsedSchedule: null,
      scheduleRequestMessageId: null,
      previewMessageId: null,
      promptRequestMessageId: null,
    };
    interactionManager.start({ kind: "task", expectedInput: "text", payload: state });

    logger.info(`[TaskCreationManager] Started task creation flow for project=${projectWorktree}`);

    return cloneState(state);
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
    const state = this.update({
      stage: "awaiting_prompt",
      scheduleText,
      parsedSchedule: cloneParsedTaskSchedule(parsedSchedule),
      scheduleRequestMessageId: null,
      previewMessageId,
      promptRequestMessageId: null,
    });

    if (state) {
      logger.info("[TaskCreationManager] Parsed schedule and switched flow to prompt input");
    }

    return state;
  }

  markScheduleParsing(): TaskCreationState | null {
    const state = this.update({ stage: "parsing_schedule" });

    if (state) {
      logger.info("[TaskCreationManager] Schedule parsing started");
    }

    return state;
  }

  setPromptRequestMessageId(messageId: number): TaskCreationState | null {
    return this.update({ promptRequestMessageId: messageId });
  }

  setScheduleRequestMessageId(messageId: number): TaskCreationState | null {
    return this.update({ scheduleRequestMessageId: messageId });
  }

  resetSchedule(): TaskCreationState | null {
    const state = this.update({
      stage: "awaiting_schedule",
      scheduleText: null,
      parsedSchedule: null,
      scheduleRequestMessageId: null,
      previewMessageId: null,
      promptRequestMessageId: null,
    });

    if (state) {
      logger.info("[TaskCreationManager] Reset task creation flow back to schedule input");
    }

    return state;
  }

  clear(): void {
    if (!this.state) {
      return;
    }

    logger.debug("[TaskCreationManager] Clearing task creation state");
    interactionManager.clearKind("task", "task_creation_cleared");
  }
}

export const taskCreationManager = new TaskCreationManager();
