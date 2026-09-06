import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  getAvailableAgentsMock: vi.fn(),
  selectAgentMock: vi.fn(),
  applyAgentConfiguredSettingsMock: vi.fn(),
  getStoredModelMock: vi.fn(),
  ensureActiveInlineMenuMock: vi.fn(),
  clearActiveInlineMenuMock: vi.fn(),
  keyboardInitializeMock: vi.fn(),
  keyboardUpdateAgentMock: vi.fn(),
  keyboardUpdateModelMock: vi.fn(),
  keyboardUpdateContextMock: vi.fn(),
  keyboardGetStateMock: vi.fn(),
  pinnedRefreshContextLimitMock: vi.fn(),
  pinnedGetContextInfoMock: vi.fn(),
  pinnedGetContextLimitMock: vi.fn(),
  pinnedRefreshMock: vi.fn(),
  createMainKeyboardMock: vi.fn(),
  switchedMock: vi.fn(),
  showVariantMenuAfterModelChangeMock: vi.fn(),
}));

vi.mock("../../../src/app/services/agent-selection-service.js", () => ({
  fetchCurrentAgent: vi.fn(),
  getAvailableAgents: mocked.getAvailableAgentsMock,
  selectAgent: mocked.selectAgentMock,
  applyAgentConfiguredSettings: mocked.applyAgentConfiguredSettingsMock,
}));

vi.mock("../../../src/app/services/model-selection-service.js", () => ({
  getStoredModel: mocked.getStoredModelMock,
}));

vi.mock("../../../src/bot/menus/inline-menu.js", () => ({
  ensureActiveInlineMenu: mocked.ensureActiveInlineMenuMock,
  clearActiveInlineMenu: mocked.clearActiveInlineMenuMock,
}));

vi.mock("../../../src/bot/keyboards/keyboard-manager.js", () => ({
  keyboardManager: {
    initialize: mocked.keyboardInitializeMock,
    updateAgent: mocked.keyboardUpdateAgentMock,
    updateModel: mocked.keyboardUpdateModelMock,
    updateContext: mocked.keyboardUpdateContextMock,
    getState: mocked.keyboardGetStateMock,
  },
}));

vi.mock("../../../src/bot/keyboards/main-reply-keyboard.js", () => ({
  createMainKeyboard: mocked.createMainKeyboardMock,
}));

vi.mock("../../../src/bot/pinned/pinned-message-manager.js", () => ({
  pinnedMessageManager: {
    refreshContextLimit: mocked.pinnedRefreshContextLimitMock,
    getContextInfo: mocked.pinnedGetContextInfoMock,
    getContextLimit: mocked.pinnedGetContextLimitMock,
    refresh: mocked.pinnedRefreshMock,
  },
}));

vi.mock("../../../src/bot/callbacks/feedback.js", () => ({
  switched: mocked.switchedMock,
  failure: vi.fn(),
}));

vi.mock("../../../src/bot/menus/variant-selection-menu.js", () => ({
  showVariantSelectionMenuAfterModelChange: mocked.showVariantMenuAfterModelChangeMock,
}));

import { buildAgentSelectionMenu } from "../../../src/bot/menus/agent-selection-menu.js";
import { handleAgentSelect } from "../../../src/bot/callbacks/agent-selection-callback-handler.js";
import { t } from "../../../src/i18n/index.js";
import { getAgentDisplayName } from "../../../src/app/types/agent.js";

function mockContext(overrides: Record<string, unknown> = {}) {
  return {
    callbackQuery: undefined,
    message: undefined,
    chat: { id: 123 },
    api: {},
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue({ message_id: 999 }),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as import("grammy").Context;
}

describe("bot agent selection", () => {
  beforeEach(() => {
    mocked.getAvailableAgentsMock.mockReset();
    mocked.selectAgentMock.mockReset();
    mocked.applyAgentConfiguredSettingsMock.mockReset();
    mocked.getStoredModelMock.mockReset();
    mocked.ensureActiveInlineMenuMock.mockReset();
    mocked.clearActiveInlineMenuMock.mockReset();
    mocked.keyboardInitializeMock.mockReset();
    mocked.keyboardUpdateAgentMock.mockReset();
    mocked.keyboardUpdateModelMock.mockReset();
    mocked.keyboardUpdateContextMock.mockReset();
    mocked.keyboardGetStateMock.mockReset();
    mocked.pinnedRefreshContextLimitMock.mockReset();
    mocked.pinnedGetContextInfoMock.mockReset();
    mocked.pinnedGetContextLimitMock.mockReset();
    mocked.pinnedRefreshMock.mockReset();
    mocked.createMainKeyboardMock.mockReset();
    mocked.switchedMock.mockReset();
    mocked.showVariantMenuAfterModelChangeMock.mockReset();

    mocked.ensureActiveInlineMenuMock.mockResolvedValue(true);
    mocked.applyAgentConfiguredSettingsMock.mockResolvedValue(false);
    mocked.getStoredModelMock.mockReturnValue({
      providerID: "opencode-go",
      modelID: "kimi",
      variant: "high",
    });
    mocked.pinnedGetContextLimitMock.mockReturnValue(0);
    mocked.pinnedGetContextInfoMock.mockReturnValue(null);
    mocked.keyboardGetStateMock.mockReturnValue({ variantName: "💡 High" });
    mocked.createMainKeyboardMock.mockReturnValue({});
    mocked.switchedMock.mockResolvedValue(undefined);
    mocked.pinnedRefreshMock.mockResolvedValue(undefined);
    mocked.pinnedRefreshContextLimitMock.mockResolvedValue(undefined);
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

  it("applies configured settings, confirms with the existing line, and does not open the variant menu", async () => {
    mocked.applyAgentConfiguredSettingsMock.mockResolvedValueOnce(true);
    const keyboard = { kind: "main" };
    mocked.createMainKeyboardMock.mockReturnValue(keyboard);

    const ctx = mockContext({
      callbackQuery: { data: "agent:plan" },
    });

    const result = await handleAgentSelect(ctx);

    expect(result).toBe(true);
    expect(mocked.selectAgentMock).toHaveBeenCalledWith("plan");
    expect(mocked.applyAgentConfiguredSettingsMock).toHaveBeenCalledWith("plan");
    expect(mocked.createMainKeyboardMock).toHaveBeenCalledWith(
      "plan",
      { providerID: "opencode-go", modelID: "kimi", variant: "high" },
      undefined,
      "💡 High",
    );
    expect(mocked.switchedMock).toHaveBeenCalledWith(
      ctx,
      t("agent.changed_message", { name: getAgentDisplayName("plan") }),
      keyboard,
    );
    expect(mocked.pinnedRefreshMock).toHaveBeenCalledOnce();
    expect(mocked.showVariantMenuAfterModelChangeMock).not.toHaveBeenCalled();
  });

  it("does not refresh the pinned dashboard when no model was applied", async () => {
    const ctx = mockContext({
      callbackQuery: { data: "agent:plan" },
    });

    await handleAgentSelect(ctx);

    expect(mocked.pinnedRefreshMock).not.toHaveBeenCalled();
    expect(mocked.showVariantMenuAfterModelChangeMock).not.toHaveBeenCalled();
  });
});
