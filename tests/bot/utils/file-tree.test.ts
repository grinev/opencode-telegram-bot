import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import {
  getHomeDirectory,
  pathToDisplayPath,
  scanDirectory,
  buildEntryLabel,
  buildTreeHeader,
  isScanError,
  MAX_ENTRIES_PER_PAGE,
} from "../../../src/bot/utils/file-tree.js";

vi.mock("../../../src/utils/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("file-tree", () => {
  describe("getHomeDirectory", () => {
    it("should return os.homedir()", () => {
      expect(getHomeDirectory()).toBe(os.homedir());
    });
  });

  describe("pathToDisplayPath", () => {
    it("should replace home directory with ~", () => {
      const home = os.homedir();
      expect(pathToDisplayPath(home)).toBe("~");
    });

    it("should replace home prefix with ~", () => {
      const home = os.homedir();
      const subdir = path.join(home, "projects", "my-app");
      const result = pathToDisplayPath(subdir);
      expect(result).toBe(`~${path.sep}projects${path.sep}my-app`);
    });

    it("should return absolute path unchanged if not under home", () => {
      expect(pathToDisplayPath("/tmp/something")).toBe("/tmp/something");
    });
  });

  describe("scanDirectory", () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await mkdtemp(path.join(os.tmpdir(), "file-tree-test-"));
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it("should list subdirectories sorted alphabetically", async () => {
      await mkdir(path.join(tempDir, "charlie"));
      await mkdir(path.join(tempDir, "alpha"));
      await mkdir(path.join(tempDir, "bravo"));

      const result = await scanDirectory(tempDir);
      expect(isScanError(result)).toBe(false);
      if (isScanError(result)) return;

      expect(result.entries).toHaveLength(3);
      expect(result.entries[0].name).toBe("alpha");
      expect(result.entries[1].name).toBe("bravo");
      expect(result.entries[2].name).toBe("charlie");
      expect(result.totalCount).toBe(3);
    });

    it("should skip hidden directories", async () => {
      await mkdir(path.join(tempDir, ".hidden"));
      await mkdir(path.join(tempDir, "visible"));

      const result = await scanDirectory(tempDir);
      expect(isScanError(result)).toBe(false);
      if (isScanError(result)) return;

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].name).toBe("visible");
    });

    it("should skip files (only list directories)", async () => {
      await mkdir(path.join(tempDir, "subdir"));
      await fs.writeFile(path.join(tempDir, "file.txt"), "content");

      const result = await scanDirectory(tempDir);
      expect(isScanError(result)).toBe(false);
      if (isScanError(result)) return;

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].name).toBe("subdir");
    });

    it("should paginate entries", async () => {
      // Create more entries than one page
      for (let i = 0; i < MAX_ENTRIES_PER_PAGE + 3; i++) {
        await mkdir(path.join(tempDir, `dir-${String(i).padStart(2, "0")}`));
      }

      const page0 = await scanDirectory(tempDir, 0);
      expect(isScanError(page0)).toBe(false);
      if (isScanError(page0)) return;

      expect(page0.entries).toHaveLength(MAX_ENTRIES_PER_PAGE);
      expect(page0.totalCount).toBe(MAX_ENTRIES_PER_PAGE + 3);

      const page1 = await scanDirectory(tempDir, 1);
      expect(isScanError(page1)).toBe(false);
      if (isScanError(page1)) return;

      expect(page1.entries).toHaveLength(3);
    });

    it("should return hasParent=true for non-root directories", async () => {
      const result = await scanDirectory(tempDir);
      expect(isScanError(result)).toBe(false);
      if (isScanError(result)) return;

      expect(result.hasParent).toBe(true);
      expect(result.parentPath).toBe(path.dirname(tempDir));
    });

    it("should return error for non-existent directory", async () => {
      const result = await scanDirectory(path.join(tempDir, "nonexistent"));
      expect(isScanError(result)).toBe(true);
      if (!isScanError(result)) return;

      expect(result.code).toBe("ENOENT");
    });

    it("should return empty entries for empty directory", async () => {
      const result = await scanDirectory(tempDir);
      expect(isScanError(result)).toBe(false);
      if (isScanError(result)) return;

      expect(result.entries).toHaveLength(0);
      expect(result.totalCount).toBe(0);
    });
  });

  describe("buildEntryLabel", () => {
    it("should format entry with folder emoji", () => {
      const entry = { name: "my-project", fullPath: "/home/user/my-project" };
      expect(buildEntryLabel(entry)).toBe("📁 my-project");
    });
  });

  describe("buildTreeHeader", () => {
    it("should show path and count for single page", () => {
      const header = buildTreeHeader("~/projects", 3, 0, 1);
      expect(header).toContain("~/projects");
      expect(header).toContain("3");
      expect(header).not.toContain("(");
    });

    it("should show page indicator for multiple pages", () => {
      const header = buildTreeHeader("~/projects", 15, 1, 2);
      expect(header).toContain("(2/2)");
    });

    it("should show empty message when no subfolders", () => {
      const header = buildTreeHeader("~/empty", 0, 0, 1);
      // Localized — English default contains the "No subfolders" emoji indicator
      expect(header).toContain("📭");
    });

    it("should use singular form for 1 subfolder", () => {
      const header = buildTreeHeader("~/one", 1, 0, 1);
      expect(header).toContain("1 subfolder");
    });

    it("should use plural form for multiple subfolders", () => {
      const header = buildTreeHeader("~/many", 5, 0, 1);
      expect(header).toContain("5 subfolders");
    });
  });

  describe("isScanError", () => {
    it("should return true for error results", () => {
      expect(isScanError({ error: "test", code: "ENOENT" })).toBe(true);
    });

    it("should return false for success results", () => {
      const result = {
        entries: [],
        totalCount: 0,
        currentPath: "/tmp",
        displayPath: "/tmp",
        hasParent: true,
        parentPath: "/",
      };
      expect(isScanError(result)).toBe(false);
    });
  });
});
