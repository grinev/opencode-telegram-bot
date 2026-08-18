import type { TokensInfo } from "../../app/managers/summary-aggregation-manager.js";

function isZero(value: number | undefined): boolean {
  return value !== undefined && Number.isFinite(value) && value === 0;
}

function hasNoTokenUsage(evidence: TaskAttemptEvidence): boolean {
  return (
    isZero(evidence.tokens?.input) &&
    isZero(evidence.tokens?.output) &&
    isZero(evidence.tokens?.reasoning) &&
    isZero(evidence.tokens?.cacheRead) &&
    isZero(evidence.tokens?.cacheWrite)
  );
}

function hasUnknownFinishReason(finishReason: string | undefined): boolean {
  const normalized = finishReason?.trim().toLowerCase() ?? "";
  return normalized.length === 0 || ["unknown", "invalid", "none", "null"].includes(normalized);
}

/**
 * Work evidence accumulated across every assistant turn of a single prompt
 * attempt. Any unknown value stays undefined so the zero-work check below fails
 * closed: if the run cannot be proven to have done nothing, it is never retried.
 * `turnCount` is internal aggregation bookkeeping and is only read by the
 * accumulator, never by the safety check.
 */
export interface TaskAttemptEvidence {
  tokens?: TokensInfo;
  cost?: number;
  finishReason?: string;
  hasToolActivity: boolean;
  hasReasoningActivity: boolean;
  turnCount?: number;
}

export function createEmptyTaskAttemptEvidence(): TaskAttemptEvidence {
  return {
    hasToolActivity: false,
    hasReasoningActivity: false,
    turnCount: 0,
  };
}

/**
 * Conservative attempt-wide accumulation: activity is OR-ed across turns, and a
 * token/cost field only stays known when every turn reported it. The sum is only
 * ever compared against zero, so it cannot hide work performed by any turn.
 */
export function mergeTaskAttemptEvidence(
  current: TaskAttemptEvidence,
  next: TaskAttemptEvidence,
): TaskAttemptEvidence {
  const currentTurns = current.turnCount ?? 0;

  let tokens: TokensInfo | undefined;
  if (currentTurns === 0) {
    tokens = next.tokens;
  } else if (current.tokens !== undefined && next.tokens !== undefined) {
    tokens = {
      input: current.tokens.input + next.tokens.input,
      output: current.tokens.output + next.tokens.output,
      reasoning: current.tokens.reasoning + next.tokens.reasoning,
      cacheRead: current.tokens.cacheRead + next.tokens.cacheRead,
      cacheWrite: current.tokens.cacheWrite + next.tokens.cacheWrite,
    };
  }

  let cost: number | undefined;
  if (currentTurns === 0) {
    cost = next.cost;
  } else if (current.cost !== undefined && next.cost !== undefined) {
    cost = current.cost + next.cost;
  }

  return {
    tokens,
    cost,
    finishReason: next.finishReason ?? current.finishReason,
    hasToolActivity: current.hasToolActivity || next.hasToolActivity,
    hasReasoningActivity: current.hasReasoningActivity || next.hasReasoningActivity,
    turnCount: currentTurns + 1,
  };
}

export function isGenuinelyEmptyAssistantResponse(messageText: string): boolean {
  return messageText.trim().length === 0;
}

export function isSafeZeroWorkEmptyCompletion(evidence: TaskAttemptEvidence): boolean {
  return (
    hasNoTokenUsage(evidence) &&
    isZero(evidence.cost) &&
    !evidence.hasToolActivity &&
    !evidence.hasReasoningActivity &&
    hasUnknownFinishReason(evidence.finishReason)
  );
}

/**
 * Finish reasons OpenCode actually emits on a completed assistant message,
 * from the @opencode-ai/llm `FinishReason` literal schema
 * (`packages/llm/src/schema/ids.ts`):
 *
 *   ["stop", "length", "tool-calls", "content-filter", "error", "unknown"]
 *
 * Only `"stop"` means the model ended its turn with a successfully delivered
 * answer. Every other value means the run stopped early, called a tool, was
 * filtered, errored, or has an unknown reason. session/llm/ai-sdk.ts also maps
 * any unrecognized AI SDK finish reason to `"unknown"`, so no other value can
 * appear on a real message.
 */
const TERMINAL_FINISH_REASONS = new Set(["stop"]);

export function isKnownTerminalFinishReason(finishReason: string | undefined): boolean {
  if (finishReason === undefined) {
    return false;
  }

  const normalized = finishReason.trim().toLowerCase();
  return normalized.length > 0 && TERMINAL_FINISH_REASONS.has(normalized);
}

/**
 * A completed non-empty assistant message is a terminal final-response
 * candidate only when it has positive evidence of success: no upstream error,
 * no tool activity (a message that called a tool is never the closing answer
 * of a run), and an explicitly known successful finish reason. Missing,
 * unknown, or arbitrary finish reasons fail closed - a non-empty message by
 * itself is never treated as a completed task.
 */
export function isTerminalAssistantResponse(completion: {
  hasError?: boolean;
  hasToolActivity?: boolean;
  finishReason?: string;
}): boolean {
  if (completion.hasError) {
    return false;
  }

  if (completion.hasToolActivity) {
    return false;
  }

  return isKnownTerminalFinishReason(completion.finishReason);
}
