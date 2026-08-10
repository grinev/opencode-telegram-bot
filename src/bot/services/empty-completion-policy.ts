import type { MessageCompletionInfo } from "../../app/managers/summary-aggregation-manager.js";

function isZero(value: number | undefined): boolean {
  return value !== undefined && Number.isFinite(value) && value === 0;
}

function hasNoTokenUsage(info: MessageCompletionInfo): boolean {
  return (
    isZero(info.tokens?.input) &&
    isZero(info.tokens?.output) &&
    isZero(info.tokens?.reasoning) &&
    isZero(info.tokens?.cacheRead) &&
    isZero(info.tokens?.cacheWrite)
  );
}

function hasUnknownFinishReason(finishReason: string | undefined): boolean {
  const normalized = finishReason?.trim().toLowerCase() ?? "";
  return normalized.length === 0 || ["unknown", "invalid", "none", "null"].includes(normalized);
}

export function isGenuinelyEmptyAssistantResponse(messageText: string): boolean {
  return messageText.trim().length === 0;
}

export function isSafeZeroWorkEmptyCompletion(info: MessageCompletionInfo): boolean {
  return (
    hasNoTokenUsage(info) &&
    isZero(info.cost) &&
    !info.hasToolActivity &&
    !info.hasReasoningActivity &&
    hasUnknownFinishReason(info.finishReason)
  );
}
