import { describe, expect, it } from "#vitest";
import { loadSut } from "#helpers/sut-loader.js";
const { formatQueuedPromptButtonLabel } = await loadSut<typeof import("#src/bot/keyboards/queued-prompt-button.js")>(
  "#src/bot/keyboards/queued-prompt-button.ts",
  import.meta.url,
);
const { createMainKeyboard } = await loadSut<typeof import("#src/bot/keyboards/main-reply-keyboard.js")>(
  "#src/bot/keyboards/main-reply-keyboard.ts",
  import.meta.url,
);
const { AGENT_MODE_BUTTON_TEXT_PATTERN, CONTEXT_BUTTON_TEXT_PATTERN, isReplyKeyboardButtonText, MODEL_BUTTON_TEXT_PATTERN, QUEUED_PROMPT_BUTTON_TEXT_PATTERN, VARIANT_BUTTON_TEXT_PATTERN } = await loadSut<typeof import("#src/bot/message-patterns.js")>(
  "#src/bot/message-patterns.ts",
  import.meta.url,
);
import { defined } from "#helpers/defined.js";

function getButtonText(button: string | { text: string }): string {
  return typeof button === "string" ? button : button.text;
}

describe("bot/message-patterns", () => {
  it("matches model button text from main keyboard", () => {
    const keyboard = createMainKeyboard("build", {
      providerID: "openrouter",
      modelID: "openai/gpt-4o",
    });

    const modelButtonText = getButtonText(defined(keyboard.keyboard[1]?.[0]));
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

    const variantButtonText = getButtonText(defined(keyboard.keyboard[1]?.[1]));
    expect(variantButtonText).toMatch(VARIANT_BUTTON_TEXT_PATTERN);
    expect("💭 Default").toMatch(VARIANT_BUTTON_TEXT_PATTERN);
  });

  it("does not match plain prompt text", () => {
    expect("Create a migration plan").not.toMatch(MODEL_BUTTON_TEXT_PATTERN);
    expect("Create a migration plan").not.toMatch(AGENT_MODE_BUTTON_TEXT_PATTERN);
    expect("Create a migration plan").not.toMatch(VARIANT_BUTTON_TEXT_PATTERN);
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

  it("matches context button labels but not prompts that merely start with the emoji", () => {
    // Real reply-keyboard button renders (all locales render numbers only).
    expect("📊 150K / 1.5M (10%)").toMatch(CONTEXT_BUTTON_TEXT_PATTERN);
    expect("📊 0").toMatch(CONTEXT_BUTTON_TEXT_PATTERN);
    expect("📊 0 / 1.5M (0%)").toMatch(CONTEXT_BUTTON_TEXT_PATTERN);
    // User prompts that start with the emoji must NOT open the compact menu.
    expect("📊 hola").not.toMatch(CONTEXT_BUTTON_TEXT_PATTERN);
    expect("📊 Context: 150K / 1.5M (10%)").not.toMatch(CONTEXT_BUTTON_TEXT_PATTERN);
    expect("📊").not.toMatch(CONTEXT_BUTTON_TEXT_PATTERN);
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
    expect(isReplyKeyboardButtonText(getButtonText(defined(keyboard.keyboard[0]?.[1])))).toBe(true);
    expect(isReplyKeyboardButtonText(getButtonText(defined(keyboard.keyboard[1]?.[0])))).toBe(true);
    expect(isReplyKeyboardButtonText(getButtonText(defined(keyboard.keyboard[1]?.[1])))).toBe(true);
    expect(isReplyKeyboardButtonText(formatQueuedPromptButtonLabel(1, "queued"))).toBe(true);
    expect(isReplyKeyboardButtonText("Create a migration plan")).toBe(false);
  });
});
