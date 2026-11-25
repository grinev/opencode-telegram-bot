import { describe, expect, it } from "vitest";
import { parseTelegramBlocks } from "../../../src/bot/render/block-parser.js";
import {
  normalizeMarkdownForTelegramBlockParsing,
  normalizeMarkdownForTelegramRendering,
} from "../../../src/bot/render/markdown-normalizer.js";

describe("bot/render/markdown-normalizer", () => {
  it("normalizes headings, quotes, horizontal rules, and checklists", () => {
    const input = [
      "# Main heading",
      "",
      "> quoted line",
      "Quote continues",
      "",
      "- [ ] Open task",
      "- [x] Done task",
      "1. [ ] Numbered task",
      "",
      "---",
    ].join("\n");

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(
      [
        "**Main heading**",
        "",
        "> quoted line",
        "> Quote continues",
        "",
        "🔲 Open task",
        "✅ Done task",
        "🔲 Numbered task",
        "",
        "──────────",
      ].join("\n"),
    );
  });

  it("normalizes checklists inside quotes and preserves quote mode", () => {
    const input = ["> - [ ] Review", "Follow-up line", "- [x] Outside quote"].join("\n");

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(
      ["> 🔲 Review", "> Follow-up line", "> ✅ Outside quote"].join("\n"),
    );
  });

  it.each([
    ["> note `code`", "- [ ] Next"],
    ["> note", "continuation `code`", "- [ ] Next"],
    ["> note `begin", "literal", "end`", "- [ ] Next"],
  ])("keeps lazy quote continuation around inline code: %j", (...lines) => {
    const input = lines.join("\n");
    const normalized = normalizeMarkdownForTelegramBlockParsing(input);

    expect(normalized.split("\n")).toEqual(
      lines.map((line) => (line.startsWith(">") ? line : `> ${line}`)),
    );
    expect(parseTelegramBlocks(input)).toHaveLength(1);
    expect(parseTelegramBlocks(input)[0]?.type).toBe("blockquote");
  });

  it("resets quote mode after an empty line", () => {
    const input = ["> quoted line", "", "Plain line"].join("\n");

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(
      ["> quoted line", "", "Plain line"].join("\n"),
    );
  });

  it("keeps fenced code blocks untouched", () => {
    const input = [
      "```ts",
      "# Not a heading",
      "> not a quote",
      "- [ ] not a checklist",
      "---",
      "```",
    ].join("\n");

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(input);
  });

  it("keeps tilde-fenced code blocks untouched", () => {
    const input = ["~~~text", "$$x^2$$", "", "```math", "```", "~~~"].join("\n");

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(input);
    expect(normalizeMarkdownForTelegramBlockParsing(input)).toBe(input);
  });

  it("keeps four-space indented code blocks untouched", () => {
    const input = ["Example:", "", "    $$x^2$$", "", "    $$", "    a = b", "    $$"].join("\n");

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(input);
  });

  it.each([
    ["shorter backtick fences", ["````markdown", "```math", "$$x^2$$", "```", "````"]],
    ["shorter tilde fences", ["~~~~text", "~~~", "$$x^2$$", "~~~~"]],
    ["backtick fence info", ["```text", "```not-a-closing-fence", "$$x^2$$", "```"]],
    ["tilde fence info", ["~~~text", "~~~not-a-closing-fence", "$$x^2$$", "~~~"]],
    ["multiline code spans", ["`begin", "$$x^2$$", "end`"]],
    ["longer code spans", ["``begin ` literal", "$$", "x^2", "$$", "end``"]],
    ["CRLF line endings", ["````text\r", "```\r", "$$x^2$$\r", "````\r"]],
    ["code inside quotes", ["> ```text", "> $$x^2$$", "> ```"]],
    ["code inside lists", ["- Example:", "", "  ~~~~text", "  ~~~", "  $$x^2$$", "  ~~~~"]],
  ])("preserves literal code containing %s", (_name, lines) => {
    const input = lines.join("\n");

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(input);
    expect(normalizeMarkdownForTelegramBlockParsing(input)).toBe(input);
  });

  it.each([
    ["fenced code", ["```text", "$$", "keep me", "```"]],
    ["indented code", ["    $$", "    keep me"]],
    ["inline code", ["`begin", "$$", "end`"]],
  ])("does not close an unmatched math delimiter inside %s", (_name, code) => {
    const input = ["$$", "", ...code, "", "After"].join("\n");

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(input);
    expect(normalizeMarkdownForTelegramBlockParsing(input)).toBe(input);
  });

  it("renders a formula after an indented code example containing an unclosed fence", () => {
    const input = ["Example:", "", "    ```text", "    literal", "", "$$x^2$$"].join("\n");

    expect(normalizeMarkdownForTelegramBlockParsing(input)).toBe(
      ["Example:", "", "    ```text", "    literal", "", "```math", "x^2", "```"].join("\n"),
    );
  });

  it("does not treat an unmatched backtick as a code span", () => {
    const input = ["Unmatched `", "", "$$x^2$$"].join("\n");

    expect(normalizeMarkdownForTelegramBlockParsing(input)).toBe(
      ["Unmatched `", "", "```math", "x^2", "```"].join("\n"),
    );
  });

  it("preserves malformed emphasis text without dropping content", () => {
    const input = "*text: *value**";

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(input);
  });

  it("keeps structural markdown for parser-safe normalization", () => {
    const input = [
      "# Main heading",
      "",
      "> - [ ] Review",
      "Follow-up line",
      "",
      "- [x] Done task",
      "",
      "---",
    ].join("\n");

    expect(normalizeMarkdownForTelegramBlockParsing(input)).toBe(
      [
        "# Main heading",
        "",
        "> - [ ] Review",
        "> Follow-up line",
        "",
        "- [x] Done task",
        "",
        "---",
      ].join("\n"),
    );
  });

  it("converts dollar-delimited formulas into math fences", () => {
    const input = ["Intro", "", "$$", "E = mc^2", "$$", "", "and $$x^2$$ inside a line"].join("\n");

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(
      ["Intro", "", "```math", "E = mc^2", "```", "", "and $$x^2$$ inside a line"].join("\n"),
    );
  });

  it("keeps a formula nested inside a numbered list item", () => {
    const input = ["1. Formula:", "   $$x^2$$", "   continuation", "2. Second"].join("\n");

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(
      ["1. Formula:", "   ```math", "   x^2", "   ```", "   continuation", "2. Second"].join("\n"),
    );

    expect(parseTelegramBlocks(input)).toEqual([
      {
        type: "list",
        ordered: true,
        items: [
          {
            blocks: [
              { type: "paragraph", inlines: [{ type: "text", text: "Formula:" }] },
              { type: "math", expression: "x^2" },
              { type: "paragraph", inlines: [{ type: "text", text: "continuation" }] },
            ],
          },
          { blocks: [{ type: "paragraph", inlines: [{ type: "text", text: "Second" }] }] },
        ],
      },
    ]);
  });

  it("keeps multi-line formulas nested inside a list item", () => {
    const input = ["- item", "  $$", "  a = b", "  $$", "- next"].join("\n");

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(
      ["- item", "  ```math", "  a = b", "  ```", "- next"].join("\n"),
    );
  });

  it("uses a longer math fence when the expression contains a fence", () => {
    const input = ["$$", "    ```", "x = 1", "$$"].join("\n");

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(
      ["````math", "```", "x = 1", "````"].join("\n"),
    );
    expect(parseTelegramBlocks(input)).toEqual([{ type: "math", expression: "```\nx = 1" }]);
  });

  it("keeps an unindented fence inside the formula", () => {
    const input = ["$$", "```", "x = 1", "$$", "", "Paragraph after."].join("\n");

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(
      ["````math", "```", "x = 1", "````", "", "Paragraph after."].join("\n"),
    );
    expect(parseTelegramBlocks(input)).toEqual([
      { type: "math", expression: "```\nx = 1" },
      { type: "paragraph", inlines: [{ type: "text", text: "Paragraph after." }] },
    ]);
  });

  it("does not close a formula on a delimiter inside a closed code block", () => {
    const input = ["$$", "intro", "```", "$$", "```"].join("\n");

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(input);
    expect(normalizeMarkdownForTelegramBlockParsing(input)).toBe(input);
  });
});
