import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  getAvailableAgentsMock: vi.fn(),
}));

vi.mock("../../../src/app/services/agent-selection-service.js", () => ({
  fetchCurrentAgent: vi.fn(),
  getAvailableAgents: mocked.getAvailableAgentsMock,
  selectAgent: vi.fn(),
}));

import { buildAgentSelectionMenu } from "../../../src/bot/menus/agent-selection-menu.js";

describe("bot agent selection", () => {
  beforeEach(() => {
    mocked.getAvailableAgentsMock.mockReset();
  });

  it("highlights the selected agent without uppercasing its name", async () => {
    mocked.getAvailableAgentsMock.mockResolvedValueOnce([
      { name: "reviewer", mode: "primary" },
      { name: "build", mode: "primary" },
    ]);

    const keyboard = await buildAgentSelectionMenu("reviewer");

    expect(keyboard.inline_keyboard[0]?.[0]?.text).toBe("✅ 🤖 Reviewer");
    expect(keyboard.inline_keyboard[1]?.[0]?.text).toBe("🛠️ Build");
  });
});
