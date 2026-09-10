import { beforeEach, describe, expect, it } from "#vitest";
import { promptQueue } from "../../../src/app/managers/prompt-queue-manager.js";
import { createIncomingPrompt } from "../../../src/app/types/prompt.js";
import {
  findQueuedPromptByButtonLabel,
  formatQueuedPromptButtonLabel,
  getQueuedPromptButtonLabels,
} from "../../../src/bot/keyboards/queued-prompt-button.js";

describe("bot/keyboards/queued-prompt-button", () => {
  beforeEach(() => {
    promptQueue.__resetForTests();
  });

  it("formats a short prompt as-is", () => {
    expect(formatQueuedPromptButtonLabel(1, "Fix the login bug")).toBe("❌ 1. Fix the login bug");
  });

  it("collapses whitespace and newlines", () => {
    expect(formatQueuedPromptButtonLabel(2, "Fix\n  the   bug")).toBe("❌ 2. Fix the bug");
  });

  it("truncates a long prompt", () => {
    const label = formatQueuedPromptButtonLabel(1, "a".repeat(80));

    expect(label).toBe(`❌ 1. ${"a".repeat(27)}…`);
  });

  it("numbers labels by queue position", () => {
    promptQueue.add(createIncomingPrompt("first"));
    promptQueue.add(createIncomingPrompt("second"));

    expect(getQueuedPromptButtonLabels()).toEqual(["❌ 1. first", "❌ 2. second"]);
  });

  it("finds the queued prompt behind a label", () => {
    promptQueue.add(createIncomingPrompt("first"));
    const second = promptQueue.add(createIncomingPrompt("second"));

    expect(findQueuedPromptByButtonLabel("❌ 2. second")?.id).toBe(second!.id);
  });

  it("distinguishes duplicate texts by their position number", () => {
    const first = promptQueue.add(createIncomingPrompt("same text"));
    const second = promptQueue.add(createIncomingPrompt("same text"));

    expect(findQueuedPromptByButtonLabel("❌ 1. same text")?.id).toBe(first!.id);
    expect(findQueuedPromptByButtonLabel("❌ 2. same text")?.id).toBe(second!.id);
  });

  it("returns null for a label that no longer matches the queue", () => {
    promptQueue.add(createIncomingPrompt("first"));

    expect(findQueuedPromptByButtonLabel("❌ 2. gone")).toBeNull();
  });
});
