export type InteractionKind = "inline" | "permission" | "question" | "rename" | "custom";

export type ExpectedInput = "callback" | "text" | "command" | "mixed";

export type IncomingInputType = "callback" | "command" | "text" | "other";

export type InteractionMetadata = Record<string, unknown>;

export interface InteractionState {
  kind: InteractionKind;
  expectedInput: ExpectedInput;
  allowedCommands: string[];
  metadata: InteractionMetadata;
  createdAt: number;
  expiresAt: number | null;
}

export interface StartInteractionOptions {
  kind: InteractionKind;
  expectedInput: ExpectedInput;
  allowedCommands?: string[];
  metadata?: InteractionMetadata;
  expiresInMs?: number | null;
}

export interface TransitionInteractionOptions {
  kind?: InteractionKind;
  expectedInput?: ExpectedInput;
  allowedCommands?: string[];
  metadata?: InteractionMetadata;
  expiresInMs?: number | null;
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
  reason?: BlockReason;
  command?: string;
}
