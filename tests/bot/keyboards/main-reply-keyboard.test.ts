import { describe, expect, it } from "vitest";
import {
  createAgentKeyboard,
  createMainKeyboard,
  removeKeyboard,
} from "../../../src/bot/keyboards/main-reply-keyboard.js";

function getButtonText(button: string | { text: string }): string {
  return typeof button === "string" ? button : button.text;
}

describe("bot/keyboards/main-reply-keyboard", () => {
  it("creates main keyboard with defaults", () => {
    const keyboard = createMainKeyboard("build", {
      providerID: "openrouter",
      modelID: "openai/gpt-4o",
    });

    expect(getButtonText(keyboard.keyboard[0][0])).toBe("🛠️ Build Agent");
    expect(getButtonText(keyboard.keyboard[0][1])).toBe("📊 0");
    expect(getButtonText(keyboard.keyboard[1][0])).toBe("🧠 openrouter\nopenai/gpt-4o");
    expect(getButtonText(keyboard.keyboard[1][1])).toBe("💡 Default");
    expect(keyboard.resize_keyboard).toBe(true);
    expect(keyboard.is_persistent).toBe(true);
  });

  it("creates main keyboard with context info and custom variant", () => {
    const keyboard = createMainKeyboard(
      "plan",
      {
        providerID: "provider",
        modelID: "model",
      },
      {
        tokensUsed: 150000,
        tokensLimit: 1500000,
      },
      "⚡ Fast",
    );

    expect(getButtonText(keyboard.keyboard[0][0])).toBe("📋 Plan Agent");
    expect(getButtonText(keyboard.keyboard[0][1])).toBe("📊 150K / 1.5M (10%)");
    expect(getButtonText(keyboard.keyboard[1][1])).toBe("⚡ Fast");
  });

  it("creates custom agent keyboard and remove payload", () => {
    const keyboard = createAgentKeyboard("custom");
    const nonEmptyRows = keyboard.keyboard.filter((row) => row.length > 0);

    expect(nonEmptyRows).toEqual([[{ text: "🤖 Custom Agent" }]]);
    expect(keyboard.resize_keyboard).toBe(true);
    expect(keyboard.is_persistent).toBe(true);

    expect(removeKeyboard()).toEqual({ remove_keyboard: true });
  });
});
