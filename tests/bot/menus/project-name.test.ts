import { describe, expect, it } from "vitest";
import { resolveProjectName } from "../../../src/bot/menus/project-name.js";

describe("project name labels", () => {
  it("shows the folder name when no other known folder shares it", () => {
    expect(resolveProjectName("/Users/evan/work/app", ["/Users/evan/work/app"])).toBe("app");
  });

  it("keeps the folder name of a linked worktree", () => {
    expect(resolveProjectName("/repo-feature", ["/repo", "/repo-feature"])).toBe("repo-feature");
  });

  it("adds the minimum parent segments when two folders share a name", () => {
    const known = ["/alpha/shared", "/beta/shared", "/third"];

    expect(resolveProjectName("/alpha/shared", known)).toBe("alpha/shared");
    expect(resolveProjectName("/beta/shared", known)).toBe("beta/shared");
    expect(resolveProjectName("/third", known)).toBe("third");
  });

  it("keeps lengthening until the tail is unique", () => {
    const known = ["/work/a/shared", "/work/b/shared", "/root/a/shared", "/other/a/shared"];

    expect(resolveProjectName("/work/a/shared", known)).toBe("work/a/shared");
    expect(resolveProjectName("/root/a/shared", known)).toBe("root/a/shared");
    expect(resolveProjectName("/work/b/shared", known)).toBe("b/shared");
  });

  it("ignores trailing separators and reads both path styles", () => {
    expect(resolveProjectName("/var/www/project/", ["/var/www/project/"])).toBe("project");
    expect(resolveProjectName("C:\\work\\my-project", ["C:\\work\\my-project"])).toBe("my-project");
  });

  it("distinguishes Windows folders sharing a name", () => {
    const known = ["C:\\work\\shared", "D:\\work\\shared"];

    expect(resolveProjectName("C:\\work\\shared", known)).toBe("C:/work/shared");
    expect(resolveProjectName("D:\\work\\shared", known)).toBe("D:/work/shared");
  });
});
