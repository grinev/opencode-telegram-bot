import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  configMock,
  providersMock,
  sessionMessagesMock,
  getCurrentModelMock,
  setCurrentModelMock,
  getCurrentProjectMock,
  getCurrentSessionMock,
  setCurrentModelState,
  getCurrentModelState,
  setCurrentProjectState,
  setCurrentSessionState,
  resetCurrentModelState,
  loggerInfoMock,
  loggerWarnMock,
  loggerErrorMock,
  loggerDebugMock,
} = vi.hoisted(() => {
  let currentModel: { providerID: string; modelID: string; variant?: string } | undefined;
  let currentProject: { name: string; path: string; worktree: string } | undefined;
  let currentSession: { id: string; title: string; directory: string } | null | undefined;

  const getCurrentModelMock = vi.fn(() => currentModel);
  const getCurrentProjectMock = vi.fn(() => currentProject);
  const getCurrentSessionMock = vi.fn(() => currentSession);
  const setCurrentModelMock = vi.fn(
    (modelInfo: { providerID: string; modelID: string; variant?: string }) => {
      currentModel = modelInfo;
    },
  );

  return {
    configMock: {
      opencode: {
        model: {
          provider: "opencode",
          modelId: "big-pickle",
        },
      },
    },
    providersMock: vi.fn(),
    sessionMessagesMock: vi.fn(),
    getCurrentModelMock,
    setCurrentModelMock,
    getCurrentProjectMock,
    getCurrentSessionMock,
    setCurrentModelState: (modelInfo?: {
      providerID: string;
      modelID: string;
      variant?: string;
    }) => {
      currentModel = modelInfo;
    },
    getCurrentModelState: () => currentModel,
    setCurrentProjectState: (project?: { name: string; path: string; worktree: string }) => {
      currentProject = project;
    },
    setCurrentSessionState: (session?: { id: string; title: string; directory: string } | null) => {
      currentSession = session;
    },
    resetCurrentModelState: () => {
      currentModel = undefined;
      currentProject = undefined;
      currentSession = undefined;
      getCurrentModelMock.mockClear();
      setCurrentModelMock.mockClear();
      getCurrentProjectMock.mockClear();
      getCurrentSessionMock.mockClear();
    },
    loggerInfoMock: vi.fn(),
    loggerWarnMock: vi.fn(),
    loggerErrorMock: vi.fn(),
    loggerDebugMock: vi.fn(),
  };
});

vi.mock("../../src/config.js", () => ({
  config: configMock,
}));

vi.mock("../../src/opencode/client.js", () => ({
  opencodeClient: {
    config: {
      providers: providersMock,
    },
    session: {
      messages: sessionMessagesMock,
    },
  },
}));

vi.mock("../../src/settings/manager.js", () => ({
  getCurrentModel: getCurrentModelMock,
  getCurrentProject: getCurrentProjectMock,
  getCurrentSession: getCurrentSessionMock,
  setCurrentModel: setCurrentModelMock,
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    info: loggerInfoMock,
    warn: loggerWarnMock,
    error: loggerErrorMock,
    debug: loggerDebugMock,
  },
}));

import {
  __resetModelCatalogCacheForTests,
  fetchCurrentModelFromSession,
  getFavoriteModels,
  getModelSelectionLists,
  reconcileStoredModelSelection,
} from "../../src/model/manager.js";

function createProvidersResponse(modelsByProvider: Record<string, string[]>) {
  return {
    data: {
      providers: Object.entries(modelsByProvider).map(([providerID, modelIDs]) => ({
        id: providerID,
        models: Object.fromEntries(modelIDs.map((modelID) => [modelID, { id: modelID }])),
      })),
    },
    error: null,
  };
}

function createSessionMessagesResponse(providerID: string, modelID: string) {
  return {
    data: [
      {
        info: {
          providerID,
          modelID,
        },
      },
    ],
    error: null,
  };
}

