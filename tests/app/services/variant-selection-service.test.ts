import { beforeEach, describe, expect, it, vi } from "#vitest";
import { loadSut } from "#helpers/sut-loader.js";
import { createSettingsStoreMock } from "#helpers/settings-store-mock.js";

const mocked = vi.hoisted(() => ({
  getStoredModelMock: vi.fn(),
  getCurrentModelMock: vi.fn(),
  setCurrentModelMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerInfoMock: vi.fn(),
}));

vi.mock("#src/opencode/client.ts", () => ({
  opencodeClient: {
    config: { providers: vi.fn() },
  },
}));

vi.mock("#src/app/services/model-selection-service.ts", () => ({
  getStoredModel: mocked.getStoredModelMock,
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

const settingsStoreMock = createSettingsStoreMock();
settingsStoreMock.getCurrentModel = mocked.getCurrentModelMock;
settingsStoreMock.setCurrentModel = mocked.setCurrentModelMock;
vi.mock("#src/app/stores/settings-store.ts", () => settingsStoreMock);

vi.mock("#src/utils/logger.ts", () => ({
  logger: {
    debug: vi.fn(),
    info: mocked.loggerInfoMock,
    warn: mocked.loggerWarnMock,
    error: vi.fn(),
  },
}));

const { setCurrentVariant } = await loadSut<typeof import("#src/app/services/variant-selection-service.js")>(
  "#src/app/services/variant-selection-service.ts",
  import.meta.url,
);

describe("setCurrentVariant", () => {
  beforeEach(() => {
    mocked.getStoredModelMock.mockReset();
    mocked.getCurrentModelMock.mockReset();
    mocked.setCurrentModelMock.mockReset();
    mocked.loggerWarnMock.mockReset();
    mocked.loggerInfoMock.mockReset();
  });

  it("persists the fallback model when settings have no currentModel", () => {
    mocked.getCurrentModelMock.mockReturnValue(undefined);
    mocked.getStoredModelMock.mockReturnValue({
      providerID: "opencode-go",
      modelID: "deepseek-v4-flash",
      variant: "default",
    });

    setCurrentVariant("low");

    expect(mocked.setCurrentModelMock).toHaveBeenCalledWith({
      providerID: "opencode-go",
      modelID: "deepseek-v4-flash",
      variant: "low",
    });
  });

  it("does not write when the fallback model has no provider or id", () => {
    mocked.getStoredModelMock.mockReturnValue({
      providerID: "",
      modelID: "",
      variant: "default",
    });

    setCurrentVariant("low");

    expect(mocked.setCurrentModelMock).not.toHaveBeenCalled();
    expect(mocked.loggerWarnMock).toHaveBeenCalled();
  });
});
