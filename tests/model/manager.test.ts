import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { configMock } = vi.hoisted(() => ({
  configMock: {
    opencode: {
      model: {
        provider: "opencode",
        modelId: "big-pickle",
      },
    },
  },
}));

vi.mock("../../src/config.js", () => ({
  config: configMock,
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { getModelSelectionLists, getFavoriteModels } from "../../src/model/manager.js";

describe("model/manager", () => {
  let tempDir = "";
  let originalXdgStateHome: string | undefined;
  let originalHome: string | undefined;

  beforeEach(() => {
    originalXdgStateHome = process.env.XDG_STATE_HOME;
    originalHome = process.env.HOME;
  });

  afterEach(async () => {
    process.env.XDG_STATE_HOME = originalXdgStateHome;
    process.env.HOME = originalHome;

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
});
