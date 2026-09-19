import type {
  ActiveInteraction,
  InteractionClearReason,
  InteractionPayloads,
  InteractionState,
  StartInteractionOptions,
  StatefulInteractionKind,
  TransitionInteractionOptions,
  WaitingAgentRequest,
  WaitingAgentRequestListener,
} from "../types/interaction.js";
import type { PermissionRequest } from "../types/permission.js";
import type { Question } from "../types/question.js";
import { logger } from "../../utils/logger.js";

export const DEFAULT_ALLOWED_INTERACTION_COMMANDS = [
  "/help",
  "/status",
  "/abort",
  "/detach",
  "/opencode_stop",
] as const;

function normalizeCommand(command: string): string | null {
  const trimmed = command.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const withoutMention = withSlash.split("@")[0];
  if (!withoutMention || withoutMention.length <= 1) {
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

function toSnapshot(state: ActiveInteraction): InteractionState {
  return {
    kind: state.kind,
    expectedInput: state.expectedInput,
    allowedCommands: [...state.allowedCommands],
    metadata: { ...state.metadata },
    createdAt: state.createdAt,
    expiresAt: state.expiresAt,
  };
}

function isAgentRequestKind(kind: InteractionState["kind"]): boolean {
  return kind === "question" || kind === "permission";
}

export type InteractionErrorScope =
  | "question"
  | "permission"
  | "rename"
  | "taskCreation"
  | "interaction"
  | "none";

const SCOPE_TO_INTERACTION_KIND: Record<
  Exclude<InteractionErrorScope, "interaction" | "none">,
  StatefulInteractionKind
> = {
  question: "question",
  permission: "permission",
  rename: "rename",
  taskCreation: "task",
};

export class InteractionManager {
  private state: ActiveInteraction | null = null;
  private waiting: WaitingAgentRequest | null = null;
  private generation = 0;
  private onWaitingRequestReady: WaitingAgentRequestListener | null = null;

  /**
   * Opens the slot, replacing whatever it held. Replacing never releases the
   * waiting request: only a clear does.
   */
  start(options: StartInteractionOptions): InteractionState {
    const now = Date.now();
    let expiresAt: number | null = null;

    if (this.state) {
      this.drop("state_replaced");
    }

    const { expiresInMs, ...rest } = options;
    if (typeof expiresInMs === "number") {
      expiresAt = now + expiresInMs;
    }

    const nextState: ActiveInteraction = {
      ...rest,
      allowedCommands: normalizeAllowedCommands(options.allowedCommands),
      metadata: options.metadata ? { ...options.metadata } : {},
      createdAt: now,
      expiresAt,
    };

    this.state = nextState;

    logger.info(
      `[InteractionManager] Started interaction: kind=${nextState.kind}, expectedInput=${nextState.expectedInput}, allowedCommands=${nextState.allowedCommands.join(",") || "none"}`,
    );

    return toSnapshot(nextState);
  }

  get(): InteractionState | null {
    if (!this.state) {
      return null;
    }

    return toSnapshot(this.state);
  }

  getSnapshot(): InteractionState | null {
    return this.get();
  }

  /**
   * Live data of the given kind, or null when the slot holds another kind.
   */
  getPayload<K extends StatefulInteractionKind>(kind: K): InteractionPayloads[K] | null {
    if (!this.state || this.state.kind !== kind || !("payload" in this.state)) {
      return null;
    }

    return this.state.payload as InteractionPayloads[K];
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

    return toSnapshot(this.state);
  }

  /**
   * Empties the slot. When a question or permission ends and a request of the
   * other kind is waiting, that request is handed to the listener.
   */
  clear(reason: InteractionClearReason = "manual"): void {
    const clearedKind = this.drop(reason);
    if (!clearedKind || !isAgentRequestKind(clearedKind) || !this.waiting) {
      return;
    }

    const request = this.waiting;
    const generation = this.generation;
    const listener = this.onWaitingRequestReady;
    this.waiting = null;

    if (!listener) {
      logger.warn(
        `[InteractionManager] No listener for the waiting request, dropping it: kind=${request.kind}`,
      );
      return;
    }

    logger.info(
      `[InteractionManager] Releasing waiting request: kind=${request.kind}, after=${clearedKind}`,
    );
    setImmediate(() => listener(request, generation));
  }

  /**
   * Clears the slot only if it holds the given kind.
   */
  clearKind(kind: InteractionState["kind"], reason: InteractionClearReason): void {
    if (this.state?.kind === kind) {
      this.clear(reason);
    }
  }

  /**
   * Drops the slot and the waiting request together, and marks permission
   * prompts still being sent as stale.
   */
  reset(reason: InteractionClearReason): void {
    const interactionSnapshot = this.getSnapshot();
    const waitingKind = this.getWaitingKind();

    this.waiting = null;
    this.bumpGeneration();
    this.drop(reason);

    const message =
      `[InteractionCleanup] Cleared state: reason=${reason}, ` +
      `interactionKind=${interactionSnapshot?.kind || "none"}, waiting=${waitingKind || "none"}`;

    if (interactionSnapshot !== null || waitingKind !== null) {
      logger.info(message);
      return;
    }

    logger.debug(message);
  }

  /**
   * Drops only what a failed handler in the given scope may have left behind.
   */
  clearErrorScope(scope: InteractionErrorScope, reason: InteractionClearReason): void {
    if (scope === "none") {
      return;
    }

    const stateBefore = this.getSnapshot();

    if (scope === "interaction") {
      this.clear(reason);
    } else {
      if (scope === "permission") {
        // Bump first, so a poll released by this clear carries the new generation.
        this.bumpGeneration();
      }

      this.clearKind(SCOPE_TO_INTERACTION_KIND[scope], reason);
    }

    logger.debug(
      `[InteractionCleanup] Cleared scoped state: reason=${reason}, scope=${scope}, interactionKind=${stateBefore?.kind || "none"}`,
    );
  }

  getGeneration(): number {
    return this.generation;
  }

  bumpGeneration(): void {
    this.generation++;
  }

  waitQuestion(questions: Question[], requestID: string, sessionId: string): void {
    if (this.waiting?.kind === "question") {
      logger.info(
        `[InteractionManager] Replacing waiting poll: requestID=${this.waiting.requestID}`,
      );
    }

    this.waiting = { kind: "question", questions, requestID, sessionId };
    logger.info(`[InteractionManager] Poll is waiting: requestID=${requestID}`);
  }

  waitPermission(request: PermissionRequest): void {
    const requests = this.waiting?.kind === "permission" ? this.waiting.requests : [];
    if (!requests.some((waiting) => waiting.id === request.id)) {
      requests.push(request);
    }

    this.waiting = { kind: "permission", requests };
    logger.info(
      `[InteractionManager] Permission is waiting: requestID=${request.id}, waiting=${requests.length}`,
    );
  }

  dropWaitingPermission(requestID: string): void {
    if (this.waiting?.kind !== "permission") {
      return;
    }

    const requests = this.waiting.requests.filter((request) => request.id !== requestID);
    if (requests.length === this.waiting.requests.length) {
      return;
    }

    this.waiting = requests.length > 0 ? { kind: "permission", requests } : null;
    logger.info(`[InteractionManager] Dropped waiting permission: requestID=${requestID}`);
  }

  dropWaitingQuestion(): boolean {
    if (this.waiting?.kind !== "question") {
      return false;
    }

    logger.info(`[InteractionManager] Dropped waiting poll: requestID=${this.waiting.requestID}`);
    this.waiting = null;
    return true;
  }

  getWaitingKind(): WaitingAgentRequest["kind"] | null {
    return this.waiting?.kind ?? null;
  }

  setOnWaitingRequestReady(listener: WaitingAgentRequestListener | null): void {
    this.onWaitingRequestReady = listener;
  }

  private drop(reason: InteractionClearReason): InteractionState["kind"] | null {
    if (!this.state) {
      return null;
    }

    const kind = this.state.kind;
    logger.info(
      `[InteractionManager] Cleared interaction: reason=${reason}, kind=${kind}, expectedInput=${this.state.expectedInput}`,
    );

    this.state = null;
    return kind;
  }
}
