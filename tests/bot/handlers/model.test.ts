import { beforeEach, describe, expect, it, vi } from "vitest";
import { InlineKeyboard } from "grammy";
import type { InlineKeyboardButton } from "grammy/types";

const mocked = vi.hoisted(() => ({
  getModelSelectionListsMock: vi.fn(),
  getProvidersMock: vi.fn(),
  getProviderModelsMock: vi.fn(),
  fetchCurrentModelMock: vi.fn(),
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
  replyWithInlineMenuMock: vi.fn(),
  showVariantMenuAfterModelChangeMock: vi.fn(),
}));

vi.mock("../../../src/app/services/model-selection-service.js", () => ({
  getModelSelectionLists: mocked.getModelSelectionListsMock,
  getProviders: mocked.getProvidersMock,
  getProviderModels: mocked.getProviderModelsMock,
  searchModels: mocked.searchModelsMock,
  selectModel: mocked.selectModelMock,
  fetchCurrentModel: mocked.fetchCurrentModelMock,
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
  replyWithInlineMenu: mocked.replyWithInlineMenuMock,
  appendInlineMenuCancelButton: (keyboard: InlineKeyboard) => keyboard,
}));

vi.mock("../../../src/bot/menus/variant-selection-menu.js", () => ({
  showVariantSelectionMenuAfterModelChange: mocked.showVariantMenuAfterModelChangeMock,
}));

import {
  buildModelSelectionMenu,
  buildProviderModelsMenuView,
  buildProvidersMenuView,
  showModelSelectionMenu,
} from "../../../src/bot/menus/model-selection-menu.js";

import {
  handleModelProvidersCallback,
  handleModelSelect,
  handleModelSearchCallback,
  handleModelSearchTextInput,
  handleModelSearchResults,
} from "../../../src/bot/callbacks/model-selection-callback-handler.js";
import { t } from "../../../src/i18n/index.js";
import { defined } from "../../helpers/defined.js";

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

function getCallbackData(button: InlineKeyboardButton): string | undefined {
  return "callback_data" in button ? button.callback_data : undefined;
}

function cell(
  keyboard: ReadonlyArray<ReadonlyArray<InlineKeyboardButton>>,
  row: number,
  col: number,
): InlineKeyboardButton {
  return defined(keyboard[row]?.[col], `button[${row}][${col}]`);
}

