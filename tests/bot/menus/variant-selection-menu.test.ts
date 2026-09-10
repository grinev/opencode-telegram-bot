import { beforeEach, describe, expect, it, vi } from "#vitest";
import type { Context, InlineKeyboard } from "grammy";

const mocked = vi.hoisted(() => ({
  getAvailableVariantsMock: vi.fn(),
  replyWithInlineMenuMock: vi.fn(),
}));

vi.mock("#src/app/services/model-selection-service.ts", () => ({
  getStoredModel: vi.fn(() => ({ providerID: "openai", modelID: "gpt-5", variant: "default" })),
  selectModel: vi.fn(),
  reconcileStoredModelSelection: vi.fn(),
  getFavoriteModels: vi.fn(() => []),
  getModelSelectionLists: vi.fn(),
  __resetModelCatalogCacheForTests: vi.fn(),
  getProviders: vi.fn(async () => []),
  getProviderModels: vi.fn(async () => []),
  searchModels: vi.fn(async () => []),
  fetchCurrentModel: vi.fn(),
}));

vi.mock("#src/app/services/variant-selection-service.ts", () => ({
  getAvailableVariants: mocked.getAvailableVariantsMock,
  formatVariantForButton: vi.fn(
    (variantId: string) => variantId.charAt(0).toUpperCase() + variantId.slice(1),
  ),
  formatVariantForDisplay: vi.fn(
    (variantId: string) => variantId.charAt(0).toUpperCase() + variantId.slice(1),
  ),
  getCurrentVariant: vi.fn(() => "default"),
  getDefaultVariantFromConfig: vi.fn(() => "default"),
  setCurrentVariant: vi.fn(),
  validateVariantForModel: vi.fn(async () => ({ ok: true })),
}));

vi.mock("#src/bot/menus/inline-menu.ts", () => ({
  replyWithInlineMenu: mocked.replyWithInlineMenuMock,
}));

import { loadSut } from "#helpers/sut-loader.js";

const { showVariantSelectionMenuAfterModelChange } = await loadSut<
  typeof import("#src/bot/menus/variant-selection-menu.js")
>("#src/bot/menus/variant-selection-menu.ts", import.meta.url);
const { t } = await loadSut<typeof import("#src/i18n/index.js")>(
  "#src/i18n/index.ts",
  import.meta.url,
);
import { defined } from "#helpers/defined.js";

function mockContext() {
  return {
    chat: { id: 123 },
    reply: vi.fn().mockResolvedValue({ message_id: 42 }),
  } as unknown as Context;
}

const model = { providerID: "openai", modelID: "gpt-5", variant: "default" };

function replyOptions(): { menuKind: string; text: string; keyboard: InlineKeyboard } {
  const call = defined(mocked.replyWithInlineMenuMock.mock.calls[0], "replyWithInlineMenu call");
  return call[1] as { menuKind: string; text: string; keyboard: InlineKeyboard };
}

describe("bot/menus/variant-selection-menu — after a model change", () => {
  beforeEach(() => {
    mocked.getAvailableVariantsMock.mockReset();
    mocked.replyWithInlineMenuMock.mockReset().mockResolvedValue(42);
  });

  it("stays silent when the model offers only the default variant", async () => {
    mocked.getAvailableVariantsMock.mockResolvedValue([{ id: "default" }]);
    const ctx = mockContext();

    await showVariantSelectionMenuAfterModelChange(ctx, model);

    expect(mocked.replyWithInlineMenuMock).not.toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("stays silent when every extra variant is disabled", async () => {
    mocked.getAvailableVariantsMock.mockResolvedValue([
      { id: "default" },
      { id: "high", disabled: true },
      { id: "low", disabled: true },
    ]);
    const ctx = mockContext();

    await showVariantSelectionMenuAfterModelChange(ctx, model);

    expect(mocked.replyWithInlineMenuMock).not.toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("opens the variant menu when the model offers a real choice", async () => {
    mocked.getAvailableVariantsMock.mockResolvedValue([
      { id: "default" },
      { id: "high" },
      { id: "low", disabled: true },
    ]);
    const ctx = mockContext();

    await showVariantSelectionMenuAfterModelChange(ctx, model);

    expect(mocked.getAvailableVariantsMock).toHaveBeenCalledWith("openai", "gpt-5");

    const options = replyOptions();
    expect(options.menuKind).toBe("variant");
    expect(options.text).toBe(t("variant.menu.current", { name: "Default" }));

    const rows = options.keyboard.inline_keyboard.filter((row) => row.length > 0);
    expect(rows).toHaveLength(2);
    expect(defined(rows[0]?.[0], "default button").text).toBe("✅ Default");
    expect(defined(rows[1]?.[0], "high button").text).toBe("High");
  });

  it("stays silent when the variants cannot be read", async () => {
    mocked.getAvailableVariantsMock.mockRejectedValue(new Error("providers unavailable"));
    const ctx = mockContext();

    await showVariantSelectionMenuAfterModelChange(ctx, model);

    expect(mocked.replyWithInlineMenuMock).not.toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });
});
