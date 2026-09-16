import type { PermissionRequest, PermissionState } from "./permission.js";
import type { Question, QuestionState } from "./question.js";
import type { RenameState } from "./rename.js";
import type { TaskCreationState } from "./scheduled-task.js";

export type InteractionKind = "inline" | "permission" | "question" | "rename" | "task" | "custom";

export type ExpectedInput = "callback" | "text" | "command" | "mixed";

export type IncomingInputType = "callback" | "command" | "text" | "other";

export type InteractionMetadata = Record<string, unknown>;

/** Data owned by the interaction kinds that carry their own state. */
export interface InteractionPayloads {
  question: QuestionState;
  permission: PermissionState;
  rename: RenameState;
  task: TaskCreationState;
}

export type StatefulInteractionKind = keyof InteractionPayloads;

interface InteractionBase {
  expectedInput: ExpectedInput;
  allowedCommands: string[];
  metadata: InteractionMetadata;
  createdAt: number;
  expiresAt: number | null;
}

/**
 * The single interaction slot. Exactly one kind can be live at a time, and a
 * stateful kind cannot be live without its data.
 */
export type ActiveInteraction =
  | (InteractionBase & { kind: "question"; payload: QuestionState })
  | (InteractionBase & { kind: "permission"; payload: PermissionState })
  | (InteractionBase & { kind: "rename"; payload: RenameState })
  | (InteractionBase & { kind: "task"; payload: TaskCreationState })
  | (InteractionBase & { kind: "inline" | "custom" });

/** Read-only view of the slot handed to callers, without the kind's data. */
export interface InteractionState extends InteractionBase {
  kind: InteractionKind;
}

interface StartInteractionOptionsBase {
  expectedInput: ExpectedInput;
  allowedCommands?: string[] | undefined;
  metadata?: InteractionMetadata | undefined;
  expiresInMs?: number | null | undefined;
}

export type StartInteractionOptions =
  | (StartInteractionOptionsBase & { kind: "question"; payload: QuestionState })
  | (StartInteractionOptionsBase & { kind: "permission"; payload: PermissionState })
  | (StartInteractionOptionsBase & { kind: "rename"; payload: RenameState })
  | (StartInteractionOptionsBase & { kind: "task"; payload: TaskCreationState })
  | (StartInteractionOptionsBase & { kind: "inline" | "custom" });

/** An agent request that arrived while a request of the other kind was on screen. */
export type WaitingAgentRequest =
  | { kind: "question"; questions: Question[]; requestID: string; sessionId: string }
  | { kind: "permission"; requests: PermissionRequest[] };

export type WaitingAgentRequestListener = (
  request: WaitingAgentRequest,
  generation: number,
) => void;

export interface TransitionInteractionOptions {
  expectedInput?: ExpectedInput | undefined;
  allowedCommands?: string[] | undefined;
  metadata?: InteractionMetadata | undefined;
  expiresInMs?: number | null | undefined;
}

export type InteractionClearReason = string;

export type BlockReason =
  | "expired"
  | "expected_callback"
  | "expected_text"
  | "expected_command"
  | "command_not_allowed";

export interface GuardDecision {
  allow: boolean;
  inputType: IncomingInputType;
  state: InteractionState | null;
  reason?: BlockReason | undefined;
  command?: string | undefined;
  busy?: boolean | undefined;
}
