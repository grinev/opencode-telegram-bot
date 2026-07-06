import { beforeEach, describe, expect, it, vi } from "vitest";
import { InlineKeyboard } from "grammy";

const mocked = vi.hoisted(() => ({
  getModelSelectionListsMock: vi.fn(),
  searchModelsMock: vi.fn(),
  interactionManagerGetSnapshotMock: vi.fn(),
  interactionManagerStartMock: vi.fn(),
  interactionManagerTransitionMock: vi.fn(),
  interactionManagerClearMock: vi.fn(),
  ensureActiveInlineMenuMock: vi.fn(),
  selectModelMock: vi.fn(),
  resolveProjectAgentMock: vi.fn(),
  keyboardInitializeMock: vi.fn(),
  keyboardUpdateModelMock: vi.fn(),
  keyboardUpdateAgentMock: vi.fn(),
  keyboardUpdateContextMock: vi.fn(),
  pinnedRefreshContextLimitMock: vi.fn(),
  pinnedGetContextInfoMock: vi.fn(),
  pinnedGetContextLimitMock: vi.fn(),
  createMainKeyboardMock: vi.fn(),
}));

vi.mock("../../../src/app/services/model-selection-service.js", () => ({
  getModelSelectionLists: mocked.getModelSelectionListsMock,
  searchModels: mocked.searchModelsMock,
  selectModel: mocked.selectModelMock,
  fetchCurrentModel: vi.fn(),
}));

vi.mock("../../../src/app/services/agent-selection-service.js", () => ({
  getStoredAgent: vi.fn(() => "build"),
  resolveProjectAgent: mocked.resolveProjectAgentMock,
}));

vi.mock("../../../src/bot/keyboards/keyboard-manager.js", () => ({
  keyboardManager: {
    initialize: mocked.keyboardInitializeMock,
    updateModel: mocked.keyboardUpdateModelMock,
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
  },
}));

vi.mock("../../../src/app/managers/interaction-manager.js", () => ({
  interactionManager: {
    getSnapshot: mocked.interactionManagerGetSnapshotMock,
    start: mocked.interactionManagerStartMock,
    transition: mocked.interactionManagerTransitionMock,
    clear: mocked.interactionManagerClearMock,
  },
}));

vi.mock("../../../src/bot/menus/inline-menu.js", () => ({
  ensureActiveInlineMenu: mocked.ensureActiveInlineMenuMock,
  clearActiveInlineMenu: vi.fn(),
  replyWithInlineMenu: vi.fn(),
}));

import { buildModelSelectionMenu } from "../../../src/bot/menus/model-selection-menu.js";

import {
  handleModelSelect,
  handleModelSearchCallback,
  handleModelSearchTextInput,
  handleModelSearchResults,
} from "../../../src/bot/callbacks/model-selection-callback-handler.js";

