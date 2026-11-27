import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAgentKeyboard,
  createMainKeyboard,
  removeKeyboard,
} from "../../../src/bot/keyboards/main-reply-keyboard.js";
import { defined } from "../../helpers/defined.js";
import { KeyboardManager } from "../../../src/bot/keyboards/keyboard-manager.js";
import type { Api } from "grammy";

const selection = vi.hoisted(() => ({ project: vi.fn(), session: vi.fn() }));
vi.mock("../../../src/app/stores/settings-store.js", () => ({
  getCurrentProject: selection.project,
  getCurrentSession: selection.session,
  getCurrentAgent: () => "build",
  getCurrentModel: () => ({ providerID: "p", modelID: "m" }),
}));

beforeEach(() => vi.resetAllMocks());

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

    expect(keyboard.keyboard[0]).toEqual([{ text: "📋 No project · No session" }]);
    expect(buttonTextAt(keyboard, 1, 0)).toBe("🛠️ Build Agent");
    expect(buttonTextAt(keyboard, 1, 1)).toBe("📊 0");
    expect(buttonTextAt(keyboard, 2, 0)).toBe("🧠 openrouter\nopenai/gpt-4o");
    expect(buttonTextAt(keyboard, 2, 1)).toBe("💡 Default");
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

    expect(buttonTextAt(keyboard, 1, 0)).toBe("📋 Plan Agent");
    expect(buttonTextAt(keyboard, 1, 1)).toBe("📊 150K / 1.5M (10%)");
    expect(buttonTextAt(keyboard, 2, 1)).toBe("⚡ Fast");
  });

  it("keeps the fixed 2x2 grid below the dashboard when no prompt is queued", () => {
    const keyboard = createMainKeyboard(
      "build",
      { providerID: "openrouter", modelID: "openai/gpt-4o" },
      undefined,
      undefined,
      [],
    );

    expect(keyboard.keyboard.filter((row) => row.length > 0).map((row) => row.length)).toEqual([1, 2, 2]);
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
    expect(buttonTextAt(keyboard, 2, 0)).toBe("📋 No project · No session");
    expect(buttonTextAt(keyboard, 3, 0)).toBe("🛠️ Build Agent");
    expect(buttonTextAt(keyboard, 3, 1)).toBe("📊 0");
    expect(buttonTextAt(keyboard, 4, 0)).toBe("🧠 openrouter\nopenai/gpt-4o");
    expect(buttonTextAt(keyboard, 4, 1)).toBe("💡 Default");
  });

  it("places the two goal buttons below waiting messages and above the fixed grid", () => {
    const keyboard = createMainKeyboard("build", { providerID: "p", modelID: "m" }, undefined, undefined,
      ["queued 1", "queued 2"], ["goal objective", "pause"]);
    expect(keyboard.keyboard[2]).toEqual([{ text: "goal objective" }, { text: "pause" }]);
    expect(buttonTextAt(keyboard, 0, 0)).toBe("queued 1");
    expect(buttonTextAt(keyboard, 3, 0)).toBe("📋 No project · No session");
    expect(buttonTextAt(keyboard, 4, 0)).toBe("🛠️ Build Agent");
  });

  it("shortens project and session independently without splitting an emoji", () => {
    const worktree = `D:\\projects\\${"🚀".repeat(20)}`;
    selection.project.mockReturnValue({ id: "project", worktree, name: worktree });
    selection.session.mockReturnValue({ id: "session", directory: worktree, title: `${"🧪".repeat(20)}\nline two` });
    const keyboard = createMainKeyboard("build", { providerID: "p", modelID: "m" });
    expect(buttonTextAt(keyboard, 0, 0)).toBe(`📋 ${"🚀".repeat(17)}… · ${"🧪".repeat(17)}…`);
  });

  it("distinguishes a detached selection from an unnamed session", () => {
    const project = { id: "project", worktree: "/projects/demo" };
    selection.project.mockReturnValue(project);
    const keyboard = () => createMainKeyboard("build", { providerID: "p", modelID: "m" });
    expect(buttonTextAt(keyboard(), 0, 0)).toBe("📋 demo · No session");
    selection.session.mockReturnValue({ id: "session", directory: project.worktree, title: "" });
    expect(buttonTextAt(keyboard(), 0, 0)).toBe("📋 demo · New session");
  });

  it("coalesces title corrections without debouncing an explicit keyboard update", async () => {
    vi.useFakeTimers();
    try {
      const manager = new KeyboardManager();
      const sendMessage = vi.fn().mockResolvedValue({ message_id: 1 });
      manager.initialize({ sendMessage } as unknown as Api, 42);
      selection.project.mockReturnValue({ id: "project", worktree: "/repo" });
      selection.session.mockReturnValue({ id: "session", directory: "/repo", title: "First" });
      manager.scheduleDashboardTitleUpdate(42);
      selection.session.mockReturnValue({ id: "session", directory: "/repo", title: "Latest" });
      manager.scheduleDashboardTitleUpdate(42);
      await vi.advanceTimersByTimeAsync(1000);

      expect(sendMessage).toHaveBeenCalledExactlyOnceWith(42, "⌨️ Keyboard updated", {
        reply_markup: expect.objectContaining({
          keyboard: expect.arrayContaining([[{ text: "📋 repo · Latest" }]]),
        }),
      });
      manager.scheduleDashboardTitleUpdate(42);
      await manager.sendKeyboardUpdate(42);
      expect(sendMessage).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1000);
      expect(sendMessage).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
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
