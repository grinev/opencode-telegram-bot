import { describe, expect, it } from "vitest";
import {
  createAgentKeyboard,
  createDmKeyboard,
  createMainKeyboard,
  removeKeyboard,
} from "../../../src/bot/utils/keyboard.js";

function getButtonText(button: string | { text: string }): string {
  return typeof button === "string" ? button : button.text;
}

describe("bot/utils/keyboard", () => {
  it("creates main keyboard with defaults", () => {
    const keyboard = createMainKeyboard("build", {
      providerID: "openrouter",
      modelID: "openai/gpt-4o",
    });

    expect(getButtonText(keyboard.keyboard[0][0])).toBe("📊 Controls");
    expect(getButtonText(keyboard.keyboard[0][1])).toBe("🛠️ Build Mode");
    expect(getButtonText(keyboard.keyboard[1][0])).toBe("🤖 openrouter\nopenai/gpt-4o");
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

    expect(getButtonText(keyboard.keyboard[0][0])).toBe("📊 150K / 1.5M (10%)");
    expect(getButtonText(keyboard.keyboard[0][1])).toBe("📋 Plan Mode");
    expect(getButtonText(keyboard.keyboard[1][1])).toBe("⚡ Fast");
  });

  it("creates custom agent keyboard and remove payload", () => {
    const keyboard = createAgentKeyboard("custom");
    const nonEmptyRows = keyboard.keyboard.filter((row) => row.length > 0);

    expect(nonEmptyRows).toEqual([[{ text: "🤖 Custom Mode" }]]);
    expect(keyboard.resize_keyboard).toBe(true);
    expect(keyboard.is_persistent).toBe(true);

    expect(removeKeyboard()).toEqual({ remove_keyboard: true });
  });

  it("creates DM keyboard with utility commands", () => {
    const keyboard = createDmKeyboard();

    expect(getButtonText(keyboard.keyboard[0][0])).toBe("/status");
    expect(getButtonText(keyboard.keyboard[0][1])).toBe("/help");
    expect(getButtonText(keyboard.keyboard[1][0])).toBe("/opencode_start");
    expect(getButtonText(keyboard.keyboard[1][1])).toBe("/opencode_stop");
    expect(keyboard.resize_keyboard).toBe(true);
    expect(keyboard.is_persistent).toBe(true);
  });
});
