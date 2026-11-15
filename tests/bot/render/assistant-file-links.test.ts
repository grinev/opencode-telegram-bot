import { describe, expect, it } from "vitest";
import {
  collectAssistantFileLinks,
  normalizeAssistantFilePath,
  projectAssistantFileLabels,
} from "../../../src/bot/render/assistant-file-links.js";

describe("assistant file links", () => {
  it("collects inline, repeated and reference links in source order while preserving label formatting", () => {
    const text =
      "# [**First**](./a%20b.pdf#L10)\n\n[Second][ref] [**First**](a%20b.pdf)\n\n[ref]: out.zip?raw=1";
    const links = collectAssistantFileLinks(text);
    expect(links.map(({ path, name }) => [path, name])).toEqual([
      ["a b.pdf", "First"],
      ["out.zip", "Second"],
      ["a b.pdf", "First"],
    ]);
    expect(projectAssistantFileLabels(text, links)).toContain("# **First**\n\nSecond **First**");
  });

  it("ignores code, images, bare paths, autolinks and non-project destinations", () => {
    const text = [
      "`[code](code.ts)`",
      "```\n[fenced](code.ts)\n```",
      "![image](a.png)",
      "![image][im]",
      "[im]: a.png",
      "plain.ts ./plain.ts",
      "<https://example.com>",
      "[web](https://example.com)",
      "[anchor](#part)",
      "[absolute](/tmp/a)",
      "[outside](../a)",
      "[data](data:text/plain,hi)",
      "[file](file:a)",
      "[directory](src/)",
    ].join("\n\n");
    expect(collectAssistantFileLinks(text)).toEqual([]);
    expect(projectAssistantFileLabels(text)).toBe(text);
  });

  it("handles lists, quotes, tables, empty labels and ordinary image-file links", () => {
    const text =
      "- [a](one.txt)\n\n> [b](two.txt)\n\n| col |\n| --- |\n| [c](three.txt) |\n\n[](empty.txt) [photo](a.png)";
    expect(collectAssistantFileLinks(text).map((link) => link.path)).toEqual([
      "one.txt",
      "two.txt",
      "three.txt",
      "empty.txt",
      "a.png",
    ]);
  });

  it("resolves references from a full reply when rendering only its undelivered suffix", () => {
    const full = "Already shown.\n\n[tail][ref]\n\n[ref]: a.txt";
    expect(collectAssistantFileLinks("[tail][ref]", full)).toMatchObject([
      { path: "a.txt", name: "tail" },
    ]);
  });

  it.each([
    "../a",
    "%2e%2e/a",
    "/a",
    "C:\\a",
    "\\\\host\\a",
    "%2fetc/passwd",
    "x/../../a",
    "https://x/a",
    "file:a",
    "data:a",
    "#x",
    "?x",
    ".",
    "bad%xx",
    "a%00.txt",
    "a%0a.txt",
  ])("rejects unsafe/non-file path %s", (source) => {
    expect(normalizeAssistantFilePath(source)).toBeUndefined();
  });

  it("decodes once and discards only URL query/fragment suffixes", () => {
    expect(normalizeAssistantFilePath("./dir/a%20b.txt?raw#L1")).toBe("dir/a b.txt");
    expect(normalizeAssistantFilePath("a%23b.txt")).toBe("a#b.txt");
    expect(normalizeAssistantFilePath("%252e%252e/a")).toBe("%2e%2e/a");
  });
});
