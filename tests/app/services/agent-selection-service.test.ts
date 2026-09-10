import { beforeEach, describe, expect, it, vi } from "#vitest";
import { loadSut } from "#helpers/sut-loader.js";

// Per-test state stored on globalThis. The mock factory captures this
// reference, so tests can mutate state between calls and the synthetic
// module's getters return the latest value.
const TEST_STATE_KEY = "__bunTestAgentState__";
interface TestState {
  currentProject:
    | {
        id: string;
        worktree: string;
        name: string;
      }
    | undefined;
  currentSession:
    | {
        id: string;
        directory: string;
        title: string;
      }
    | undefined;
  currentAgent: string | undefined;
}
const state: TestState = (globalThis as Record<string, TestState>)[TEST_STATE_KEY] ??= {
  currentProject: undefined,
  currentSession: undefined,
  currentAgent: undefined,
};

const mocked = {
  appAgentsMock: vi.fn(),
  sessionMessagesMock: vi.fn(),
  getCurrentProjectMock: vi.fn(() => state.currentProject),
  getCurrentSessionMock: vi.fn(() => state.currentSession),
  getCurrentAgentMock: vi.fn(() => state.currentAgent),
  setCurrentAgentMock: vi.fn((agentName: string) => {
    state.currentAgent = agentName;
  }),
  selectModelMock: vi.fn(),
  getStoredModelMock: vi.fn(() => ({
    providerID: "stored-provider",
    modelID: "stored-model",
    variant: "high",
  })),
  setCurrentVariantMock: vi.fn(),
  loggerDebugMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  setCurrentProject: (project?: { id: string; worktree: string; name: string }) => {
    state.currentProject = project;
  },
  setCurrentSession: (session?: { id: string; directory: string; title: string }) => {
    state.currentSession = session;
  },
  setCurrentAgent: (agentName?: string) => {
    state.currentAgent = agentName;
  },
};

vi.mock("#src/opencode/client.ts", () => ({
  opencodeClient: {
    app: {
      agents: mocked.appAgentsMock,
    },
    session: {
      messages: mocked.sessionMessagesMock,
    },
  },
}));

vi.mock("#src/app/stores/settings-store.ts", () => {
  const stub: Record<string, unknown> = {};
  const names = [
    "getCurrentProject",
    "setCurrentProject",
    "clearProject",
    "getCurrentSession",
    "setCurrentSession",
    "clearSession",
    "getTtsMode",
    "setTtsMode",
    "getCurrentAgent",
    "setCurrentAgent",
    "clearCurrentAgent",
    "getCurrentModel",
    "setCurrentModel",
    "clearCurrentModel",
    "getPinnedMessageId",
    "setPinnedMessageId",
    "clearPinnedMessageId",
    "getSessionDirectoryCache",
    "setSessionDirectoryCache",
    "clearSessionDirectoryCache",
    "getScheduledTasks",
    "setScheduledTasks",
    "getScheduledTaskSessionIgnores",
    "setScheduledTaskSessionIgnores",
    "getVisibleProjects",
    "setVisibleProjects",
    "flushSettings",
    "getCompactOutputMode",
    "setCompactOutputMode",
    "getShowThinkingContent",
    "setShowThinkingContent",
    "getShowAssistantRunFooter",
    "setShowAssistantRunFooter",
    "getResponseStreamingMode",
    "setResponseStreamingMode",
    "getSendDiffFileAttachments",
    "setSendDiffFileAttachments",
    "getPromptQueueEnabled",
    "setPromptQueueEnabled",
    "__resetSettingsForTests",
    "loadSettings",
  ];
  for (const name of names) stub[name] = vi.fn();
  stub.getCurrentProject = mocked.getCurrentProjectMock;
  stub.getCurrentAgent = mocked.getCurrentAgentMock;
  stub.setCurrentAgent = mocked.setCurrentAgentMock;
  return stub;
});

vi.mock("#src/app/services/session-service.ts", () => ({
  getCurrentSession: mocked.getCurrentSessionMock,
  setCurrentSession: vi.fn(),
  clearSession: vi.fn(),
}));

vi.mock("#src/app/services/model-selection-service.ts", () => ({
  selectModel: mocked.selectModelMock,
  getStoredModel: mocked.getStoredModelMock,
  getModelSelectionLists: vi.fn(),
  reconcileStoredModelSelection: vi.fn(async () => true),
  __resetModelCatalogCacheForTests: vi.fn(),
  getFavoriteModels: vi.fn(async () => []),
  getProviders: vi.fn(async () => []),
  getProviderModels: vi.fn(async () => []),
  searchModels: vi.fn(async () => []),
  fetchCurrentModel: vi.fn(),
}));

