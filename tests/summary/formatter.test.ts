import { beforeEach, describe, expect, it } from "vitest";
import { formatSummary, formatToolInfo, prepareCodeFile } from "../../src/summary/formatter.js";
import { __resetSettingsForTests, setCurrentProject } from "../../src/settings/manager.js";

describe("summary/formatter", () => {
  beforeEach(() => {
    __resetSettingsForTests();
    setCurrentProject({ id: "p1", worktree: "D:/repo", name: "repo" });
  });

  it("formats summary text and splits long output", () => {
    expect(formatSummary("")).toEqual([]);
    expect(formatSummary("   hello world   ")).toEqual(["hello world"]);

    const longText = "a".repeat(4500);
    const parts = formatSummary(longText);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0].startsWith("```\n")).toBe(true);
    expect(parts[0].endsWith("\n```")).toBe(true);
  });

  it("formats todowrite tool metadata", () => {
    const text = formatToolInfo({
      sessionId: "s1",
      messageId: "m1",
      callId: "c1",
      tool: "todowrite",
      state: { status: "completed" } as never,
      metadata: {
        todos: [
          { id: "1", content: "Done item", status: "completed" },
          { id: "2", content: "In progress item", status: "in_progress" },
          { id: "3", content: "Pending item", status: "pending" },
        ],
      },
    });

    expect(text).toBe("📝 todowrite (3)\n[x] Done item\n[~] In progress item\n[  ] Pending item");
  });

  it("formats write/edit tool details with line counters", () => {
    const writeText = formatToolInfo({
      sessionId: "s1",
      messageId: "m2",
      callId: "c2",
      tool: "write",
      state: { status: "completed" } as never,
      input: {
        filePath: "src/example.ts",
        content: "line1\nline2",
      },
    });

    expect(writeText).toContain("✍️ write src/example.ts (+2)");

    const editText = formatToolInfo({
      sessionId: "s1",
      messageId: "m3",
      callId: "c3",
      tool: "edit",
      state: { status: "completed" } as never,
      input: {
        filePath: "src/example.ts",
      },
      metadata: {
        filediff: {
          additions: 3,
          deletions: 1,
        },
      },
    });

    expect(editText).toContain("✏️ edit src/example.ts (+3 -1)");
  });

  it("formats bash tool using description and command", () => {
    const text = formatToolInfo({
      sessionId: "s1",
      messageId: "m4",
      callId: "c4",
      tool: "bash",
      state: { status: "completed" } as never,
      input: {
        description: "Run tests",
        command: "npm test",
      },
    });

    expect(text).toBe("💻 Run tests\nbash npm test");
  });

  it("formats apply_patch tool details without dumping full patch", () => {
    const text = formatToolInfo({
      sessionId: "s1",
      messageId: "m5",
      callId: "c5",
      tool: "apply_patch",
      state: { status: "completed" } as never,
      title: "Success. Updated the following files:\nM src/one.ts",
      metadata: {
        filediff: {
          file: "src/one.ts",
          additions: 2,
          deletions: 1,
        },
      },
      input: {
        patchText: "ignored for this presentation path",
      },
    });

    expect(text).toBe("🩹 apply_patch src/one.ts (+2 -1)");
  });

  it("formats apply_patch line info from patchText fallback", () => {
    const text = formatToolInfo({
      sessionId: "s1",
      messageId: "m6",
      callId: "c6",
      tool: "apply_patch",
      state: { status: "completed" } as never,
      title: "Success. Updated the following files:\nM README.md",
      input: {
        patchText: [
          "--- a/README.md",
          "+++ b/README.md",
          "@@ -1,1 +1,4 @@",
          " old line",
          "+new line 1",
          "+new line 2",
          "+new line 3",
        ].join("\n"),
      },
    });

    expect(text).toBe("🩹 apply_patch README.md (+3)");
  });

  it("prepares file payloads for write/edit and skips oversized content", () => {
    const writeFile = prepareCodeFile("const x = 1;", "src/app.ts", "write");
    expect(writeFile).not.toBeNull();
    expect(writeFile?.filename).toBe("write_app.ts.txt");
    expect(writeFile?.buffer.toString("utf8")).toContain("Write File/Path: src/app.ts");

    const diff = [
      "@@ -1,2 +1,2 @@",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      " line1",
      "-line2",
      "+line2-updated",
      "\\ No newline at end of file",
    ].join("\n");
    const editFile = prepareCodeFile(diff, "src/app.ts", "edit");
    const editBody = editFile?.buffer.toString("utf8") ?? "";

    expect(editFile).not.toBeNull();
    expect(editFile?.filename).toBe("edit_app.ts.txt");
    expect(editBody).not.toContain("@@");
    expect(editBody).not.toContain("--- a/src/app.ts");
    expect(editBody).toContain(" line1");
    expect(editBody).toContain("- line2");
    expect(editBody).toContain("+ line2-updated");

    const oversized = prepareCodeFile("a".repeat(101 * 1024), "src/large.ts", "write");
    expect(oversized).toBeNull();
  });

  it("normalizes absolute paths to project-relative form", () => {
    const writeText = formatToolInfo({
      sessionId: "s1",
      messageId: "m7",
      callId: "c7",
      tool: "write",
      state: { status: "completed" } as never,
      input: {
        filePath: "D:/repo/src/absolute-write.ts",
        content: "one line",
      },
    });

    expect(writeText).toContain("✍️ write src/absolute-write.ts (+1)");

    const editText = formatToolInfo({
      sessionId: "s1",
      messageId: "m8",
      callId: "c8",
      tool: "edit",
      state: { status: "completed" } as never,
      input: {
        filePath: "D:/repo/README.md",
      },
      metadata: {
        filediff: {
          file: "D:/repo/README.md",
          additions: 3,
          deletions: 0,
        },
      },
    });

    expect(editText).toContain("✏️ edit README.md (+3)");

    const writeFile = prepareCodeFile("content", "D:/repo/src/absolute-write.ts", "write");
    expect(writeFile?.buffer.toString("utf8")).toContain("Write File/Path: src/absolute-write.ts");
  });
});
