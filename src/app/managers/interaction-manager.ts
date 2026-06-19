import type {
  InteractionClearReason,
  InteractionState,
  StartInteractionOptions,
  TransitionInteractionOptions,
} from "../types/interaction.js";
import { permissionManager } from "./permission-manager.js";
import { questionManager } from "./question-manager.js";
import { renameManager } from "./rename-manager.js";
import { taskCreationManager } from "./scheduled-task-creation-manager.js";
import { logger } from "../../utils/logger.js";

export const DEFAULT_ALLOWED_INTERACTION_COMMANDS = [
  "/help",
  "/status",
  "/abort",
  "/detach",
] as const;

function normalizeCommand(command: string): string | null {
  const trimmed = command.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const withoutMention = withSlash.split("@")[0];

  if (withoutMention.length <= 1) {
    return null;
  }

  return withoutMention;
}

function normalizeAllowedCommands(commands?: string[]): string[] {
  if (commands === undefined) {
    return [...DEFAULT_ALLOWED_INTERACTION_COMMANDS];
  }

  const normalized = new Set<string>();

  for (const command of commands) {
    const value = normalizeCommand(command);
    if (value) {
      normalized.add(value);
    }
  }

  return Array.from(normalized);
}

function cloneState(state: InteractionState): InteractionState {
  return {
    ...state,
    allowedCommands: [...state.allowedCommands],
    metadata: { ...state.metadata },
  };
}

class InteractionManager {
  private state: InteractionState | null = null;

  start(options: StartInteractionOptions): InteractionState {
    const now = Date.now();
    let expiresAt: number | null = null;

    if (this.state) {
      this.clear("state_replaced");
    }

    if (typeof options.expiresInMs === "number") {
      expiresAt = now + options.expiresInMs;
    }

    const nextState: InteractionState = {
      kind: options.kind,
      expectedInput: options.expectedInput,
      allowedCommands: normalizeAllowedCommands(options.allowedCommands),
      metadata: options.metadata ? { ...options.metadata } : {},
      createdAt: now,
      expiresAt,
    };

    this.state = nextState;

    logger.info(
      `[InteractionManager] Started interaction: kind=${nextState.kind}, expectedInput=${nextState.expectedInput}, allowedCommands=${nextState.allowedCommands.join(",") || "none"}`,
    );

    return cloneState(nextState);
  }

  get(): InteractionState | null {
    if (!this.state) {
      return null;
    }

    return cloneState(this.state);
  }

  getSnapshot(): InteractionState | null {
    return this.get();
  }

  isActive(): boolean {
    return this.state !== null;
  }

  isExpired(referenceTimeMs: number = Date.now()): boolean {
    if (!this.state || this.state.expiresAt === null) {
      return false;
    }

    return referenceTimeMs >= this.state.expiresAt;
  }

  transition(options: TransitionInteractionOptions): InteractionState | null {
    if (!this.state) {
      return null;
    }

    const now = Date.now();

    this.state = {
      ...this.state,
      kind: options.kind ?? this.state.kind,
      expectedInput: options.expectedInput ?? this.state.expectedInput,
      allowedCommands:
        options.allowedCommands !== undefined
          ? normalizeAllowedCommands(options.allowedCommands)
          : [...this.state.allowedCommands],
      metadata: options.metadata ? { ...options.metadata } : { ...this.state.metadata },
      expiresAt:
        options.expiresInMs === undefined
          ? this.state.expiresAt
          : options.expiresInMs === null
            ? null
            : now + options.expiresInMs,
    };

    logger.debug(
      `[InteractionManager] Transitioned interaction: kind=${this.state.kind}, expectedInput=${this.state.expectedInput}, allowedCommands=${this.state.allowedCommands.join(",") || "none"}`,
    );

    return cloneState(this.state);
  }

  clear(reason: InteractionClearReason = "manual"): void {
    if (!this.state) {
      return;
    }

    logger.info(
      `[InteractionManager] Cleared interaction: reason=${reason}, kind=${this.state.kind}, expectedInput=${this.state.expectedInput}`,
    );

    this.state = null;
  }
}

export const interactionManager = new InteractionManager();

export function clearAllInteractionState(reason: string): void {
  const questionActive = questionManager.isActive();
  const permissionActive = permissionManager.isActive();
  const renameActive = renameManager.isWaitingForName();
  const taskCreationActive = taskCreationManager.isActive();
  const interactionSnapshot = interactionManager.getSnapshot();

  questionManager.clear();
  permissionManager.clear();
  renameManager.clear();
  taskCreationManager.clear();
  interactionManager.clear(reason);

  const hasAnyActiveState =
    questionActive ||
    permissionActive ||
    renameActive ||
    taskCreationActive ||
    interactionSnapshot !== null;

  const message =
    `[InteractionCleanup] Cleared state: reason=${reason}, ` +
    `questionActive=${questionActive}, permissionActive=${permissionActive}, ` +
    `renameActive=${renameActive}, taskCreationActive=${taskCreationActive}, ` +
    `interactionKind=${interactionSnapshot?.kind || "none"}`;

  if (hasAnyActiveState) {
    logger.info(message);
    return;
  }

  logger.debug(message);
}
