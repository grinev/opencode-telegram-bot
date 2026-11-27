import { describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  nextLateCatalogChangeMock: vi.fn(),
  getStoredModelMock: vi.fn(() => ({
    providerID: "opencode",
    modelID: "big-pickle",
    variant: "default",
  })),
}));

vi.mock("../../../src/opencode/ready-refresh.js", () => ({
  watchLateModelCatalogChanges: () => mocked.nextLateCatalogChangeMock,
}));

vi.mock("../../../src/app/services/model-selection-service.js", () => ({
  getStoredModel: mocked.getStoredModelMock,
}));

import {
  refreshModelViewsAfterLateCatalogSettle,
  type ModelViewsDeps,
} from "../../../src/bot/services/model-views.js";

function createDeps() {
  const sessionMetricsManager = {
    refreshContextLimit: vi.fn().mockResolvedValue(undefined),
  };
  const keyboardManager = {
    isInitialized: vi.fn(() => true),
    updateModel: vi.fn(),
  };

  return {
    deps: { sessionMetricsManager, keyboardManager } as unknown as ModelViewsDeps,
    sessionMetricsManager,
    keyboardManager,
  };
}

describe("bot/services/model-views", () => {
  it("redraws once per late catalog change until no further change comes", async () => {
    mocked.nextLateCatalogChangeMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const { deps, sessionMetricsManager, keyboardManager } = createDeps();

    refreshModelViewsAfterLateCatalogSettle(deps, "opencode_start_success");

    await vi.waitFor(() => expect(mocked.nextLateCatalogChangeMock).toHaveBeenCalledTimes(3));
    expect(sessionMetricsManager.refreshContextLimit).toHaveBeenCalledTimes(2);
    expect(keyboardManager.updateModel).toHaveBeenCalledTimes(2);
    expect(keyboardManager.updateModel).toHaveBeenCalledWith({
      providerID: "opencode",
      modelID: "big-pickle",
      variant: "default",
    });
  });

  it("does not redraw when the catalog settles without a change", async () => {
    mocked.nextLateCatalogChangeMock.mockReset();
    mocked.nextLateCatalogChangeMock.mockResolvedValue(false);
    const { deps, sessionMetricsManager } = createDeps();

    refreshModelViewsAfterLateCatalogSettle(deps, "config_reload");

    await vi.waitFor(() => expect(mocked.nextLateCatalogChangeMock).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(sessionMetricsManager.refreshContextLimit).not.toHaveBeenCalled();
  });
});
