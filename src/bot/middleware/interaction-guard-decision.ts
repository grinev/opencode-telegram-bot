import type { Context } from "grammy";
import { interactionManager } from "../../app/managers/interaction-manager.js";
import type {
  BlockReason,
  ExpectedInput,
  GuardDecision,
  IncomingInputType,
  InteractionState,
  InteractionKind,
} from "../../app/types/interaction.js";
import { foregroundSessionState } from "../../app/managers/foreground-session-state-manager.js";
import { attachManager } from "../../app/managers/attach-manager.js";
import { PROMPT_QUEUE_CANCEL_PREFIX } from "../handlers/prompt-queue.js";
import {
  AGENT_MODE_BUTTON_TEXT_PATTERN,
  CONTEXT_BUTTON_TEXT_PATTERN,
  MODEL_BUTTON_TEXT_PATTERN,
  VARIANT_BUTTON_TEXT_PATTERN,
} from "../message-patterns.js";

const BUSY_ALLOWED_COMMANDS = ["/abort", "/detach", "/unqueue", "/status", "/help"] as const;
const BUSY_ALLOWED_COMMAND_SET = new Set<string>(BUSY_ALLOWED_COMMANDS);

function isBusyAllowedCommand(command?: string): boolean {
  return Boolean(command && BUSY_ALLOWED_COMMAND_SET.has(command));
}

function allowsBusyInteraction(kind: InteractionKind | undefined): boolean {
  return kind === "question" || kind === "permission";
}

function normalizeIncomingCommand(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const token = trimmed.split(/\s+/)[0];
  const withoutMention = token.split("@")[0].toLowerCase();

  if (withoutMention.length <= 1) {
    return null;
  }

  return withoutMention;
}

function classifyIncomingInput(ctx: Context): {
  inputType: IncomingInputType;
  command?: string;
} {
  if (ctx.callbackQuery?.data) {
    return { inputType: "callback" };
  }

  const text = ctx.message?.text;
  if (typeof text === "string") {
    const command = normalizeIncomingCommand(text);
    if (command) {
      return { inputType: "command", command };
    }

    return { inputType: "text" };
  }

  // Photo, voice, audio, and other non-text messages are classified as "other"
  if (ctx.message?.photo) {
    return { inputType: "other" };
  }

  return { inputType: "other" };
}

function getExpectedInputBlockReason(expectedInput: ExpectedInput): BlockReason {
  switch (expectedInput) {
    case "callback":
      return "expected_callback";
    case "command":
      return "expected_command";
    case "text":
    case "mixed":
      return "expected_text";
  }
}

function createAllowDecision(
  inputType: IncomingInputType,
  state: InteractionState | null,
  command?: string,
  busy?: boolean,
): GuardDecision {
  return {
    allow: true,
    inputType,
    state,
    command,
    busy,
  };
}

function createBlockDecision(
  inputType: IncomingInputType,
  state: InteractionState,
  reason: BlockReason,
  command?: string,
  busy?: boolean,
): GuardDecision {
  return {
    allow: false,
    inputType,
    state,
    reason,
    command,
    busy,
  };
}

function createBusyBlockDecision(
  inputType: IncomingInputType,
  state: InteractionState | null,
  reason: BlockReason,
  command?: string,
): GuardDecision {
  return {
    allow: false,
    inputType,
    state,
    reason,
    command,
    busy: true,
  };
}

const REPLY_KEYBOARD_BUTTON_PATTERNS = [
  AGENT_MODE_BUTTON_TEXT_PATTERN,
  MODEL_BUTTON_TEXT_PATTERN,
  VARIANT_BUTTON_TEXT_PATTERN,
  CONTEXT_BUTTON_TEXT_PATTERN,
];

/**
 * Reply-keyboard presses arrive as ordinary text but open a menu instead of
 * becoming a prompt. Queueing them would be meaningless, and letting them open
 * a menu mid-run would leave the user with buttons the guard then rejects.
 */