function mockContext(overrides: Record<string, unknown> = {}) {
  return {
    callbackQuery: undefined,
    message: undefined,
    chat: { id: 123 },
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue({ message_id: 999 }),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as import("grammy").Context;
}

describe("bot model selection", () => {
  beforeEach(() => {
    mocked.getModelSelectionListsMock.mockReset();
    mocked.searchModelsMock.mockReset();
    mocked.interactionManagerGetSnapshotMock.mockReset();
    mocked.interactionManagerStartMock.mockReset();
    mocked.interactionManagerTransitionMock.mockReset();
    mocked.interactionManagerClearMock.mockReset();
    mocked.ensureActiveInlineMenuMock.mockReset();
    mocked.ensureActiveInlineMenuMock.mockResolvedValue(true);
    mocked.selectModelMock.mockReset();
    mocked.resolveProjectAgentMock.mockReset().mockResolvedValue("build");
    mocked.keyboardInitializeMock.mockReset();
    mocked.keyboardUpdateModelMock.mockReset();
    mocked.keyboardUpdateAgentMock.mockReset();
    mocked.keyboardUpdateContextMock.mockReset();
    mocked.pinnedRefreshContextLimitMock.mockReset().mockResolvedValue(undefined);
    mocked.pinnedGetContextInfoMock.mockReset().mockReturnValue(null);
    mocked.pinnedGetContextLimitMock.mockReset().mockReturnValue(0);
    mocked.createMainKeyboardMock.mockReset().mockReturnValue({ keyboard: [["main"]] });
  });

  describe("buildModelSelectionMenu", () => {
    it("includes search button as the first row", async () => {
      mocked.getModelSelectionListsMock.mockResolvedValue({
        favorites: [{ providerID: "openai", modelID: "gpt-4o" }],
        recent: [{ providerID: "google", modelID: "gemini-pro" }],
      });

      const keyboard = await buildModelSelectionMenu();

      expect(keyboard).toBeInstanceOf(InlineKeyboard);
      const rows = keyboard.inline_keyboard;
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0][0].text).toBe("🔍 Search");
      expect(rows[0][0].callback_data).toBe("model:search");
    });

    it("still returns keyboard with search button when no favorites or recent", async () => {
      mocked.getModelSelectionListsMock.mockResolvedValue({
        favorites: [],
        recent: [],
      });

      const keyboard = await buildModelSelectionMenu();

      // Keyboard always has at least the search button row
      expect(keyboard.inline_keyboard.length).toBeGreaterThanOrEqual(1);
      expect(keyboard.inline_keyboard[0][0].text).toBe("🔍 Search");
      expect(keyboard.inline_keyboard[0][0].callback_data).toBe("model:search");
    });

    it("uses short callback data for long model IDs", async () => {
      const longModelID = "accounts/hubabuba3227-1hvtqlh/deployments/kpwpvuky";
      mocked.getModelSelectionListsMock.mockResolvedValue({
        favorites: [],
        recent: [{ providerID: "fireworks", modelID: longModelID }],
      });

      const keyboard = await buildModelSelectionMenu();
      const callbackData = keyboard.inline_keyboard[1][0].callback_data;

      expect(callbackData).toBe("model:list:recent:0");
      expect(Buffer.byteLength(callbackData ?? "", "utf-8")).toBeLessThanOrEqual(64);
      expect(callbackData).not.toContain(longModelID);
    });
  });

  describe("handleModelSelect", () => {
    it("resolves short list callback data to the original long model ID", async () => {
      const longModelID = "accounts/hubabuba3227-1hvtqlh/deployments/kpwpvuky";
      mocked.getModelSelectionListsMock.mockResolvedValue({
        favorites: [],
        recent: [{ providerID: "fireworks", modelID: longModelID }],
      });

      const ctx = mockContext({
        callbackQuery: {
          data: "model:list:recent:0",
          message: { message_id: 999 },
        },
        api: {},
      });

      const result = await handleModelSelect(ctx);

      expect(result).toBe(true);
      expect(mocked.selectModelMock).toHaveBeenCalledWith({
        providerID: "fireworks",
        modelID: longModelID,
        variant: "default",
      });
    });
  });

  describe("handleModelSearchCallback", () => {
    it("returns false when callback data does not match", async () => {
      const ctx = mockContext({
        callbackQuery: { data: "model:openai:gpt-4o" },
      });

      const result = await handleModelSearchCallback(ctx);

      expect(result).toBe(false);
    });

    it("returns false when no callback data", async () => {
      const ctx = mockContext({ callbackQuery: undefined });

      const result = await handleModelSearchCallback(ctx);

      expect(result).toBe(false);
    });
  });

  describe("handleModelSearchTextInput", () => {
    it("returns false when no model-search interaction is active", async () => {
      mocked.interactionManagerGetSnapshotMock.mockReturnValue(null);

      const ctx = mockContext({
        message: { text: "gpt" },
      });

      const result = await handleModelSearchTextInput(ctx);

      expect(result).toBe(false);
    });

    it("returns false when interaction is not model-search", async () => {
      mocked.interactionManagerGetSnapshotMock.mockReturnValue({
        kind: "custom",
        metadata: { flow: "other-flow", stage: "input" },
      });

      const ctx = mockContext({
        message: { text: "gpt" },
      });

      const result = await handleModelSearchTextInput(ctx);

      expect(result).toBe(false);
    });

    it("returns false when stage is not input", async () => {
      mocked.interactionManagerGetSnapshotMock.mockReturnValue({
        kind: "custom",
        metadata: { flow: "model-search", stage: "results" },
      });

      const ctx = mockContext({
        message: { text: "gpt" },
      });

      const result = await handleModelSearchTextInput(ctx);

      expect(result).toBe(false);
    });

    it("returns false when no message text", async () => {
      mocked.interactionManagerGetSnapshotMock.mockReturnValue({
        kind: "custom",
        metadata: { flow: "model-search", stage: "input" },
      });

      const ctx = mockContext({
        message: { text: undefined },
      });

      const result = await handleModelSearchTextInput(ctx);

      expect(result).toBe(false);
    });

    it("uses short callback data for long model IDs in search results", async () => {
      const longModelID = "accounts/hubabuba3227-1hvtqlh/deployments/kpwpvuky";
      mocked.interactionManagerGetSnapshotMock.mockReturnValue({
        kind: "custom",
        metadata: { flow: "model-search", stage: "input" },
      });
      mocked.searchModelsMock.mockResolvedValue([
        { providerID: "fireworks", modelID: longModelID },
      ]);

      const ctx = mockContext({
        message: { text: "fireworks" },
      });

      const result = await handleModelSearchTextInput(ctx);
      const replyOptions = vi.mocked(ctx.reply).mock.calls[0][1] as {
        reply_markup: { inline_keyboard: Array<Array<{ callback_data?: string }>> };
      };
      const callbackData = replyOptions.reply_markup.inline_keyboard[0][0].callback_data;

      expect(result).toBe(true);
      expect(callbackData).toBe("model:result:0");
      expect(Buffer.byteLength(callbackData ?? "", "utf-8")).toBeLessThanOrEqual(64);
      expect(callbackData).not.toContain(longModelID);
      expect(mocked.interactionManagerTransitionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            models: [{ providerID: "fireworks", modelID: longModelID, variant: "default" }],
          }),
        }),
      );
    });
  });

  describe("handleModelSearchResults", () => {
    it("returns false when no callback data", async () => {
      const ctx = mockContext({ callbackQuery: undefined });

      const result = await handleModelSearchResults(ctx);

      expect(result).toBe(false);
    });

    it("returns false when no model-search interaction is active", async () => {
      mocked.interactionManagerGetSnapshotMock.mockReturnValue(null);

      const ctx = mockContext({
        callbackQuery: { data: "model:search:cancel" },
      });

      const result = await handleModelSearchResults(ctx);

      expect(result).toBe(false);
    });

    it("returns false when stage is not results", async () => {
      mocked.interactionManagerGetSnapshotMock.mockReturnValue({
        kind: "custom",
        metadata: { flow: "model-search", stage: "input" },
      });

      const ctx = mockContext({
        callbackQuery: { data: "model:search:cancel" },
      });

      const result = await handleModelSearchResults(ctx);

      expect(result).toBe(false);
    });

    it("returns false when interaction is not model-search", async () => {
      mocked.interactionManagerGetSnapshotMock.mockReturnValue({
        kind: "custom",
        metadata: { flow: "other-flow", stage: "results" },
      });

      const ctx = mockContext({
        callbackQuery: { data: "model:search:cancel" },
      });

      const result = await handleModelSearchResults(ctx);

      expect(result).toBe(false);
    });

    it("resolves short search result callback data to the original long model ID", async () => {
      const longModelID = "accounts/hubabuba3227-1hvtqlh/deployments/kpwpvuky";
      mocked.interactionManagerGetSnapshotMock.mockReturnValue({
        kind: "custom",
        metadata: {
          flow: "model-search",
          stage: "results",
          messageId: 999,
          models: [{ providerID: "fireworks", modelID: longModelID, variant: "default" }],
        },
      });

      const ctx = mockContext({
        callbackQuery: {
          data: "model:result:0",
          message: { message_id: 999 },
        },
        api: {},
      });

      const result = await handleModelSearchResults(ctx);

      expect(result).toBe(true);
      expect(mocked.interactionManagerClearMock).toHaveBeenCalledWith("model_search_selected");
      expect(mocked.selectModelMock).toHaveBeenCalledWith({
        providerID: "fireworks",
        modelID: longModelID,
        variant: "default",
      });
    });
  });
});