describe("model/manager", () => {
  let tempDir = "";
  let originalXdgStateHome: string | undefined;
  let originalHome: string | undefined;

  beforeEach(() => {
    originalXdgStateHome = process.env.XDG_STATE_HOME;
    originalHome = process.env.HOME;

    vi.useRealTimers();
    resetCurrentModelState();
    __resetModelCatalogCacheForTests();

    loggerInfoMock.mockReset();
    loggerWarnMock.mockReset();
    loggerErrorMock.mockReset();
    loggerDebugMock.mockReset();

    providersMock.mockReset();
    sessionMessagesMock.mockReset();
    providersMock.mockResolvedValue(
      createProvidersResponse({
        opencode: ["big-pickle"],
        openai: ["gpt-4o", "gpt-3.5"],
        anthropic: ["claude-sonnet"],
        google: ["gemini-pro"],
      }),
    );
  });

  afterEach(async () => {
    process.env.XDG_STATE_HOME = originalXdgStateHome;
    process.env.HOME = originalHome;
    vi.useRealTimers();

    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  async function setupMockModelFile(content: object): Promise<string> {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "opencode-model-test-"));
    const opencodeDir = path.join(tempDir, "opencode");
    await mkdir(opencodeDir, { recursive: true });
    const modelFilePath = path.join(opencodeDir, "model.json");
    await writeFile(modelFilePath, JSON.stringify(content), "utf-8");
    process.env.XDG_STATE_HOME = tempDir;
    return modelFilePath;
  }

  describe("getModelSelectionLists", () => {
    it("returns favorites and recent from model.json", async () => {
      await setupMockModelFile({
        favorite: [
          { providerID: "openai", modelID: "gpt-4o" },
          { providerID: "anthropic", modelID: "claude-sonnet" },
        ],
        recent: [
          { providerID: "google", modelID: "gemini-pro" },
          { providerID: "openai", modelID: "gpt-3.5" },
        ],
      });

      const result = await getModelSelectionLists();

      expect(result.favorites).toHaveLength(3); // 2 from file + 1 default
      expect(result.favorites).toContainEqual({ providerID: "openai", modelID: "gpt-4o" });
      expect(result.favorites).toContainEqual({
        providerID: "anthropic",
        modelID: "claude-sonnet",
      });
      expect(result.favorites).toContainEqual({ providerID: "opencode", modelID: "big-pickle" });

      expect(result.recent).toHaveLength(2);
      expect(result.recent).toContainEqual({ providerID: "google", modelID: "gemini-pro" });
      expect(result.recent).toContainEqual({ providerID: "openai", modelID: "gpt-3.5" });
    });

    it("deduplicates models with same provider/model combination", async () => {
      await setupMockModelFile({
        favorite: [
          { providerID: "openai", modelID: "gpt-4o" },
          { providerID: "openai", modelID: "gpt-4o" }, // duplicate
          { providerID: "anthropic", modelID: "claude-sonnet" },
        ],
        recent: [],
      });

      const result = await getModelSelectionLists();

      expect(result.favorites).toHaveLength(3); // 2 unique from file + 1 default
      const openaiGpt4oCount = result.favorites.filter(
        (m) => m.providerID === "openai" && m.modelID === "gpt-4o",
      ).length;
      expect(openaiGpt4oCount).toBe(1);
    });

    it("does not include recent models that are already in favorites", async () => {
      await setupMockModelFile({
        favorite: [
          { providerID: "openai", modelID: "gpt-4o" },
          { providerID: "anthropic", modelID: "claude-sonnet" },
        ],
        recent: [
          { providerID: "openai", modelID: "gpt-4o" }, // duplicate of favorite
          { providerID: "google", modelID: "gemini-pro" }, // unique
        ],
      });

      const result = await getModelSelectionLists();

      expect(result.favorites).toContainEqual({ providerID: "openai", modelID: "gpt-4o" });
      expect(result.recent).not.toContainEqual({ providerID: "openai", modelID: "gpt-4o" });
      expect(result.recent).toContainEqual({ providerID: "google", modelID: "gemini-pro" });
    });

    it("falls back to config model when model.json does not exist", async () => {
      // Set XDG_STATE_HOME to a non-existent directory
      tempDir = await mkdtemp(path.join(os.tmpdir(), "opencode-model-test-"));
      process.env.XDG_STATE_HOME = path.join(tempDir, "nonexistent");

      const result = await getModelSelectionLists();

      expect(result.favorites).toHaveLength(1);
      expect(result.favorites[0]).toEqual({ providerID: "opencode", modelID: "big-pickle" });
      expect(result.recent).toHaveLength(0);
    });

    it("returns empty lists when file does not exist and no config model", async () => {
      tempDir = await mkdtemp(path.join(os.tmpdir(), "opencode-model-test-"));
      process.env.XDG_STATE_HOME = path.join(tempDir, "nonexistent");
      configMock.opencode.model.provider = "";
      configMock.opencode.model.modelId = "";

      const result = await getModelSelectionLists();

      expect(result.favorites).toHaveLength(0);
      expect(result.recent).toHaveLength(0);

      // Restore config
      configMock.opencode.model.provider = "opencode";
      configMock.opencode.model.modelId = "big-pickle";
    });

    it("handles missing recent array gracefully", async () => {
      await setupMockModelFile({
        favorite: [{ providerID: "openai", modelID: "gpt-4o" }],
        // no recent field
      });

      const result = await getModelSelectionLists();

      expect(result.favorites).toHaveLength(2); // 1 from file + 1 default
      expect(result.recent).toHaveLength(0);
    });

    it("handles missing favorite array gracefully", async () => {
      await setupMockModelFile({
        // no favorite field
        recent: [{ providerID: "openai", modelID: "gpt-4o" }],
      });

      const result = await getModelSelectionLists();

      expect(result.favorites).toHaveLength(1); // just default
      expect(result.recent).toHaveLength(1);
      expect(result.recent[0]).toEqual({ providerID: "openai", modelID: "gpt-4o" });
    });

    it("filters out invalid model entries with missing providerID", async () => {
      await setupMockModelFile({
        favorite: [
          { providerID: "openai", modelID: "gpt-4o" },
          { providerID: "", modelID: "invalid-model" },
          { modelID: "no-provider" }, // missing providerID
        ],
        recent: [],
      });

      const result = await getModelSelectionLists();

      expect(result.favorites).toHaveLength(2); // 1 valid from file + 1 default
      expect(result.favorites).toContainEqual({ providerID: "openai", modelID: "gpt-4o" });
      expect(result.favorites).toContainEqual({ providerID: "opencode", modelID: "big-pickle" });
    });

    it("filters out invalid model entries with missing modelID", async () => {
      await setupMockModelFile({
        favorite: [
          { providerID: "openai", modelID: "gpt-4o" },
          { providerID: "anthropic", modelID: "" },
          { providerID: "no-model" }, // missing modelID
        ],
        recent: [],
      });

      const result = await getModelSelectionLists();

      expect(result.favorites).toHaveLength(2); // 1 valid from file + 1 default
      expect(result.favorites).toContainEqual({ providerID: "openai", modelID: "gpt-4o" });
    });

    it("deduplicates default config model when already in favorites", async () => {
      // configMock has opencode/big-pickle as default
      await setupMockModelFile({
        favorite: [
          { providerID: "opencode", modelID: "big-pickle" }, // same as default
          { providerID: "openai", modelID: "gpt-4o" },
        ],
        recent: [],
      });

      const result = await getModelSelectionLists();

      expect(result.favorites).toHaveLength(2); // should not duplicate the default
      const opencodeBigPickleCount = result.favorites.filter(
        (m) => m.providerID === "opencode" && m.modelID === "big-pickle",
      ).length;
      expect(opencodeBigPickleCount).toBe(1);
    });

    it("deduplicates recent models", async () => {
      await setupMockModelFile({
        favorite: [],
        recent: [
          { providerID: "openai", modelID: "gpt-4o" },
          { providerID: "openai", modelID: "gpt-4o" }, // duplicate
          { providerID: "google", modelID: "gemini-pro" },
        ],
      });

      const result = await getModelSelectionLists();

      expect(result.recent).toHaveLength(2);
      expect(result.recent).toContainEqual({ providerID: "openai", modelID: "gpt-4o" });
      expect(result.recent).toContainEqual({ providerID: "google", modelID: "gemini-pro" });
    });

    it("filters out models that are not present in provider catalog", async () => {
      await setupMockModelFile({
        favorite: [
          { providerID: "openai", modelID: "gpt-4o" },
          { providerID: "openai", modelID: "missing-favorite" },
        ],
        recent: [
          { providerID: "google", modelID: "gemini-pro" },
          { providerID: "google", modelID: "missing-recent" },
        ],
      });

      const result = await getModelSelectionLists();

      expect(result.favorites).toContainEqual({ providerID: "openai", modelID: "gpt-4o" });
      expect(result.favorites).toContainEqual({ providerID: "opencode", modelID: "big-pickle" });
      expect(result.favorites).not.toContainEqual({
        providerID: "openai",
        modelID: "missing-favorite",
      });

      expect(result.recent).toContainEqual({ providerID: "google", modelID: "gemini-pro" });
      expect(result.recent).not.toContainEqual({
        providerID: "google",
        modelID: "missing-recent",
      });
    });

    it("uses model catalog cache between repeated calls", async () => {
      await setupMockModelFile({
        favorite: [{ providerID: "openai", modelID: "gpt-4o" }],
        recent: [{ providerID: "google", modelID: "gemini-pro" }],
      });

      await getModelSelectionLists();
      await getModelSelectionLists();

      expect(providersMock).toHaveBeenCalledTimes(1);
    });

    it("falls back to stale model catalog cache when refresh fails", async () => {
      const startTime = new Date("2026-01-01T00:00:00.000Z");
      vi.useFakeTimers();
      vi.setSystemTime(startTime);

      await setupMockModelFile({
        favorite: [
          { providerID: "openai", modelID: "gpt-4o" },
          { providerID: "openai", modelID: "retired" },
        ],
        recent: [{ providerID: "google", modelID: "gemini-pro" }],
      });

      const first = await getModelSelectionLists();
      expect(first.favorites).toContainEqual({ providerID: "openai", modelID: "gpt-4o" });
      expect(first.favorites).not.toContainEqual({ providerID: "openai", modelID: "retired" });

      providersMock.mockResolvedValueOnce({ data: null, error: new Error("upstream unavailable") });
      vi.setSystemTime(new Date(startTime.getTime() + 11 * 60 * 1000));

      const second = await getModelSelectionLists();

      expect(providersMock).toHaveBeenCalledTimes(2);
      expect(second.favorites).toContainEqual({ providerID: "openai", modelID: "gpt-4o" });
      expect(second.favorites).not.toContainEqual({ providerID: "openai", modelID: "retired" });
    });
  });

  describe("getFavoriteModels", () => {
    it("returns only favorites from getModelSelectionLists", async () => {
      await setupMockModelFile({
        favorite: [{ providerID: "openai", modelID: "gpt-4o" }],
        recent: [{ providerID: "google", modelID: "gemini-pro" }],
      });

      const favorites = await getFavoriteModels();

      expect(favorites).toHaveLength(2); // 1 from file + 1 default
      expect(favorites).toContainEqual({ providerID: "openai", modelID: "gpt-4o" });
      expect(favorites).toContainEqual({ providerID: "opencode", modelID: "big-pickle" });
      // recent models should not be in favorites
      expect(favorites).not.toContainEqual({ providerID: "google", modelID: "gemini-pro" });
    });
  });

  describe("reconcileStoredModelSelection", () => {
    it("logs a short warning without stack when OpenCode server is unavailable", async () => {
      setCurrentModelState({ providerID: "openai", modelID: "gpt-4o", variant: "high" });
      providersMock.mockResolvedValueOnce({ data: null, error: new TypeError("fetch failed") });

      await reconcileStoredModelSelection();

      expect(loggerWarnMock).toHaveBeenCalledWith(
        "[ModelManager] OpenCode server is not running; skipping model catalog refresh",
      );
      expect(loggerWarnMock).not.toHaveBeenCalledWith(
        "[ModelManager] Failed to refresh model catalog:",
        expect.any(Error),
      );
      expect(loggerWarnMock).toHaveBeenCalledWith(
        "[ModelManager] Skipping stored model validation: model catalog unavailable",
      );
      expect(setCurrentModelMock).not.toHaveBeenCalled();
    });

    it("forces model catalog refresh when requested", async () => {
      setCurrentModelState({ providerID: "openai", modelID: "gpt-4o", variant: "high" });

      await reconcileStoredModelSelection();
      await reconcileStoredModelSelection({ forceCatalogRefresh: true });

      expect(providersMock).toHaveBeenCalledTimes(2);
    });

    it("falls back to env default when stored model is unavailable", async () => {
      setCurrentModelState({ providerID: "openai", modelID: "retired", variant: "high" });

      await reconcileStoredModelSelection();

      expect(getCurrentModelState()).toEqual({
        providerID: "opencode",
        modelID: "big-pickle",
        variant: "default",
      });
      expect(setCurrentModelMock).toHaveBeenCalledTimes(1);
    });

    it("keeps stored model when it is available", async () => {
      setCurrentModelState({ providerID: "openai", modelID: "gpt-4o", variant: "high" });

      await reconcileStoredModelSelection();

      expect(getCurrentModelState()).toEqual({
        providerID: "openai",
        modelID: "gpt-4o",
        variant: "high",
      });
      expect(setCurrentModelMock).not.toHaveBeenCalled();
    });
  });

  describe("fetchCurrentModelFromSession", () => {
    const storedModel = { providerID: "openai", modelID: "gpt-4o", variant: "high" };

    function setActiveSessionContext() {
      setCurrentProjectState({ name: "test", path: "/test", worktree: "/test" });
      setCurrentSessionState({ id: "test-session", title: "Test", directory: "/test" });
    }

    it("returns stored model when no active session", async () => {
      setCurrentModelState(storedModel);
      setCurrentProjectState({ name: "test", path: "/test", worktree: "/test" });
      setCurrentSessionState(null);

      const result = await fetchCurrentModelFromSession();

      expect(result).toEqual(storedModel);
      expect(sessionMessagesMock).not.toHaveBeenCalled();
      expect(setCurrentModelMock).not.toHaveBeenCalled();
    });

    it("returns stored model when no active project", async () => {
      setCurrentModelState(storedModel);
      setCurrentSessionState({ id: "test-session", title: "Test", directory: "/test" });
      setCurrentProjectState(undefined);

      const result = await fetchCurrentModelFromSession();

      expect(result).toEqual(storedModel);
      expect(sessionMessagesMock).not.toHaveBeenCalled();
      expect(setCurrentModelMock).not.toHaveBeenCalled();
    });

    it("returns stored model when session messages API returns error", async () => {
      setCurrentModelState(storedModel);
      setActiveSessionContext();
      sessionMessagesMock.mockResolvedValueOnce({ data: null, error: new Error("failed") });

      const result = await fetchCurrentModelFromSession();

      expect(result).toEqual(storedModel);
      expect(sessionMessagesMock).toHaveBeenCalledWith({
        sessionID: "test-session",
        directory: "/test",
        limit: 1,
      });
      expect(setCurrentModelMock).not.toHaveBeenCalled();
    });

    it("returns stored model when session has no messages", async () => {
      setCurrentModelState(storedModel);
      setActiveSessionContext();
      sessionMessagesMock.mockResolvedValueOnce({ data: [], error: null });

      const result = await fetchCurrentModelFromSession();

      expect(result).toEqual(storedModel);
      expect(setCurrentModelMock).not.toHaveBeenCalled();
    });

    it("returns stored model when message has no model info", async () => {
      setCurrentModelState(storedModel);
      setActiveSessionContext();
      sessionMessagesMock.mockResolvedValueOnce(createSessionMessagesResponse("", ""));

      const result = await fetchCurrentModelFromSession();

      expect(result).toEqual(storedModel);
      expect(setCurrentModelMock).not.toHaveBeenCalled();
    });

    it("returns stored model when it matches session model", async () => {
      setCurrentModelState(storedModel);
      setActiveSessionContext();
      sessionMessagesMock.mockResolvedValueOnce(
        createSessionMessagesResponse(storedModel.providerID, storedModel.modelID),
      );

      const result = await fetchCurrentModelFromSession();

      expect(result).toEqual(storedModel);
      expect(setCurrentModelMock).not.toHaveBeenCalled();
    });

    it("syncs model from session when different from stored", async () => {
      setCurrentModelState(storedModel);
      setActiveSessionContext();
      sessionMessagesMock.mockResolvedValueOnce(
        createSessionMessagesResponse("anthropic", "claude-sonnet"),
      );

      const result = await fetchCurrentModelFromSession();

      expect(result).toEqual({
        providerID: "anthropic",
        modelID: "claude-sonnet",
        variant: "high",
      });
      expect(setCurrentModelMock).toHaveBeenCalledWith({
        providerID: "anthropic",
        modelID: "claude-sonnet",
        variant: "high",
      });
    });

    it("preserves stored variant when syncing from session", async () => {
      setCurrentModelState({ providerID: "openai", modelID: "gpt-4o", variant: "low" });
      setActiveSessionContext();
      sessionMessagesMock.mockResolvedValueOnce(createSessionMessagesResponse("google", "gemini-pro"));

      const result = await fetchCurrentModelFromSession();

      expect(result).toEqual({ providerID: "google", modelID: "gemini-pro", variant: "low" });
      expect(setCurrentModelMock).toHaveBeenCalledWith({
        providerID: "google",
        modelID: "gemini-pro",
        variant: "low",
      });
    });

    it("returns stored model on API exception", async () => {
      setCurrentModelState(storedModel);
      setActiveSessionContext();
      sessionMessagesMock.mockRejectedValueOnce(new Error("network down"));

      const result = await fetchCurrentModelFromSession();

      expect(result).toEqual(storedModel);
      expect(setCurrentModelMock).not.toHaveBeenCalled();
      expect(loggerErrorMock).toHaveBeenCalledWith(
        "[ModelManager] Error fetching model from session:",
        expect.any(Error),
      );
    });
  });
});
