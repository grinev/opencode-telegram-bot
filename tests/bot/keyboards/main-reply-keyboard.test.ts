import { describe, expect, it } from "vitest";
import {
  createAgentKeyboard,
  createMainKeyboard,
  removeKeyboard,
} from "../../../src/bot/keyboards/main-reply-keyboard.js";
import { defined } from "../../helpers/defined.js";

function getButtonText(button: string | { text: string }): string {
  return typeof button === "string" ? button : button.text;
}

function buttonTextAt(
  keyboard: ReturnType<typeof createMainKeyboard>,
  row: number,
  col: number,
): string {
  return getButtonText(defined(keyboard.keyboard[row]?.[col], `button[${row}][${col}]`));
}

describe("bot/keyboards/main-reply-keyboard", () => {
  it("creates main keyboard with defaults", () => {
    const keyboard = createMainKeyboard("build", {
      providerID: "openrouter",
      modelID: "openai/gpt-4o",
    });

    expect(buttonTextAt(keyboard, 0, 0)).toBe("🛠️ Build Agent");
    expect(buttonTextAt(keyboard, 0, 1)).toBe("📊 0");
    expect(buttonTextAt(keyboard, 1, 0)).toBe("🧠 openrouter\nopenai/gpt-4o");
    expect(buttonTextAt(keyboard, 1, 1)).toBe("💡 Default");
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

    expect(buttonTextAt(keyboard, 0, 0)).toBe("📋 Plan Agent");
    expect(buttonTextAt(keyboard, 0, 1)).toBe("📊 150K / 1.5M (10%)");
    expect(buttonTextAt(keyboard, 1, 1)).toBe("⚡ Fast");
  });

  it("keeps the fixed 2x2 grid when no prompt is queued", () => {
    const keyboard = createMainKeyboard(
      "build",
      { providerID: "openrouter", modelID: "openai/gpt-4o" },
      undefined,
      undefined,
      [],
    );

    expect(keyboard.keyboard.filter((row) => row.length > 0)).toHaveLength(2);
  });

  it("puts queued prompt rows above the fixed grid", () => {
    const keyboard = createMainKeyboard(
      "build",
      { providerID: "openrouter", modelID: "openai/gpt-4o" },
      undefined,
      undefined,
      ["❌ 1. first", "❌ 2. second"],
    );

    expect(buttonTextAt(keyboard, 0, 0)).toBe("❌ 1. first");
    expect(buttonTextAt(keyboard, 1, 0)).toBe("❌ 2. second");
    expect(buttonTextAt(keyboard, 2, 0)).toBe("🛠️ Build Agent");
    expect(buttonTextAt(keyboard, 2, 1)).toBe("📊 0");
    expect(buttonTextAt(keyboard, 3, 0)).toBe("🧠 openrouter\nopenai/gpt-4o");
    expect(buttonTextAt(keyboard, 3, 1)).toBe("💡 Default");
  });

  it("places the two goal buttons below waiting messages and above the fixed grid", () => {
    const keyboard = createMainKeyboard("build", { providerID: "p", modelID: "m" }, undefined, undefined,
      ["queued 1", "queued 2"], ["goal objective", "pause"]);
    expect(keyboard.keyboard[2]).toEqual([{ text: "goal objective" }, { text: "pause" }]);
    expect(buttonTextAt(keyboard, 0, 0)).toBe("queued 1");
    expect(buttonTextAt(keyboard, 3, 0)).toBe("🛠️ Build Agent");
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
