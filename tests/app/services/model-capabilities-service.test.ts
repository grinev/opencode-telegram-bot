import { describe, expect, it } from "vitest";
import { supportsInput, supportsAttachment } from "../../../src/app/services/model-capabilities-service.js";
import type { Model } from "@opencode-ai/sdk/v2";

describe("model/capabilities", () => {
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
