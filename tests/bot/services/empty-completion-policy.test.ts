import { describe, expect, it } from "vitest";
import type { MessageCompletionInfo } from "../../../src/app/managers/summary-aggregation-manager.js";
import {
  createEmptyTaskAttemptEvidence,
  isGenuinelyEmptyAssistantResponse,
  isSafeZeroWorkEmptyCompletion,
  isTerminalAssistantResponse,
  mergeTaskAttemptEvidence,
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

  it("fails closed when any turn is missing token or cost data", () => {
    expect(isSafeZeroWorkEmptyCompletion(createInfo({ tokens: undefined }))).toBe(false);
    expect(isSafeZeroWorkEmptyCompletion(createInfo({ cost: undefined }))).toBe(false);
  });

  describe("attempt-wide evidence aggregation", () => {
    it("keeps a single zero-work empty turn retry-safe", () => {
      const evidence = mergeTaskAttemptEvidence(
        createEmptyTaskAttemptEvidence(),
        createInfo(),
      );
      expect(isSafeZeroWorkEmptyCompletion(evidence)).toBe(true);
    });

    it("blocks retry when an earlier turn used a tool", () => {
      const earlier = createInfo({ hasToolActivity: true, tokens: { ...createInfo().tokens! } });
      const evidence = mergeTaskAttemptEvidence(createEmptyTaskAttemptEvidence(), earlier);
      const final = mergeTaskAttemptEvidence(evidence, createInfo());
      expect(isSafeZeroWorkEmptyCompletion(final)).toBe(false);
    });

    it("blocks retry when an earlier turn reasoned", () => {
      const earlier = createInfo({ hasReasoningActivity: true });
      const evidence = mergeTaskAttemptEvidence(createEmptyTaskAttemptEvidence(), earlier);
      const final = mergeTaskAttemptEvidence(evidence, createInfo());
      expect(isSafeZeroWorkEmptyCompletion(final)).toBe(false);
    });

    it("blocks retry when an earlier turn consumed tokens even if the final is empty", () => {
      const earlier = createInfo({
        tokens: { input: 42, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
      });
      const evidence = mergeTaskAttemptEvidence(createEmptyTaskAttemptEvidence(), earlier);
      const final = mergeTaskAttemptEvidence(evidence, createInfo());
      expect(isSafeZeroWorkEmptyCompletion(final)).toBe(false);
    });

    it("blocks retry when any turn lacked token or cost reporting", () => {
      const missingTokens = createInfo({ tokens: undefined });
      const evidence = mergeTaskAttemptEvidence(createEmptyTaskAttemptEvidence(), missingTokens);
      expect(isSafeZeroWorkEmptyCompletion(mergeTaskAttemptEvidence(evidence, createInfo()))).toBe(
        false,
      );

      const missingCost = createInfo({ cost: undefined });
      const evidence2 = mergeTaskAttemptEvidence(createEmptyTaskAttemptEvidence(), missingCost);
      expect(isSafeZeroWorkEmptyCompletion(mergeTaskAttemptEvidence(evidence2, createInfo()))).toBe(
        false,
      );
    });

    it("uses the last known finish reason and ORs activity flags", () => {
      const evidence = mergeTaskAttemptEvidence(
        createEmptyTaskAttemptEvidence(),
        createInfo({ finishReason: "stop" }),
      );
      const final = mergeTaskAttemptEvidence(evidence, createInfo({ finishReason: "length" }));
      expect(final.finishReason).toBe("length");
      expect(final.hasToolActivity).toBe(false);

      const tooled = mergeTaskAttemptEvidence(
        createEmptyTaskAttemptEvidence(),
        createInfo({ hasToolActivity: true }),
      );
      expect(mergeTaskAttemptEvidence(tooled, createInfo()).hasToolActivity).toBe(true);
    });
  });

  describe("terminal response detection", () => {
    it("treats a clean non-empty completion as terminal", () => {
      expect(isTerminalAssistantResponse({ hasError: false, hasToolActivity: false })).toBe(true);
      expect(isTerminalAssistantResponse({})).toBe(true);
    });

    it("rejects an errored or aborted completion", () => {
      expect(isTerminalAssistantResponse({ hasError: true })).toBe(false);
      expect(isTerminalAssistantResponse({ hasError: true, hasToolActivity: false })).toBe(false);
    });

    it("rejects a completion whose message called a tool", () => {
      expect(isTerminalAssistantResponse({ hasToolActivity: true })).toBe(false);
    });

    it("rejects known non-terminal finish reasons but accepts unknown ones", () => {
      expect(isTerminalAssistantResponse({ finishReason: "max_tokens" })).toBe(false);
      expect(isTerminalAssistantResponse({ finishReason: "length" })).toBe(false);
      expect(isTerminalAssistantResponse({ finishReason: "content_filter" })).toBe(false);
      expect(isTerminalAssistantResponse({ finishReason: "tool_use" })).toBe(false);
      expect(isTerminalAssistantResponse({ finishReason: "end_turn" })).toBe(true);
      expect(isTerminalAssistantResponse({ finishReason: undefined })).toBe(true);
      expect(isTerminalAssistantResponse({ finishReason: "unusual-reason" })).toBe(true);
    });

    it("fails closed when error and tool activity are combined with otherwise clean signals", () => {
      expect(
        isTerminalAssistantResponse({
          hasError: true,
          hasToolActivity: false,
          finishReason: "end_turn",
        }),
      ).toBe(false);
      expect(
        isTerminalAssistantResponse({
          hasError: false,
          hasToolActivity: true,
          finishReason: "end_turn",
        }),
      ).toBe(false);
    });
  });
});
