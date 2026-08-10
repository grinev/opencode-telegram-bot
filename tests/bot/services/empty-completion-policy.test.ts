import { describe, expect, it } from "vitest";
import type { MessageCompletionInfo } from "../../../src/app/managers/summary-aggregation-manager.js";
import {
  isGenuinelyEmptyAssistantResponse,
  isSafeZeroWorkEmptyCompletion,
} from "../../../src/bot/services/empty-completion-policy.js";

function createInfo(overrides: Partial<MessageCompletionInfo> = {}): MessageCompletionInfo {
  return {
    tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    cost: 0,
    finishReason: "unknown",
    hasToolActivity: false,
    hasReasoningActivity: false,
    ...overrides,
  };
}

describe("empty completion policy", () => {
  it("recognizes the observed zero-work empty completion", () => {
    expect(isGenuinelyEmptyAssistantResponse("  ")).toBe(true);
    expect(isSafeZeroWorkEmptyCompletion(createInfo())).toBe(true);
  });

  it("does not classify meaningful assistant text as empty", () => {
    expect(isGenuinelyEmptyAssistantResponse("Useful answer")).toBe(false);
  });

  it("does not retry when tool activity occurred", () => {
    expect(isSafeZeroWorkEmptyCompletion(createInfo({ hasToolActivity: true }))).toBe(false);
  });

  it("does not retry when reasoning activity occurred", () => {
    expect(isSafeZeroWorkEmptyCompletion(createInfo({ hasReasoningActivity: true }))).toBe(false);
  });

  it("does not retry an empty response with non-zero work metadata", () => {
    expect(
      isSafeZeroWorkEmptyCompletion(
        createInfo({ tokens: { input: 1, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 } }),
      ),
    ).toBe(false);
    expect(isSafeZeroWorkEmptyCompletion(createInfo({ finishReason: "stop" }))).toBe(false);
  });
});
