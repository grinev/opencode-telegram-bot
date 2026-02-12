import { describe, expect, it } from "vitest";
import { formatModelForButton, formatModelForDisplay } from "../../src/model/types.js";

describe("model/types", () => {
  it("formats model for button without truncation", () => {
    expect(formatModelForButton("openai", "gpt-4o")).toBe("🤖 openai/gpt-4o");
  });

  it("truncates model for button when text is too long", () => {
    const result = formatModelForButton(
      "very-long-provider-name",
      "very-long-model-name-v2-preview",
    );

    expect(result.startsWith("🤖 ")).toBe(true);
    expect(result.endsWith("...")).toBe(true);
    expect(result).toBe("🤖 very-long-provider-name/ver...");
  });

  it("formats model for display", () => {
    expect(formatModelForDisplay("anthropic", "claude-sonnet")).toBe("anthropic / claude-sonnet");
  });
});