vi.mock("#src/app/services/variant-selection-service.ts", () => ({
  setCurrentVariant: mocked.setCurrentVariantMock,
  formatVariantForButton: vi.fn((variantId: string) => variantId),
  formatVariantForDisplay: vi.fn((variantId: string) => variantId),
  getCurrentVariant: vi.fn(() => "default"),
  getDefaultVariantFromConfig: vi.fn(() => "default"),
  getAvailableVariants: vi.fn(async () => []),
  validateVariantForModel: vi.fn(async () => ({ ok: true })),
}));

vi.mock("#src/utils/logger.ts", () => ({
  logger: {
    debug: mocked.loggerDebugMock,
    error: mocked.loggerErrorMock,
    info: mocked.loggerInfoMock,
    warn: mocked.loggerWarnMock,
  },
}));

const sut = await loadSut<typeof import("#src/app/services/agent-selection-service.js")>(
  "#src/app/services/agent-selection-service.ts",
  import.meta.url,
);
const { applyAgentConfiguredSettings } = sut;

function createAgentResponse(
  agents: Array<{
    name: string;
    mode: "primary" | "all" | "subagent";
    hidden?: boolean;
    model?: { modelID: string; providerID: string };
    variant?: string;
  }>,
) {
  return {
    data: agents,
    error: null,
  };
}

describe("agent/manager", () => {
  beforeEach(() => {
    mocked.appAgentsMock.mockReset();
    mocked.sessionMessagesMock.mockReset();
    mocked.getCurrentProjectMock.mockClear();
    mocked.getCurrentSessionMock.mockClear();
    mocked.getCurrentAgentMock.mockClear();
    mocked.setCurrentAgentMock.mockClear();
    mocked.selectModelMock.mockReset();
    mocked.getStoredModelMock.mockClear();
    mocked.setCurrentVariantMock.mockReset();
    mocked.loggerDebugMock.mockReset();
    mocked.loggerErrorMock.mockReset();
    mocked.loggerInfoMock.mockReset();
    mocked.loggerWarnMock.mockReset();
    state.currentProject = undefined;
    state.currentSession = undefined;
    state.currentAgent = undefined;
  });

  it("filters out hidden agents and subagents", async () => {
    mocked.setCurrentProject({
      id: "project-1",
      worktree: "/workspace/project-1",
      name: "project-1",
    });
    mocked.appAgentsMock.mockResolvedValue(
      createAgentResponse([
        { name: "orchestrator", mode: "primary" },
        { name: "build", mode: "primary" },
        { name: "summary", mode: "primary", hidden: true },
        { name: "general", mode: "subagent" },
      ]),
    );

    const agents = await sut.getAvailableAgents();

    expect(agents).toEqual([
      { name: "orchestrator", mode: "primary" },
      { name: "build", mode: "primary" },
    ]);
  });

  it("falls back to build when the preferred agent is unavailable in the project", async () => {
    mocked.setCurrentProject({
      id: "project-1",
      worktree: "/workspace/project-1",
      name: "project-1",
    });
    mocked.setCurrentAgent("orchestrator");
    mocked.appAgentsMock.mockResolvedValue(
      createAgentResponse([
        { name: "build", mode: "primary" },
        { name: "plan", mode: "primary" },
      ]),
    );

    const result = await sut.resolveProjectAgent("orchestrator");

    expect(result).toBe("build");
    expect(mocked.setCurrentAgentMock).toHaveBeenCalledWith("build");
    expect(mocked.loggerWarnMock).toHaveBeenCalledOnce();
  });

  it("falls back to the first available agent when build is unavailable", async () => {
    mocked.setCurrentProject({
      id: "project-2",
      worktree: "/workspace/project-2",
      name: "project-2",
    });
    mocked.appAgentsMock.mockResolvedValue(
      createAgentResponse([
        { name: "plan", mode: "primary" },
        { name: "orchestrator", mode: "primary" },
      ]),
    );

    const result = await sut.resolveProjectAgent("build");

    expect(result).toBe("plan");
  });

  it("normalizes an invalid stored agent when there is an active project without a session", async () => {
    mocked.setCurrentProject({
      id: "project-3",
      worktree: "/workspace/project-3",
      name: "project-3",
    });
    mocked.setCurrentAgent("nonexistent");
    mocked.appAgentsMock.mockResolvedValue(
      createAgentResponse([
        { name: "build", mode: "primary" },
        { name: "plan", mode: "primary" },
      ]),
    );

    const result = await sut.fetchCurrentAgent();

    expect(result).toBe("build");
    expect(mocked.setCurrentAgentMock).toHaveBeenCalledWith("build");
  });
});

