import { describe, expect, it } from "vitest";
import { convertToTelegramMarkdownV2 } from "../../src/summary/markdown-to-telegram-v2.js";

describe("summary/markdown-to-telegram-v2", () => {
  it("converts common inline markdown and escapes Telegram MarkdownV2 text", () => {
    expect(convertToTelegramMarkdownV2("Use **bold** and *italic* with a+b!")).toBe(
      "Use *bold* and _italic_ with a\\+b\\!",
    );
  });

  it("escapes code and link delimiters that would break MarkdownV2", () => {
    const output = convertToTelegramMarkdownV2(
      "Use `C:\\temp` and [docs](https://example.com/a_(b))",
    );

    expect(output).toContain("`C:\\\\temp`");
    expect(output).toContain("[docs](https://example.com/a_(b\\))");
  });

  it("renders lists and tables as escaped plain Telegram MarkdownV2 text", () => {
    const output = convertToTelegramMarkdownV2(
      ["- item", "", "| A | B |", "| --- | --- |", "| C | D |"].join("\n"),
    );

    expect(output).toContain("\\- item");
    expect(output).toContain("\\| A \\| B \\|");
    expect(output).toContain("\\| \\-\\-\\- \\| \\-\\-\\- \\|");
    expect(output).toContain("\\| C \\| D \\|");
  });

  it("preserves malformed markdown content instead of throwing", () => {
    const input = [
      "*text: *value**",
      "<div>raw_html</div>",
      "[broken](https://example.com/foo",
    ].join("\n\n");

    expect(() => convertToTelegramMarkdownV2(input)).not.toThrow();

    const output = convertToTelegramMarkdownV2(input);
    expect(output).toContain("text");
    expect(output).toContain("value");
    expect(output).toContain("raw\\_html");
    expect(output).toContain("broken");
  });
});
