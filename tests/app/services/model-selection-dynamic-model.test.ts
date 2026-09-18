import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Dynamic-model decision tests. config.bot.dynamicModel is read at module
 * load, so each scenario re-imports the modules with a fresh registry after
 * setting OPENCODE_DYNAMIC_MODEL.
 */
async function importWithDynamicModel(value: string | undefined) {
  if (value === undefined) {
    delete process.env.OPENCODE_DYNAMIC_MODEL;
  } else {
    process.env.OPENCODE_DYNAMIC_MODEL = value;
  }
  vi.resetModules();
  const settingsStore = await import("../../../src/app/stores/settings-store.js");
  const service = await import("../../../src/app/services/model-selection-service.js");
  return { settingsStore, service };
}

describe("dynamic model selection", () => {
  afterEach(() => {
    delete process.env.OPENCODE_DYNAMIC_MODEL;
    vi.resetModules();
  });

  it("omits stored model by default: dynamic on, nothing explicitly picked", async () => {
    const { service } = await importWithDynamicModel(undefined); // default = true

    expect(service.shouldUseStoredModelForPrompt()).toBe(false);
  });

  it("sends stored model when the user picked one via the picker", async () => {
    const { settingsStore, service } = await importWithDynamicModel("true");

    settingsStore.markModelExplicitlySelected();

    expect(service.shouldUseStoredModelForPrompt()).toBe(true);
    expect(settingsStore.isModelExplicitlySelected()).toBe(true);
  });

  it("selectModel marks the pick as explicit", async () => {
    const { settingsStore, service } = await importWithDynamicModel("true");

    service.selectModel({ providerID: "omniroute", modelID: "auto" });

    expect(settingsStore.isModelExplicitlySelected()).toBe(true);
    expect(service.shouldUseStoredModelForPrompt()).toBe(true);
  });

  it("always sends the model when dynamic mode is disabled", async () => {
    const { settingsStore, service } = await importWithDynamicModel("false");

    expect(settingsStore.isModelExplicitlySelected()).toBe(false);
    expect(service.shouldUseStoredModelForPrompt()).toBe(true);
  });

  it("clearing the explicit flag returns to server-driven model", async () => {
    const { settingsStore, service } = await importWithDynamicModel("true");

    settingsStore.markModelExplicitlySelected();
    settingsStore.clearModelExplicitlySelected();

    expect(service.shouldUseStoredModelForPrompt()).toBe(false);
  });
});
