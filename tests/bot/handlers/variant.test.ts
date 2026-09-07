import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  getStoredAgentMock: vi.fn(),
  resolveProjectAgentMock: vi.fn(),
  getStoredModelMock: vi.fn(),
  setCurrentVariantMock: vi.fn(),
  formatVariantForButtonMock: vi.fn(),
  formatVariantForDisplayMock: vi.fn(),
  ensureActiveInlineMenuMock: vi.fn(),
  clearActiveInlineMenuMock: vi.fn(),
  keyboardInitializeMock: vi.fn(),
  keyboardUpdateModelMock: vi.fn(),
  keyboardUpdateVariantMock: vi.fn(),
  keyboardUpdateAgentMock: vi.fn(),
  keyboardUpdateContextMock: vi.fn(),
  pinnedRefreshContextLimitMock: vi.fn(),
  pinnedGetContextInfoMock: vi.fn(),
  pinnedGetContextLimitMock: vi.fn(),
  pinnedRefreshMock: vi.fn(),
  createMainKeyboardMock: vi.fn(),
  switchedMock: vi.fn(),
  notifyMock: vi.fn(),
  failureMock: vi.fn(),
}));

vi.mock("../../../src/app/services/agent-selection-service.js", () => ({
  getStoredAgent: mocked.getStoredAgentMock,
  resolveProjectAgent: mocked.resolveProjectAgentMock,
}));

vi.mock("../../../src/app/services/model-selection-service.js", () => ({
  getStoredModel: mocked.getStoredModelMock,
}));

vi.mock("../../../src/app/services/variant-selection-service.js", () => ({
  setCurrentVariant: mocked.setCurrentVariantMock,
  formatVariantForButton: mocked.formatVariantForButtonMock,
  formatVariantForDisplay: mocked.formatVariantForDisplayMock,
}));

vi.mock("../../../src/bot/menus/inline-menu.js", () => ({
  ensureActiveInlineMenu: mocked.ensureActiveInlineMenuMock,
  clearActiveInlineMenu: mocked.clearActiveInlineMenuMock,
}));

vi.mock("../../../src/bot/keyboards/keyboard-manager.js", () => ({
  keyboardManager: {
    initialize: mocked.keyboardInitializeMock,
    updateModel: mocked.keyboardUpdateModelMock,
    updateVariant: mocked.keyboardUpdateVariantMock,
    updateAgent: mocked.keyboardUpdateAgentMock,
    updateContext: mocked.keyboardUpdateContextMock,
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
  notify: mocked.notifyMock,
  failure: mocked.failureMock,
}));

import { handleVariantSelect } from "../../../src/bot/callbacks/variant-selection-callback-handler.js";
import { t } from "../../../src/i18n/index.js";

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

describe("bot variant selection", () => {
  beforeEach(() => {
    mocked.getStoredAgentMock.mockReset();
    mocked.resolveProjectAgentMock.mockReset();
    mocked.getStoredModelMock.mockReset();
    mocked.setCurrentVariantMock.mockReset();
    mocked.formatVariantForButtonMock.mockReset();
    mocked.formatVariantForDisplayMock.mockReset();
    mocked.ensureActiveInlineMenuMock.mockReset();
    mocked.clearActiveInlineMenuMock.mockReset();
    mocked.keyboardInitializeMock.mockReset();
    mocked.keyboardUpdateModelMock.mockReset();
    mocked.keyboardUpdateVariantMock.mockReset();
    mocked.keyboardUpdateAgentMock.mockReset();
    mocked.keyboardUpdateContextMock.mockReset();
    mocked.pinnedRefreshContextLimitMock.mockReset();
    mocked.pinnedGetContextInfoMock.mockReset();
    mocked.pinnedGetContextLimitMock.mockReset();
    mocked.pinnedRefreshMock.mockReset();
    mocked.createMainKeyboardMock.mockReset();
    mocked.switchedMock.mockReset();
    mocked.notifyMock.mockReset();
    mocked.failureMock.mockReset();

    mocked.ensureActiveInlineMenuMock.mockResolvedValue(true);
    mocked.getStoredAgentMock.mockReturnValue("build");
    mocked.resolveProjectAgentMock.mockResolvedValue("build");
    mocked.getStoredModelMock.mockReturnValue({
      providerID: "opencode-go",
      modelID: "kimi",
      variant: "low",
    });
    mocked.formatVariantForButtonMock.mockReturnValue("💭 Low");
    mocked.formatVariantForDisplayMock.mockReturnValue("Low");
    mocked.pinnedGetContextLimitMock.mockReturnValue(0);
    mocked.pinnedGetContextInfoMock.mockReturnValue(null);
    mocked.createMainKeyboardMock.mockReturnValue({});
    mocked.switchedMock.mockResolvedValue(undefined);
    mocked.pinnedRefreshMock.mockResolvedValue(undefined);
    mocked.pinnedRefreshContextLimitMock.mockResolvedValue(undefined);
  });

  it("refreshes the pinned dashboard after a successful variant pick", async () => {
    const keyboard = { kind: "main" };
    mocked.createMainKeyboardMock.mockReturnValue(keyboard);

    const ctx = mockContext({
      callbackQuery: { data: "variant:low" },
    });

    const result = await handleVariantSelect(ctx);

    expect(result).toBe(true);
    expect(mocked.setCurrentVariantMock).toHaveBeenCalledWith("low");
    expect(mocked.switchedMock).toHaveBeenCalledWith(
      ctx,
      t("variant.changed_message", { name: "Low" }),
      keyboard,
    );
    expect(mocked.pinnedRefreshMock).toHaveBeenCalledOnce();
  });

  it("does not refresh the pin when no model is selected", async () => {
    mocked.getStoredModelMock.mockReturnValue({
      providerID: "",
      modelID: "",
    });

    const ctx = mockContext({
      callbackQuery: { data: "variant:low" },
    });

    const result = await handleVariantSelect(ctx);

    expect(result).toBe(true);
    expect(mocked.setCurrentVariantMock).not.toHaveBeenCalled();
    expect(mocked.pinnedRefreshMock).not.toHaveBeenCalled();
    expect(mocked.notifyMock).toHaveBeenCalled();
  });
});
