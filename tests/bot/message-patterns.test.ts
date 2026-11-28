import { describe, expect, it } from "vitest";
import { defined } from "../helpers/defined.js";
import { createMainKeyboard } from "../../src/bot/keyboards/main-reply-keyboard.js";
import {
  AGENT_MODE_BUTTON_TEXT_PATTERN,
  DASHBOARD_BUTTON_TEXT_PATTERN,
  isReplyKeyboardButtonText,
  MODEL_BUTTON_TEXT_PATTERN,
  QUEUED_PROMPT_BUTTON_TEXT_PATTERN,
  VARIANT_BUTTON_TEXT_PATTERN,
} from "../../src/bot/message-patterns.js";
import { formatQueuedPromptButtonLabel } from "../../src/bot/keyboards/queued-prompt-button.js";

function getButtonText(button: string | { text: string }): string {
  return typeof button === "string" ? button : button.text;
}

describe("bot/message-patterns", () => {
  it("matches model button text from main keyboard", () => {
    const keyboard = createMainKeyboard("build", {
      providerID: "openrouter",
      modelID: "openai/gpt-4o",
    });

    const modelButtonText = getButtonText(defined(keyboard.keyboard[2]?.[0]));
    expect(modelButtonText).toMatch(MODEL_BUTTON_TEXT_PATTERN);
  });

  it("matches single-line model button text", () => {
    expect("🧠 cliproxyapi2/gpt-5.3-codex").toMatch(MODEL_BUTTON_TEXT_PATTERN);
  });

  it("does not treat custom agent labels as model buttons", () => {
    expect("🤖 Reviewer Agent").not.toMatch(MODEL_BUTTON_TEXT_PATTERN);
  });

  it("matches current and legacy variant button prefixes", () => {
    const keyboard = createMainKeyboard("build", {
      providerID: "openrouter",
      modelID: "openai/gpt-4o",
    });

    const variantButtonText = getButtonText(defined(keyboard.keyboard[2]?.[1]));
    expect(variantButtonText).toMatch(VARIANT_BUTTON_TEXT_PATTERN);
    expect("💭 Default").toMatch(VARIANT_BUTTON_TEXT_PATTERN);
  });

  it("does not match plain prompt text", () => {
    expect("Create a migration plan").not.toMatch(MODEL_BUTTON_TEXT_PATTERN);
    expect("Create a migration plan").not.toMatch(AGENT_MODE_BUTTON_TEXT_PATTERN);
    expect("Create a migration plan").not.toMatch(VARIANT_BUTTON_TEXT_PATTERN);
  });

  it("recognises the bracketed dashboard label but not the unreleased format", () => {
    expect("📋 [project…] Session").toMatch(DASHBOARD_BUTTON_TEXT_PATTERN);
    expect("📋 project · Session").not.toMatch(DASHBOARD_BUTTON_TEXT_PATTERN);
  });

  it("matches current and legacy agent button labels with extra descriptors", () => {
    expect("🤖 Sisyphus (Ultraworker) Agent").toMatch(AGENT_MODE_BUTTON_TEXT_PATTERN);
    expect("🤖 Sisyphus (Ultraworker) Mode").toMatch(AGENT_MODE_BUTTON_TEXT_PATTERN);
    expect("🤖 Sisyphus (Ultraworker) Agent").not.toMatch(MODEL_BUTTON_TEXT_PATTERN);
  });

  it("matches queued prompt button labels", () => {
    expect(formatQueuedPromptButtonLabel(1, "Fix the bug")).toMatch(
      QUEUED_PROMPT_BUTTON_TEXT_PATTERN,
    );
    expect(formatQueuedPromptButtonLabel(12, "Fix the bug")).toMatch(
      QUEUED_PROMPT_BUTTON_TEXT_PATTERN,
    );
  });

  it("does not treat other button labels or prompts as queued prompts", () => {
    expect("🧠 openrouter\nopenai/gpt-4o").not.toMatch(QUEUED_PROMPT_BUTTON_TEXT_PATTERN);
    expect("🛠️ Build Agent").not.toMatch(QUEUED_PROMPT_BUTTON_TEXT_PATTERN);
    expect("💡 Default").not.toMatch(QUEUED_PROMPT_BUTTON_TEXT_PATTERN);
    expect("📊 150K / 1.5M (10%)").not.toMatch(QUEUED_PROMPT_BUTTON_TEXT_PATTERN);
    expect("Create a migration plan").not.toMatch(QUEUED_PROMPT_BUTTON_TEXT_PATTERN);
    expect("❌ do not do that").not.toMatch(QUEUED_PROMPT_BUTTON_TEXT_PATTERN);
  });

  it("recognises every reply keyboard button label", () => {
    const keyboard = createMainKeyboard(
      "build",
      { providerID: "openrouter", modelID: "openai/gpt-4o" },
      { tokensUsed: 150000, tokensLimit: 1500000 },
    );

    expect(isReplyKeyboardButtonText(getButtonText(defined(keyboard.keyboard[0]?.[0])))).toBe(true);
    expect(isReplyKeyboardButtonText(getButtonText(defined(keyboard.keyboard[1]?.[0])))).toBe(true);
    expect(isReplyKeyboardButtonText(getButtonText(defined(keyboard.keyboard[1]?.[1])))).toBe(true);
    expect(isReplyKeyboardButtonText(getButtonText(defined(keyboard.keyboard[2]?.[0])))).toBe(true);
    expect(isReplyKeyboardButtonText(getButtonText(defined(keyboard.keyboard[2]?.[1])))).toBe(true);
    expect(isReplyKeyboardButtonText(formatQueuedPromptButtonLabel(1, "queued"))).toBe(true);
    expect(isReplyKeyboardButtonText("Create a migration plan")).toBe(false);
  });
});
