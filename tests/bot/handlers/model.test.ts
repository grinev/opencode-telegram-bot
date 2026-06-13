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
}));

vi.mock("../../../src/app/services/model-selection-service.js", () => ({
  getModelSelectionLists: mocked.getModelSelectionListsMock,
  searchModels: mocked.searchModelsMock,
  selectModel: vi.fn(),
  fetchCurrentModel: vi.fn(),
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

import {
  buildModelSelectionMenu,
} from "../../../src/bot/menus/model-selection-menu.js";

import {
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
  });
});
