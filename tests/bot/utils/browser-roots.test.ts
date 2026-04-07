import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";

vi.mock("../../../src/utils/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  initBrowserRoots,
  getBrowserRoots,
  isWithinAllowedRoot,
  isAllowedRoot,
  __resetBrowserRootsForTests,
} from "../../../src/bot/utils/browser-roots.js";

describe("browser-roots", () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    __resetBrowserRootsForTests();
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
    __resetBrowserRootsForTests();
  });

  describe("initBrowserRoots", () => {
    it("should default to home directory when no env value is provided", () => {
      initBrowserRoots(undefined);
      const roots = getBrowserRoots();
      expect(roots).toHaveLength(1);
      expect(roots[0]).toBe(path.resolve(os.homedir()));
    });

    it("should default to home directory for empty string", () => {
      initBrowserRoots("");
      const roots = getBrowserRoots();
      expect(roots).toHaveLength(1);
    });

    it("should parse comma-separated paths", () => {
      initBrowserRoots("/home/user/projects,/opt/repos");
      const roots = getBrowserRoots();
      expect(roots).toHaveLength(2);
      expect(roots[0]).toBe(path.resolve("/home/user/projects"));
      expect(roots[1]).toBe(path.resolve("/opt/repos"));
    });

    it("should trim whitespace from entries", () => {
      initBrowserRoots("  /home/user/projects , /opt/repos  ");
      const roots = getBrowserRoots();
      expect(roots).toHaveLength(2);
    });

    it("should skip empty entries after splitting", () => {
      initBrowserRoots("/home/user/projects,,/opt/repos,");
      const roots = getBrowserRoots();
      expect(roots).toHaveLength(2);
    });

    it("should resolve relative paths", () => {
      initBrowserRoots("./relative-dir");
      const roots = getBrowserRoots();
      expect(roots[0]).toBe(path.resolve("./relative-dir"));
    });
  });

  describe("getBrowserRoots (lazy init)", () => {
    it("should lazily initialize from env when never explicitly called", () => {
      // Set env before calling getBrowserRoots
      process.env.OPEN_BROWSER_ROOTS = "/tmp/test-root";
      const roots = getBrowserRoots();
      expect(roots).toHaveLength(1);
      expect(roots[0]).toBe(path.resolve("/tmp/test-root"));
      delete process.env.OPEN_BROWSER_ROOTS;
    });
  });

  describe("isWithinAllowedRoot", () => {
    it("should return true for exact root path", () => {
      initBrowserRoots("/home/user/projects");
      expect(isWithinAllowedRoot("/home/user/projects")).toBe(true);
    });

    it("should return true for path inside root", () => {
      initBrowserRoots("/home/user/projects");
      expect(isWithinAllowedRoot("/home/user/projects/my-app")).toBe(true);
    });

    it("should return true for deeply nested path inside root", () => {
      initBrowserRoots("/home/user/projects");
      expect(isWithinAllowedRoot("/home/user/projects/a/b/c/d")).toBe(true);
    });

    it("should return false for path outside root", () => {
      initBrowserRoots("/home/user/projects");
      expect(isWithinAllowedRoot("/home/user/documents")).toBe(false);
    });

    it("should return false for parent of root", () => {
      initBrowserRoots("/home/user/projects");
      expect(isWithinAllowedRoot("/home/user")).toBe(false);
    });

    it("should return false for path that shares a prefix but is not a descendant", () => {
      initBrowserRoots("/home/user/projects");
      // /home/user/projects-backup is NOT inside /home/user/projects
      expect(isWithinAllowedRoot("/home/user/projects-backup")).toBe(false);
    });

    it("should work with multiple roots", () => {
      initBrowserRoots("/home/user/projects,/opt/repos");
      expect(isWithinAllowedRoot("/home/user/projects/app")).toBe(true);
      expect(isWithinAllowedRoot("/opt/repos/lib")).toBe(true);
      expect(isWithinAllowedRoot("/etc/config")).toBe(false);
    });

    it("should match case-insensitively on Windows", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      __resetBrowserRootsForTests();
      // Use forward-slash paths so path.resolve works on all test platforms
      initBrowserRoots("/home/User/Projects");
      expect(isWithinAllowedRoot("/home/user/projects/my-app")).toBe(true);
      expect(isWithinAllowedRoot("/HOME/USER/PROJECTS")).toBe(true);
    });

    it("should match case-sensitively on non-Windows", () => {
      Object.defineProperty(process, "platform", { value: "linux" });
      __resetBrowserRootsForTests();
      initBrowserRoots("/home/User/Projects");
      expect(isWithinAllowedRoot("/home/User/Projects/app")).toBe(true);
      expect(isWithinAllowedRoot("/home/user/projects/app")).toBe(false);
    });
  });

  describe("isAllowedRoot", () => {
    it("should return true for exact root match", () => {
      initBrowserRoots("/home/user/projects,/opt/repos");
      expect(isAllowedRoot("/home/user/projects")).toBe(true);
      expect(isAllowedRoot("/opt/repos")).toBe(true);
    });

    it("should return false for child of root", () => {
      initBrowserRoots("/home/user/projects");
      expect(isAllowedRoot("/home/user/projects/child")).toBe(false);
    });

    it("should return false for parent of root", () => {
      initBrowserRoots("/home/user/projects");
      expect(isAllowedRoot("/home/user")).toBe(false);
    });
  });
});
