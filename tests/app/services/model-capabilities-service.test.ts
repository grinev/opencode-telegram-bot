import { describe, expect, it } from "vitest";
import { supportsInput, supportsAttachment } from "../../../src/app/services/model-capabilities-service.js";
import type { ModelV2Info } from "@opencode-ai/sdk/v2";

type Caps = ModelV2Info["capabilities"];

describe("model/capabilities", () => {
  describe("supportsInput", () => {
    it("returns true when model supports image input", () => {
      const capabilities: Caps = {
        tools: true,
        input: ["text", "image"],
        output: ["text"],
      };

      expect(supportsInput(capabilities, "image")).toBe(true);
    });

    it("returns false when model does not support image input", () => {
      const capabilities: Caps = {
        tools: true,
        input: ["text"],
        output: ["text"],
      };

      expect(supportsInput(capabilities, "image")).toBe(false);
    });

    it("returns true when model supports PDF input", () => {
      const capabilities: Caps = {
        tools: true,
        input: ["text", "image", "pdf"],
        output: ["text"],
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
      const capabilities: Caps = {
        tools: true,
        input: ["text", "audio", "image", "video", "pdf"],
        output: ["text"],
      };

      expect(supportsInput(capabilities, "image")).toBe(true);
      expect(supportsInput(capabilities, "pdf")).toBe(true);
      expect(supportsInput(capabilities, "audio")).toBe(true);
      expect(supportsInput(capabilities, "video")).toBe(true);
    });
  });

  describe("supportsAttachment", () => {
    it("returns true when model supports attachments", () => {
      const capabilities: Caps = {
        tools: true,
        input: ["text", "image"],
        output: ["text"],
      };

      expect(supportsAttachment(capabilities)).toBe(true);
    });

    it("returns false when model does not support attachments", () => {
      const capabilities: Caps = {
        tools: false,
        input: [],
        output: ["text"],
      };

      expect(supportsAttachment(capabilities)).toBe(false);
    });

    it("returns false when capabilities is null", () => {
      expect(supportsAttachment(null)).toBe(false);
    });
  });
});