describe("applyAgentConfiguredSettings", () => {
  beforeEach(() => {
    mocked.appAgentsMock.mockReset();
    mocked.selectModelMock.mockReset();
    mocked.setCurrentVariantMock.mockReset();
    mocked.getStoredModelMock.mockClear();
    mocked.getStoredModelMock.mockReturnValue({
      providerID: "stored-provider",
      modelID: "stored-model",
      variant: "high",
    });
    mocked.setCurrentProject({
      id: "project-1",
      worktree: "/workspace/project-1",
      name: "project-1",
    });
  });

  it("writes only the model and preserves the stored variant", async () => {
    mocked.appAgentsMock.mockResolvedValue(
      createAgentResponse([
        {
          name: "plan",
          mode: "primary",
          model: { providerID: "opencode-go", modelID: "kimi" },
        },
      ]),
    );

    const modelApplied = await applyAgentConfiguredSettings("plan");

    expect(modelApplied).toBe(true);
    expect(mocked.selectModelMock).toHaveBeenCalledWith({
      providerID: "opencode-go",
      modelID: "kimi",
      variant: "high",
    });
    expect(mocked.setCurrentVariantMock).not.toHaveBeenCalled();
  });

  it("writes only the variant and leaves the model", async () => {
    mocked.appAgentsMock.mockResolvedValue(
      createAgentResponse([
        {
          name: "plan",
          mode: "primary",
          variant: "low",
        },
      ]),
    );

    const modelApplied = await applyAgentConfiguredSettings("plan");

    expect(modelApplied).toBe(true);
    expect(mocked.selectModelMock).not.toHaveBeenCalled();
    expect(mocked.setCurrentVariantMock).toHaveBeenCalledWith("low");
  });

  it("writes both when the agent names model and variant", async () => {
    mocked.appAgentsMock.mockResolvedValue(
      createAgentResponse([
        {
          name: "plan",
          mode: "primary",
          model: { providerID: "opencode-go", modelID: "kimi" },
          variant: "max",
        },
      ]),
    );

    const modelApplied = await applyAgentConfiguredSettings("plan");

    expect(modelApplied).toBe(true);
    expect(mocked.selectModelMock).toHaveBeenCalledWith({
      providerID: "opencode-go",
      modelID: "kimi",
      variant: "max",
    });
    expect(mocked.setCurrentVariantMock).not.toHaveBeenCalled();
  });

  it("leaves setters untouched when the agent names neither", async () => {
    mocked.appAgentsMock.mockResolvedValue(
      createAgentResponse([{ name: "plan", mode: "primary" }]),
    );

    const modelApplied = await applyAgentConfiguredSettings("plan");

    expect(modelApplied).toBe(false);
    expect(mocked.selectModelMock).not.toHaveBeenCalled();
    expect(mocked.setCurrentVariantMock).not.toHaveBeenCalled();
  });

  it("leaves setters untouched when the listing fails", async () => {
    mocked.appAgentsMock.mockResolvedValue({ data: null, error: { message: "unavailable" } });

    const modelApplied = await applyAgentConfiguredSettings("plan");

    expect(modelApplied).toBe(false);
    expect(mocked.selectModelMock).not.toHaveBeenCalled();
    expect(mocked.setCurrentVariantMock).not.toHaveBeenCalled();
  });

  it("treats empty model provider or id as unset", async () => {
    mocked.appAgentsMock.mockResolvedValue(
      createAgentResponse([
        {
          name: "plan",
          mode: "primary",
          model: { providerID: "", modelID: "kimi" },
          variant: "low",
        },
      ]),
    );

    const modelApplied = await applyAgentConfiguredSettings("plan");

    expect(modelApplied).toBe(true);
    expect(mocked.selectModelMock).not.toHaveBeenCalled();
    expect(mocked.setCurrentVariantMock).toHaveBeenCalledWith("low");
  });

  it("treats an empty variant string as unset and does not overwrite the stored variant", async () => {
    mocked.appAgentsMock.mockResolvedValue(
      createAgentResponse([
        {
          name: "plan",
          mode: "primary",
          model: { providerID: "opencode-go", modelID: "kimi" },
          variant: "",
        },
      ]),
    );

    const modelApplied = await applyAgentConfiguredSettings("plan");

    expect(modelApplied).toBe(true);
    expect(mocked.selectModelMock).toHaveBeenCalledWith({
      providerID: "opencode-go",
      modelID: "kimi",
      variant: "high",
    });
    expect(mocked.setCurrentVariantMock).not.toHaveBeenCalled();
  });
});
