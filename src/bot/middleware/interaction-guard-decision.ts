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
import { QUEUED_PROMPT_BUTTON_TEXT_PATTERN } from "../message-patterns.js";
import type { LocalCommandRegistry } from "../../app/services/local-command-registry.js";

const BUSY_ALLOWED_COMMANDS = ["/abort", "/detach", "/status", "/help", "/opencode_stop"] as const;
const BUSY_ALLOWED_COMMAND_SET = new Set<string>(BUSY_ALLOWED_COMMANDS);

function isBusyAllowedCommand(command: string | undefined, localCommandRegistry?: LocalCommandRegistry): boolean {
  return Boolean(command && (BUSY_ALLOWED_COMMAND_SET.has(command) || localCommandRegistry?.allowsWhenBusy(command)));
}

function allowsBusyInteraction(kind: InteractionKind | undefined): boolean {
  return kind === "question" || kind === "permission";
}

// Removing a queued prompt only makes sense while the session is busy, so the
// button press has to pass the busy gate the same way /abort does.
function isQueuedPromptButtonPress(ctx: Context): boolean {
  const text = ctx.message?.text;
  return typeof text === "string" && QUEUED_PROMPT_BUTTON_TEXT_PATTERN.test(text);
}

function normalizeIncomingCommand(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const token = trimmed.split(/\s+/)[0];
  if (!token) {
    return null;
  }
  const withoutMention = token.split("@")[0]?.toLowerCase();

  if (!withoutMention || withoutMention.length <= 1) {
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

export function resolveInteractionGuardDecision(
  ctx: Context,
  localCommandRegistry?: LocalCommandRegistry,
): GuardDecision {
  const state = interactionManager.getSnapshot();
  const { inputType, command } = classifyIncomingInput(ctx);
  const isBusy = foregroundSessionState.isBusy() || attachManager.isBusy();

  if (state && interactionManager.isExpired()) {
    interactionManager.clear("expired");
    return createBlockDecision(inputType, state, "expired", command, isBusy);
  }

  if (isBusy) {
    if (inputType === "command") {
      if (state && localCommandRegistry?.has(command)) {
        return createBusyBlockDecision(inputType, state, "command_not_allowed", command);
      }
      if (isBusyAllowedCommand(command, localCommandRegistry)) {
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

    if (inputType === "text" && isQueuedPromptButtonPress(ctx)) {
      return createAllowDecision(inputType, state, command, true);
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
