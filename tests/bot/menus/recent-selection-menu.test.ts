import { describe, expect, it } from "vitest";
import { buildRecentMenu } from "../../../src/bot/menus/recent-selection-menu.js";
import type { RecentSession } from "../../../src/app/services/recent-sessions-service.js";

const row = (id: string, directory: string, status: RecentSession["status"]): RecentSession => ({
  session: { id, directory, title: "A".repeat(100) } as RecentSession["session"], status,
});

describe("recent session buttons", () => {
  it("disambiguates duplicate folder names and bounds titles and callbacks", () => {
    const { keyboard, text } = buildRecentMenu([
      row("x".repeat(100), "/alpha/shared", "running"),
      row("y".repeat(100), "/beta/shared", "question"),
      row("z", "/third", "permission"),
      row("i", "/idle", "idle"),
    ]);
    const buttons = keyboard.inline_keyboard.flat();
    expect(buttons[0]?.text).toContain("⏳ [alpha/shared]");
    expect(buttons[1]?.text).toContain("❓ [beta/shared]");
    expect(buttons[2]?.text).toContain("🔐 [third]");
    expect(buttons[3]?.text).toContain("○ [idle]");
    expect(buttons.every((button) => [...button.text].length <= 64)).toBe(true);
    expect(buttons.map((button) => "callback_data" in button ? button.callback_data : null)).toEqual(["recent:0", "recent:1", "recent:2", "recent:3"]);
    expect(text).toContain("⏳");
    expect(text).toContain("🔐");
  });

  it("keeps the differing parent segment visible when project paths are long", () => {
    const { keyboard } = buildRecentMenu([
      row("a", "/work/very-long-common-prefix-northern-folder/shared-repository-with-a-long-name", "idle"),
      row("b", "/work/very-long-common-prefix-southern-folder/shared-repository-with-a-long-name", "idle"),
    ]);
    const labels = keyboard.inline_keyboard.flat().map((button) => button.text);
    expect(labels[0]).toContain("northern");
    expect(labels[1]).toContain("southern");
    expect(labels.every((label) => [...label].length <= 64)).toBe(true);
  });

  it("retains the difference inside a long parent segment", () => {
    const prefix = "/work/aaaaa";
    const suffix = `${"b".repeat(40)}/shared`;
    const { keyboard } = buildRecentMenu([
      row("a", `${prefix}NORTH${suffix}`, "idle"),
      row("b", `${prefix}SOUTH${suffix}`, "idle"),
    ]);
    const labels = keyboard.inline_keyboard.flat().map((button) => button.text);
    expect(labels[0]).toContain("NORTH");
    expect(labels[1]).toContain("SOUTH");
    expect(labels.every((label) => [...label].length <= 64)).toBe(true);
  });

  it("distinguishes three paths sharing an early difference but diverging again later", () => {
    const base = "/work/aaaaa";
    const tail = `${"b".repeat(40)}/shared`;
    const { keyboard } = buildRecentMenu([
      row("a", `${base}NORTH${tail}`, "idle"),
      row("b", `${base}SOUTH${"b".repeat(20)}WEST${"b".repeat(20)}/shared`, "idle"),
      row("c", `${base}SOUTH${"b".repeat(20)}EAST${"b".repeat(20)}/shared`, "idle"),
    ]);
    const labels = keyboard.inline_keyboard.flat().map((button) => button.text);
    expect(new Set(labels).size).toBe(3);
    expect(labels.every((label) => [...label].length <= 64)).toBe(true);
  });
});
