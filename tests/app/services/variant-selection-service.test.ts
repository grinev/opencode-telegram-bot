import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  getStoredModelMock: vi.fn(),
  getCurrentModelMock: vi.fn(),
  setCurrentModelMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerInfoMock: vi.fn(),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    config: { providers: vi.fn() },
  },
}));

vi.mock("../../../src/app/services/model-selection-service.js", () => ({
  getStoredModel: mocked.getStoredModelMock,
}));

vi.mock("../../../src/app/stores/settings-store.js", () => ({
  getCurrentModel: mocked.getCurrentModelMock,
  setCurrentModel: mocked.setCurrentModelMock,
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: mocked.loggerInfoMock,
    warn: mocked.loggerWarnMock,
    error: vi.fn(),
  },
}));

import { setCurrentVariant } from "../../../src/app/services/variant-selection-service.js";

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
