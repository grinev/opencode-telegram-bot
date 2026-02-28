import { describe, expect, it } from "vitest";
import {
  calculateProjectsPaginationRange,
  buildProjectButtonLabel,
  getProjectFolderName,
  parseProjectPageCallback,
} from "../../../src/bot/commands/projects.js";

describe("bot/commands/projects", () => {
  describe("getProjectFolderName", () => {
    it("extracts folder name from unix path", () => {
      expect(getProjectFolderName("/Users/evan/work/opencode-telegram-bot")).toBe(
        "opencode-telegram-bot",
      );
    });

    it("extracts folder name from windows path", () => {
      expect(getProjectFolderName("C:\\work\\my-project")).toBe("my-project");
    });

    it("handles trailing separators", () => {
      expect(getProjectFolderName("/var/www/project/")).toBe("project");
      expect(getProjectFolderName("C:\\repo\\project\\")).toBe("project");
    });
  });

  describe("buildProjectButtonLabel", () => {
    it("formats label as index + folder + full path", () => {
      expect(buildProjectButtonLabel(0, "/Users/evan/work/opencode-telegram-bot")).toBe(
        "1. opencode-telegram-bot [/Users/evan/work/opencode-telegram-bot]",
      );
    });

    it("formats windows path label", () => {
      expect(buildProjectButtonLabel(3, "D:\\repo\\awesome")).toBe(
        "4. awesome [D:\\repo\\awesome]",
      );
    });
  });

  describe("parseProjectPageCallback", () => {
    it("parses valid page callbacks", () => {
      expect(parseProjectPageCallback("projects:page:0")).toBe(0);
      expect(parseProjectPageCallback("projects:page:12")).toBe(12);
    });

    it("returns null for non-page callbacks", () => {
      expect(parseProjectPageCallback("project:abc")).toBeNull();
      expect(parseProjectPageCallback("projects:page:-1")).toBeNull();
      expect(parseProjectPageCallback("projects:page:abc")).toBeNull();
    });
  });

  describe("calculateProjectsPaginationRange", () => {
    it("returns first page bounds", () => {
      expect(calculateProjectsPaginationRange(25, 0, 10)).toEqual({
        page: 0,
        totalPages: 3,
        startIndex: 0,
        endIndex: 10,
      });
    });

    it("clamps page to the last page", () => {
      expect(calculateProjectsPaginationRange(25, 99, 10)).toEqual({
        page: 2,
        totalPages: 3,
        startIndex: 20,
        endIndex: 25,
      });
    });

    it("handles empty projects list safely", () => {
      expect(calculateProjectsPaginationRange(0, 0, 10)).toEqual({
        page: 0,
        totalPages: 1,
        startIndex: 0,
        endIndex: 0,
      });
    });

    it("applies < pageSize boundary semantics using provided pageSize (not fixed 10)", () => {
      expect(calculateProjectsPaginationRange(6, 0, 7)).toEqual({
        page: 0,
        totalPages: 1,
        startIndex: 0,
        endIndex: 6,
      });
    });

    it("applies == pageSize boundary semantics using provided pageSize (single full page)", () => {
      expect(calculateProjectsPaginationRange(7, 99, 7)).toEqual({
        page: 0,
        totalPages: 1,
        startIndex: 0,
        endIndex: 7,
      });
    });

    it("applies > pageSize boundary semantics using provided pageSize with overflow on next page", () => {
      expect(calculateProjectsPaginationRange(8, 0, 7)).toEqual({
        page: 0,
        totalPages: 2,
        startIndex: 0,
        endIndex: 7,
      });

      expect(calculateProjectsPaginationRange(8, 1, 7)).toEqual({
        page: 1,
        totalPages: 2,
        startIndex: 7,
        endIndex: 8,
      });
    });
  });
});