function isReplyKeyboardButtonText(ctx: Context): boolean {
  const text = ctx.message?.text;
  if (typeof text !== "string") {
    return false;
  }

  return REPLY_KEYBOARD_BUTTON_PATTERNS.some((pattern) => pattern.test(text));
}

function isPromptQueueCancelCallback(ctx: Context): boolean {
  return Boolean(ctx.callbackQuery?.data?.startsWith(PROMPT_QUEUE_CANCEL_PREFIX));
}

function isAllowedRenameCancelCallback(ctx: Context, state: InteractionState): boolean {
  return (
    state.kind === "rename" &&
    state.expectedInput === "text" &&
    ctx.callbackQuery?.data === "rename:cancel"
  );
}

function isAllowedTaskCallback(ctx: Context, state: InteractionState): boolean {
  return (
    state.kind === "task" &&
    (ctx.callbackQuery?.data === "task:cancel" || ctx.callbackQuery?.data === "task:retry-schedule")
  );
}

export function resolveInteractionGuardDecision(ctx: Context): GuardDecision {
  const state = interactionManager.getSnapshot();
  const { inputType, command } = classifyIncomingInput(ctx);
  const isBusy = foregroundSessionState.isBusy() || attachManager.isBusy();

  if (state && interactionManager.isExpired()) {
    interactionManager.clear("expired");
    return createBlockDecision(inputType, state, "expired", command, isBusy);
  }

  // Cancelling a queued prompt only edits its own bubble: it touches no session
  // state, so it stays available whatever the agent is doing. Without this the
  // button is dead exactly when the queue exists — while the agent is busy.
  if (isPromptQueueCancelCallback(ctx)) {
    return createAllowDecision(inputType, state, command, isBusy);
  }

  if (isBusy) {
    if (inputType === "command") {
      if (isBusyAllowedCommand(command)) {
        return createAllowDecision(inputType, state, command, true);
      }

      return createBusyBlockDecision(inputType, state, "command_not_allowed", command);
    }

    if (state && allowsBusyInteraction(state.kind)) {
      if (state.expectedInput === "mixed") {
        if (inputType === "callback" || inputType === "text") {
          return createAllowDecision(inputType, state, command, true);
        }

        return createBusyBlockDecision(inputType, state, "expected_text", command);
      }

      if (state.expectedInput === inputType) {
        return createAllowDecision(inputType, state, command, true);
      }

      return createBusyBlockDecision(
        inputType,
        state,
        getExpectedInputBlockReason(state.expectedInput),
        command,
      );
    }

    // Plain prompts are no longer rejected while the agent runs: let them reach
    // the prompt handler, which parks them in the per-session queue. Only free
    // input with no pending interaction qualifies — a pending rename or task
    // prompt still owns the next message the user types.
    if (
      !state &&
      (inputType === "text" || inputType === "other") &&
      !isReplyKeyboardButtonText(ctx)
    ) {
      return { ...createAllowDecision(inputType, state, command, true), queueable: true };
    }

    return createBusyBlockDecision(inputType, state, "expected_text", command);
  }

  if (!state) {
    return createAllowDecision(inputType, null, command);
  }

  if (inputType === "command") {
    if (command === "/start") {
      return createAllowDecision(inputType, state, command);
    }

    if (command && state.allowedCommands.includes(command)) {
      return createAllowDecision(inputType, state, command);
    }

    return createBlockDecision(inputType, state, "command_not_allowed", command);
  }

  if (state.expectedInput === "mixed") {
    if (inputType === "callback" || inputType === "text") {
      return createAllowDecision(inputType, state, command);
    }

    return createBlockDecision(inputType, state, "expected_text", command);
  }

  if (inputType === "callback" && isAllowedRenameCancelCallback(ctx, state)) {
    return createAllowDecision(inputType, state, command);
  }

  if (inputType === "callback" && isAllowedTaskCallback(ctx, state)) {
    return createAllowDecision(inputType, state, command);
  }

  if (state.expectedInput === inputType) {
    return createAllowDecision(inputType, state, command);
  }

  return createBlockDecision(
    inputType,
    state,
    getExpectedInputBlockReason(state.expectedInput),
    command,
  );
}
