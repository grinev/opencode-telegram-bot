import { beforeEach, describe, expect, it, vi } from "#vitest";
import type { Session } from "@opencode-ai/sdk/v2";
import { loadSut } from "#helpers/sut-loader.js";

const selectAgent = vi.hoisted(() => vi.fn());
const selectModel = vi.hoisted(() => vi.fn());

vi.mock("#src/app/services/agent-selection-service.ts", () => ({
  selectAgent,
  getAvailableAgents: vi.fn(async () => []),
  resolveProjectAgent: vi.fn(async () => "build"),
  fetchCurrentAgent: vi.fn(async () => "build"),
  applyAgentConfiguredSettings: vi.fn(async () => false),
  getStoredAgent: vi.fn(() => "build"),
}));

vi.mock("#src/app/services/model-selection-service.ts", () => ({
  selectModel,
  getStoredModel: vi.fn(),
  reconcileStoredModelSelection: vi.fn(),
  getFavoriteModels: vi.fn(() => []),
  getModelSelectionLists: vi.fn(),
  __resetModelCatalogCacheForTests: vi.fn(),
  getProviders: vi.fn(async () => []),
  getProviderModels: vi.fn(async () => []),
  searchModels: vi.fn(async () => []),
  fetchCurrentModel: vi.fn(),
}));

const { applySessionSettings } = await loadSut<typeof import("#src/app/services/session-settings-service.js")>(
  "#src/app/services/session-settings-service.ts",
  import.meta.url,
);

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-1",
    slug: "session-1",
    projectID: "project-1",
    directory: "D:\\Projects\\Repo",
    title: "Session 1",
    version: "1.0.0",
    time: { created: 1, updated: 2 },
    ...overrides,
  } as Session;
}

describe("app/services/session-settings-service", () => {
  beforeEach(() => {
    selectAgent.mockClear();
    selectModel.mockClear();
  });

  it("adopts the agent and the model a session carries", () => {
    applySessionSettings(
      makeSession({
        agent: "plan",
        model: { providerID: "opencode-go", id: "deepseek-v4-flash", variant: "high" },
      }),
    );

    expect(selectAgent).toHaveBeenCalledWith("plan");
    expect(selectModel).toHaveBeenCalledWith({
      providerID: "opencode-go",
      modelID: "deepseek-v4-flash",
      variant: "high",
    });
  });

  it("changes only the agent when the session carries no model", () => {
    applySessionSettings(makeSession({ agent: "plan" }));

    expect(selectAgent).toHaveBeenCalledWith("plan");
    expect(selectModel).not.toHaveBeenCalled();
  });

  it("changes only the model when the session carries no agent", () => {
    applySessionSettings(
      makeSession({ model: { providerID: "opencode-go", id: "deepseek-v4-flash" } }),
    );

    expect(selectAgent).not.toHaveBeenCalled();
    expect(selectModel).toHaveBeenCalledWith({
      providerID: "opencode-go",
      modelID: "deepseek-v4-flash",
      variant: "default",
    });
  });

  it("stores a model without a variant at the default variant", () => {
    applySessionSettings(
      makeSession({ model: { providerID: "opencode-go", id: "deepseek-v4-flash" } }),
    );

    expect(selectModel).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "default" }),
    );
  });

  it("leaves the current settings untouched for a session that was never prompted", () => {
    applySessionSettings(makeSession());

    expect(selectAgent).not.toHaveBeenCalled();
    expect(selectModel).not.toHaveBeenCalled();
  });

  it("ignores a model that names no provider or no id", () => {
    applySessionSettings(makeSession({ model: { providerID: "", id: "" } }));

    expect(selectModel).not.toHaveBeenCalled();
  });
});