describe("bot model selection", () => {
  beforeEach(() => {
    mocked.getModelSelectionListsMock.mockReset();
    mocked.getProvidersMock.mockReset().mockResolvedValue([]);
    mocked.getProviderModelsMock.mockReset().mockResolvedValue([]);
    mocked.fetchCurrentModelMock
      .mockReset()
      .mockReturnValue({ providerID: "openai", modelID: "gpt-4o", variant: "default" });
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
    mocked.replyWithInlineMenuMock.mockReset().mockResolvedValue(999);
    mocked.showVariantMenuAfterModelChangeMock.mockReset().mockResolvedValue(undefined);
  });

  describe("buildModelSelectionMenu", () => {
    it("includes search and providers buttons as the first row", async () => {
      mocked.getModelSelectionListsMock.mockResolvedValue({
        favorites: [{ providerID: "openai", modelID: "gpt-4o" }],
        recent: [{ providerID: "google", modelID: "gemini-pro" }],
      });

      const keyboard = await buildModelSelectionMenu();

      expect(keyboard).toBeInstanceOf(InlineKeyboard);
      const rows = keyboard.inline_keyboard;
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(cell(rows, 0, 0).text).toBe("🔍 Search");
      expect(getCallbackData(cell(rows, 0, 0))).toBe("model:search");
      expect(cell(rows, 0, 1).text).toBe("🗂 Providers");
      expect(getCallbackData(cell(rows, 0, 1))).toBe("model:providers:0");
    });

    it("still returns keyboard with search button when no favorites or recent", async () => {
      mocked.getModelSelectionListsMock.mockResolvedValue({
        favorites: [],
        recent: [],
      });

      const keyboard = await buildModelSelectionMenu();

      // Keyboard always has at least the search button row
      expect(keyboard.inline_keyboard.length).toBeGreaterThanOrEqual(1);
      expect(cell(keyboard.inline_keyboard, 0, 0).text).toBe("🔍 Search");
      expect(getCallbackData(cell(keyboard.inline_keyboard, 0, 0))).toBe("model:search");
    });

    it("uses short callback data for long model IDs", async () => {
      const longModelID = "accounts/hubabuba3227-1hvtqlh/deployments/kpwpvuky";
      mocked.getModelSelectionListsMock.mockResolvedValue({
        favorites: [],
        recent: [{ providerID: "fireworks", modelID: longModelID }],
      });

      const keyboard = await buildModelSelectionMenu();
      const callbackData = getCallbackData(cell(keyboard.inline_keyboard, 1, 0));

      expect(callbackData).toBe("model:list:recent:0");
      expect(Buffer.byteLength(callbackData ?? "", "utf-8")).toBeLessThanOrEqual(64);
      expect(callbackData).not.toContain(longModelID);
    });

    it("stores the rendered model lists with the active menu", async () => {
      const modelLists = {
        favorites: [{ providerID: "openai", modelID: "gpt-4o" }],
        recent: [{ providerID: "google", modelID: "gemini-pro" }],
      };
      mocked.getModelSelectionListsMock.mockResolvedValue(modelLists);
      const ctx = mockContext();

      await showModelSelectionMenu(ctx);

      expect(mocked.replyWithInlineMenuMock).toHaveBeenCalledWith(
        ctx,
        expect.objectContaining({
          menuKind: "model",
          metadata: { modelLists },
        }),
      );
    });
  });

  describe("handleModelSelect", () => {
    it("resolves short list callback data from the rendered menu snapshot", async () => {
      const longModelID = "accounts/hubabuba3227-1hvtqlh/deployments/kpwpvuky";
      mocked.interactionManagerGetSnapshotMock.mockReturnValue({
        kind: "inline",
        metadata: {
          menuKind: "model",
          messageId: 999,
          modelLists: {
            favorites: [],
            recent: [{ providerID: "fireworks", modelID: longModelID }],
          },
        },
      });
      mocked.getModelSelectionListsMock.mockResolvedValue({
        favorites: [],
        recent: [{ providerID: "openai", modelID: "different-model" }],
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
      expect(mocked.getModelSelectionListsMock).not.toHaveBeenCalled();
      expect(mocked.showVariantMenuAfterModelChangeMock).toHaveBeenCalledWith(ctx, {
        providerID: "fireworks",
        modelID: longModelID,
        variant: "default",
      });

      const replyOrder = defined(
        (ctx.reply as unknown as { mock: { invocationCallOrder: number[] } }).mock
          .invocationCallOrder[0],
        "confirmation reply order",
      );
      const variantMenuOrder = defined(
        mocked.showVariantMenuAfterModelChangeMock.mock.invocationCallOrder[0],
        "variant menu order",
      );
      expect(replyOrder).toBeLessThan(variantMenuOrder);
    });

    it("rejects stale search result callbacks instead of parsing them as legacy models", async () => {
      const ctx = mockContext({
        callbackQuery: {
          data: "model:result:0",
          message: { message_id: 999 },
        },
        api: {},
      });

      const result = await handleModelSelect(ctx);

      expect(result).toBe(true);
      expect(mocked.selectModelMock).not.toHaveBeenCalled();
      expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    });

    it("rejects unresolved short list callbacks instead of parsing them as legacy models", async () => {
      mocked.interactionManagerGetSnapshotMock.mockReturnValue({
        kind: "inline",
        metadata: {
          menuKind: "model",
          messageId: 999,
          modelLists: { favorites: [], recent: [] },
        },
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
      expect(mocked.selectModelMock).not.toHaveBeenCalled();
      expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    });

    it("reports a selection failure and still claims the callback", async () => {
      mocked.interactionManagerGetSnapshotMock.mockReturnValue({
        kind: "inline",
        metadata: {
          menuKind: "model",
          messageId: 999,
          modelLists: {
            favorites: [],
            recent: [{ providerID: "openai", modelID: "gpt-5" }],
          },
        },
      });
      mocked.selectModelMock.mockImplementation(() => {
        throw new Error("store write failed");
      });

      const ctx = mockContext({
        callbackQuery: {
          data: "model:list:recent:0",
          message: { message_id: 999 },
        },
        api: {},
      });

      const result = await handleModelSelect(ctx);

      // `false` here would make the router answer the callback a second time.
      expect(result).toBe(true);
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
        text: t("model.change_error_callback"),
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
      const replyCall = defined(vi.mocked(ctx.reply).mock.calls[0]);
      const replyOptions = replyCall[1] as {
        reply_markup: { inline_keyboard: Array<Array<{ callback_data?: string }>> };
      };
      const callbackData = defined(replyOptions.reply_markup.inline_keyboard[0]?.[0]).callback_data;

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
      expect(mocked.showVariantMenuAfterModelChangeMock).toHaveBeenCalledWith(ctx, {
        providerID: "fireworks",
        modelID: longModelID,
        variant: "default",
      });
    });

    it("rejects stale short list callbacks instead of parsing them as legacy models", async () => {
      mocked.interactionManagerGetSnapshotMock.mockReturnValue({
        kind: "custom",
        metadata: {
          flow: "model-search",
          stage: "results",
          messageId: 999,
          models: [],
        },
      });

      const ctx = mockContext({
        callbackQuery: {
          data: "model:list:recent:0",
          message: { message_id: 999 },
        },
        api: {},
      });

      const result = await handleModelSearchResults(ctx);

      expect(result).toBe(true);
      expect(mocked.selectModelMock).not.toHaveBeenCalled();
      expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    });
  });

  describe("buildProvidersMenuView", () => {
    const providers = Array.from({ length: 12 }, (_, index) => ({
      id: `provider-${index}`,
      name: `Provider ${index}`,
      modelCount: index + 1,
    }));

    it("renders one button per provider and a back button to the model root menu", () => {
      const view = buildProvidersMenuView(providers.slice(0, 2), 0);

      expect(view.text).toBe("Select provider from the list:");
      expect(view.keyboard.inline_keyboard).toHaveLength(3);
      expect(cell(view.keyboard.inline_keyboard, 0, 0).text).toBe("Provider 0 (1)");
      expect(getCallbackData(cell(view.keyboard.inline_keyboard, 0, 0))).toBe("model:provider:0:0");
      expect(cell(view.keyboard.inline_keyboard, 2, 0).text).toBe("⬅️ Back");
      expect(getCallbackData(cell(view.keyboard.inline_keyboard, 2, 0))).toBe("model:root");
    });

    it("paginates providers and exposes the normalized page", () => {
      const view = buildProvidersMenuView(providers, 1);

      expect(view.page).toBe(1);
      expect(view.text).toContain("Page 2/2");

      const providerButtons = view.keyboard.inline_keyboard.filter((row) =>
        getCallbackData(defined(row[0]))?.startsWith("model:provider:"),
      );
      expect(providerButtons).toHaveLength(2);
      expect(getCallbackData(cell(providerButtons, 0, 0))).toBe("model:provider:10:0");

      const paginationRow = defined(view.keyboard.inline_keyboard.at(-2));
      expect(getCallbackData(defined(paginationRow[0]))).toBe("model:providers:0");
    });

    it("clamps an out-of-range page", () => {
      const view = buildProvidersMenuView(providers, 99);

      expect(view.page).toBe(1);
    });

    it("shows a placeholder when there are no providers", () => {
      const view = buildProvidersMenuView([], 0);

      expect(view.text).toBe("⚠️ No connected providers");
      expect(view.keyboard.inline_keyboard).toHaveLength(1);
      expect(getCallbackData(cell(view.keyboard.inline_keyboard, 0, 0))).toBe("model:root");
    });
  });

  describe("buildProviderModelsMenuView", () => {
    const provider = { id: "openai", name: "OpenAI", modelCount: 12 };
    const models = Array.from({ length: 12 }, (_, index) => ({
      providerID: "openai",
      modelID: `model-${index}`,
    }));

    it("marks the active model and goes back to the providers page it came from", () => {
      const view = buildProviderModelsMenuView(provider, 3, models.slice(0, 2), 0, 2, {
        providerID: "openai",
        modelID: "model-1",
      });

      expect(view.text).toBe("OpenAI — select model:");
      expect(view.pageModels).toHaveLength(2);
      expect(cell(view.keyboard.inline_keyboard, 0, 0).text).toBe("model-0");
      expect(getCallbackData(cell(view.keyboard.inline_keyboard, 0, 0))).toBe("model:pick:0");
      expect(cell(view.keyboard.inline_keyboard, 1, 0).text).toBe("✅ model-1");
      expect(getCallbackData(cell(view.keyboard.inline_keyboard, 2, 0))).toBe("model:providers:2");
    });

    it("paginates models with per-page indices", () => {
      const view = buildProviderModelsMenuView(provider, 3, models, 1, 0);

      expect(view.page).toBe(1);
      expect(view.text).toContain("Page 2/2");
      expect(view.pageModels).toEqual([
        { providerID: "openai", modelID: "model-10" },
        { providerID: "openai", modelID: "model-11" },
      ]);
      expect(getCallbackData(cell(view.keyboard.inline_keyboard, 0, 0))).toBe("model:pick:0");

      const paginationRow = defined(view.keyboard.inline_keyboard.at(-2));
      expect(getCallbackData(defined(paginationRow[0]))).toBe("model:provider:3:0");
    });

    it("shows a placeholder when the provider has no models", () => {
      const view = buildProviderModelsMenuView(provider, 0, [], 0, 0);

      expect(view.text).toBe("⚠️ No models available for OpenAI");
      expect(view.pageModels).toEqual([]);
    });
  });

  describe("handleModelProvidersCallback", () => {
    const activeMenuSnapshot = (metadata: Record<string, unknown>) => ({
      kind: "inline",
      metadata: { menuKind: "model", messageId: 999, ...metadata },
    });

    function providerMenuContext(data: string) {
      return mockContext({
        callbackQuery: { data, message: { message_id: 999 } },
        editMessageText: vi.fn().mockResolvedValue(undefined),
        api: {},
      });
    }

    it("ignores callbacks that are not part of the provider browser", async () => {
      const ctx = providerMenuContext("model:list:recent:0");

      await expect(handleModelProvidersCallback(ctx)).resolves.toBe(false);
    });

    it("opens the providers list and stores it with the active menu", async () => {
      mocked.interactionManagerGetSnapshotMock.mockReturnValue(activeMenuSnapshot({}));
      const providers = [{ id: "openai", name: "OpenAI", modelCount: 2 }];
      mocked.getProvidersMock.mockResolvedValue(providers);

      const ctx = providerMenuContext("model:providers:0");
      const result = await handleModelProvidersCallback(ctx);

      expect(result).toBe(true);
      expect(ctx.editMessageText).toHaveBeenCalledWith(
        "Select provider from the list:",
        expect.objectContaining({ reply_markup: expect.anything() }),
      );
      expect(mocked.interactionManagerTransitionMock).toHaveBeenCalledWith({
        expectedInput: "callback",
        metadata: {
          menuKind: "model",
          messageId: 999,
          providers,
          providersPage: 0,
        },
      });
    });

    it("opens the models of the selected provider and stores the rendered page", async () => {
      const providers = [{ id: "openai", name: "OpenAI", modelCount: 2 }];
      mocked.interactionManagerGetSnapshotMock.mockReturnValue(
        activeMenuSnapshot({ providers, providersPage: 1 }),
      );
      mocked.getProviderModelsMock.mockResolvedValue([
        { providerID: "openai", modelID: "gpt-4o" },
        { providerID: "openai", modelID: "gpt-5" },
      ]);

      const ctx = providerMenuContext("model:provider:0:0");
      const result = await handleModelProvidersCallback(ctx);

      expect(result).toBe(true);
      expect(mocked.getProviderModelsMock).toHaveBeenCalledWith("openai");
      expect(ctx.editMessageText).toHaveBeenCalledWith(
        "OpenAI — select model:",
        expect.objectContaining({ reply_markup: expect.anything() }),
      );
      expect(mocked.interactionManagerTransitionMock).toHaveBeenCalledWith({
        expectedInput: "callback",
        metadata: {
          menuKind: "model",
          messageId: 999,
          providers,
          providersPage: 1,
          models: [
            { providerID: "openai", modelID: "gpt-4o", variant: "default" },
            { providerID: "openai", modelID: "gpt-5", variant: "default" },
          ],
        },
      });
    });

    it("returns to the model root menu", async () => {
      const modelLists = {
        favorites: [{ providerID: "openai", modelID: "gpt-4o" }],
        recent: [],
      };
      mocked.interactionManagerGetSnapshotMock.mockReturnValue(
        activeMenuSnapshot({ providers: [], providersPage: 0 }),
      );
      mocked.getModelSelectionListsMock.mockResolvedValue(modelLists);

      const ctx = providerMenuContext("model:root");
      const result = await handleModelProvidersCallback(ctx);

      expect(result).toBe(true);
      expect(ctx.editMessageText).toHaveBeenCalled();
      expect(mocked.interactionManagerTransitionMock).toHaveBeenCalledWith({
        expectedInput: "callback",
        metadata: { menuKind: "model", messageId: 999, modelLists },
      });
    });

    it("applies the model selected from a provider page", async () => {
      mocked.interactionManagerGetSnapshotMock.mockReturnValue(
        activeMenuSnapshot({
          providers: [{ id: "openai", name: "OpenAI", modelCount: 1 }],
          providersPage: 0,
          models: [{ providerID: "openai", modelID: "gpt-5", variant: "default" }],
        }),
      );

      const ctx = providerMenuContext("model:pick:0");
      const result = await handleModelProvidersCallback(ctx);

      expect(result).toBe(true);
      expect(mocked.selectModelMock).toHaveBeenCalledWith({
        providerID: "openai",
        modelID: "gpt-5",
        variant: "default",
      });
      expect(mocked.showVariantMenuAfterModelChangeMock).toHaveBeenCalledWith(ctx, {
        providerID: "openai",
        modelID: "gpt-5",
        variant: "default",
      });
    });

    it("rejects a callback whose model cannot be resolved from the menu snapshot", async () => {
      mocked.interactionManagerGetSnapshotMock.mockReturnValue(
        activeMenuSnapshot({ providers: [], providersPage: 0, models: [] }),
      );

      const ctx = providerMenuContext("model:pick:3");
      const result = await handleModelProvidersCallback(ctx);

      expect(result).toBe(true);
      expect(mocked.selectModelMock).not.toHaveBeenCalled();
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
        text: "Failed to change model",
      });
    });

    it("rejects a stale inline menu callback", async () => {
      mocked.ensureActiveInlineMenuMock.mockResolvedValue(false);

      const ctx = providerMenuContext("model:providers:0");
      const result = await handleModelProvidersCallback(ctx);

      expect(result).toBe(true);
      expect(ctx.editMessageText).not.toHaveBeenCalled();
    });
  });

  describe("handleModelSelect with provider browser callbacks", () => {
    it("does not touch the active menu state for provider browser callbacks", async () => {
      const ctx = mockContext({
        callbackQuery: { data: "model:providers:0", message: { message_id: 999 } },
      });

      const result = await handleModelSelect(ctx);

      expect(result).toBe(false);
      expect(mocked.ensureActiveInlineMenuMock).not.toHaveBeenCalled();
      expect(mocked.selectModelMock).not.toHaveBeenCalled();
    });
  });
});
