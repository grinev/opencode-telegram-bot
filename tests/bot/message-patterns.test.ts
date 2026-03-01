import { describe, expect, it } from "vitest";
import { createMainKeyboard } from "../../src/bot/utils/keyboard.js";
import {
  AGENT_BUTTON_TEXT_PATTERN,
  MODEL_BUTTON_TEXT_PATTERN,
  VARIANT_BUTTON_TEXT_PATTERN,
} from "../../src/bot/message-patterns.js";

function getButtonText(button: string | { text: string }): string {
  return typeof button === "string" ? button : button.text;
}

describe("bot/message-patterns", () => {
  it("matches model button text from main keyboard", () => {
    const keyboard = createMainKeyboard("build", {
      providerID: "openrouter",
      modelID: "openai/gpt-4o",
    });

    const modelButtonText = getButtonText(keyboard.keyboard[1][0]);
    expect(modelButtonText).toMatch(MODEL_BUTTON_TEXT_PATTERN);
  });

  it("matches current and legacy variant button prefixes", () => {
    const keyboard = createMainKeyboard("build", {
      providerID: "openrouter",
      modelID: "openai/gpt-4o",
    });

    const variantButtonText = getButtonText(keyboard.keyboard[1][1]);
    expect(variantButtonText).toMatch(VARIANT_BUTTON_TEXT_PATTERN);
    expect("💭 Default").toMatch(VARIANT_BUTTON_TEXT_PATTERN);
  });

  it("does not match plain prompt text", () => {
    expect("Create a migration plan").not.toMatch(MODEL_BUTTON_TEXT_PATTERN);
    expect("Create a migration plan").not.toMatch(VARIANT_BUTTON_TEXT_PATTERN);
    expect("Create a migration plan").not.toMatch(AGENT_BUTTON_TEXT_PATTERN);
  });

  it("matches agent button text with punctuation", () => {
    const withParentheses = "🤖 Sisyphus(Ultraworker) Mode";

    expect(withParentheses).toMatch(AGENT_BUTTON_TEXT_PATTERN);
  });

  it("does not treat agent mode labels as model buttons", () => {
    expect("🤖 Sisyphus(Ultraworker) Mode").not.toMatch(MODEL_BUTTON_TEXT_PATTERN);
  });

  it("still matches provider/model format for model buttons", () => {
    expect("🤖 cliproxyapi/gpt-5.3-codex").toMatch(MODEL_BUTTON_TEXT_PATTERN);
    expect("🤖 very-long-provider-name/ver...").toMatch(MODEL_BUTTON_TEXT_PATTERN);
    expect("🤖 cliproxyapi/Sisyphus(Ultraworker) Mode").toMatch(MODEL_BUTTON_TEXT_PATTERN);
  });
});
