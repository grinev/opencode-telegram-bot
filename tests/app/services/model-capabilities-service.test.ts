import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Model } from "@opencode-ai/sdk/v2";

const { providersMock } = vi.hoisted(() => ({
  providersMock: vi.fn(),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    config: {
      providers: providersMock,
    },
  },
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  __resetModelCapabilitiesCacheForTests,
  getModelCapabilities,
  supportsInput,
  supportsAttachment,
} from "../../../src/app/services/model-capabilities-service.js";

const VISION_CAPABILITIES: Model["capabilities"] = {
  temperature: true,
  reasoning: false,
  attachment: true,
  toolcall: true,
  input: { text: true, audio: false, image: true, video: false, pdf: true },
  output: { text: true, audio: false, image: false, video: false, pdf: false },
  interleaved: false,
};

function createProvidersResponse(modelsByProvider: Record<string, string[]>) {
  return {
    data: {
      providers: Object.entries(modelsByProvider).map(([id, modelIDs]) => ({
        id,
        models: Object.fromEntries(
          modelIDs.map((modelID) => [modelID, { id: modelID, capabilities: VISION_CAPABILITIES }]),
        ),
      })),
    },
    error: null,
  };
}

describe("model/capabilities", () => {
  describe("getModelCapabilities", () => {
    beforeEach(() => {
      __resetModelCapabilitiesCacheForTests();
      providersMock.mockReset();
      providersMock.mockResolvedValue(createProvidersResponse({ openai: ["gpt-4o"] }));
    });

    it("returns and caches the capabilities of a listed model", async () => {
      await expect(getModelCapabilities("openai", "gpt-4o")).resolves.toEqual(VISION_CAPABILITIES);
      await expect(getModelCapabilities("openai", "gpt-4o")).resolves.toEqual(VISION_CAPABILITIES);

      expect(providersMock).toHaveBeenCalledTimes(1);
    });

    it("remembers a model a non-empty list does not name as unsupported", async () => {
      await expect(getModelCapabilities("openai", "retired")).resolves.toBeNull();
      await expect(getModelCapabilities("openai", "retired")).resolves.toBeNull();

      expect(providersMock).toHaveBeenCalledTimes(1);
    });

    it("does not remember an empty providers list", async () => {
      providersMock.mockResolvedValueOnce(createProvidersResponse({}));

      await expect(getModelCapabilities("openai", "gpt-4o")).resolves.toBeNull();
      await expect(getModelCapabilities("openai", "gpt-4o")).resolves.toEqual(VISION_CAPABILITIES);

      expect(providersMock).toHaveBeenCalledTimes(2);
    });

    it("does not remember a failed read", async () => {
      providersMock.mockResolvedValueOnce({ data: null, error: new TypeError("fetch failed") });

      await expect(getModelCapabilities("openai", "gpt-4o")).resolves.toBeNull();
      await expect(getModelCapabilities("openai", "gpt-4o")).resolves.toEqual(VISION_CAPABILITIES);
    });

    it("does not remember a thrown error", async () => {
      providersMock.mockRejectedValueOnce(new TypeError("fetch failed"));

      await expect(getModelCapabilities("openai", "gpt-4o")).resolves.toBeNull();
      await expect(getModelCapabilities("openai", "gpt-4o")).resolves.toEqual(VISION_CAPABILITIES);
    });
  });

  describe("supportsInput", () => {
    it("returns true when model supports image input", () => {
      const capabilities: Model["capabilities"] = {
        temperature: true,
        reasoning: false,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      };

      expect(supportsInput(capabilities, "image")).toBe(true);
    });

    it("returns false when model does not support image input", () => {
      const capabilities: Model["capabilities"] = {
        temperature: true,
        reasoning: false,
        attachment: false,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      };

      expect(supportsInput(capabilities, "image")).toBe(false);
    });

    it("returns true when model supports PDF input", () => {
      const capabilities: Model["capabilities"] = {
        temperature: true,
        reasoning: false,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: true },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      };

      expect(supportsInput(capabilities, "pdf")).toBe(true);
    });

    it("returns false when capabilities is null", () => {
      expect(supportsInput(null, "image")).toBe(false);
      expect(supportsInput(null, "pdf")).toBe(false);
      expect(supportsInput(null, "audio")).toBe(false);
      expect(supportsInput(null, "video")).toBe(false);
    });

    it("checks all input types", () => {
      const capabilities: Model["capabilities"] = {
        temperature: true,
        reasoning: false,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: true, image: true, video: true, pdf: true },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      };

      expect(supportsInput(capabilities, "image")).toBe(true);
      expect(supportsInput(capabilities, "pdf")).toBe(true);
      expect(supportsInput(capabilities, "audio")).toBe(true);
      expect(supportsInput(capabilities, "video")).toBe(true);
    });
  });

  describe("supportsAttachment", () => {
    it("returns true when model supports attachments", () => {
      const capabilities: Model["capabilities"] = {
        temperature: true,
        reasoning: false,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      };

      expect(supportsAttachment(capabilities)).toBe(true);
    });

    it("returns false when model does not support attachments", () => {
      const capabilities: Model["capabilities"] = {
        temperature: true,
        reasoning: false,
        attachment: false,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      };

      expect(supportsAttachment(capabilities)).toBe(false);
    });

    it("returns false when capabilities is null", () => {
      expect(supportsAttachment(null)).toBe(false);
    });
  });
});
