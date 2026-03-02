import { describe, expect, it } from "vitest";
import { createMainKeyboard } from "../../src/bot/utils/keyboard.js";
import {
  AGENT_MODE_BUTTON_TEXT_PATTERN,
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

  it("matches single-line model button text", () => {
    expect("🤖 cliproxyapi2/gpt-5.3-codex").toMatch(MODEL_BUTTON_TEXT_PATTERN);
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
    expect("Create a migration plan").not.toMatch(AGENT_MODE_BUTTON_TEXT_PATTERN);
    expect("Create a migration plan").not.toMatch(VARIANT_BUTTON_TEXT_PATTERN);
  });

  it("matches agent mode labels with extra descriptors", () => {
    expect("🤖 Sisyphus (Ultraworker) Mode").toMatch(AGENT_MODE_BUTTON_TEXT_PATTERN);
    expect("🤖 Sisyphus (Ultraworker) Mode").not.toMatch(MODEL_BUTTON_TEXT_PATTERN);
  });
});
