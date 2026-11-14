import { describe, expect, it } from "vitest";
import {
  hasMarkdownImages,
  omitMarkdownImages,
  parseTelegramBlocks,
} from "../../../src/bot/render/block-parser.js";
import { renderTelegramParts } from "../../../src/bot/render/pipeline.js";
import { countRichMedia } from "../../../src/bot/render/rich-blocks.js";
import { getTelegramRenderedPartSignature } from "../../../src/bot/render/part-signature.js";

describe("assistant Markdown images", () => {
  it("keeps a photo when a long bullet item's text must be split", () => {
    const parts = renderTelegramParts(`- ${"x".repeat(34000)} ![a](a.png)`, undefined, true);
    expect(parts.length).toBeGreaterThan(1);
    expect(
      parts.reduce(
        (sum, part) => sum + part.blocks.reduce((n, block) => n + countRichMedia(block), 0),
        0,
      ),
    ).toBe(1);
  });

  it("bounds image names and reserves enough characters for failure notices", () => {
    const parts = renderTelegramParts(`![${"x".repeat(33000)}](missing.png)`, undefined, true);
    expect(parts).toHaveLength(1);
    expect(parts[0]?.fallbackText.length).toBeLessThan(400);
    const many = renderTelegramParts(
      `${"text ".repeat(6000)}\n\n${Array.from({ length: 50 }, (_, i) => `![${"x".repeat(256)}](${i}.png)`).join("\n\n")}`,
      undefined,
      true,
    );
    expect(many.length).toBeGreaterThan(1);
    expect(many.every((part) => part.fallbackText.length < 32768)).toBe(true);
  });
  it("is opt-in and preserves formatted text around direct and reference images", () => {
    const text = "**before ![one](a.png) after** ![two][pic]\n\n[pic]: b.png";
    const blocks = parseTelegramBlocks(text, true);
    expect(blocks.map((block) => block.type)).toEqual(["paragraph", "image", "paragraph", "image"]);
    expect(blocks[0]).toMatchObject({
      inlines: [{ type: "bold", children: [{ type: "text", text: "before " }] }],
    });
    expect(blocks[1]).toEqual({ type: "image", path: "a.png", name: "one" });
    expect(blocks[3]).toEqual({ type: "image", path: "b.png", name: "two" });
    expect(JSON.stringify(parseTelegramBlocks(text))).not.toContain('"type":"image"');
  });

  it("keeps native tables and lifts only their images in row/cell order", () => {
    const blocks = parseTelegramBlocks(
      "![before](0.png)\n\n| A ![a](1.png) | B |\n| - | - |\n| ![b](2.png) | ![c][ref] |\n\n![after](4.png)\n\n[ref]: 3.png",
      true,
    );
    expect(blocks.map((block) => block.type)).toEqual([
      "image",
      "table",
      "image",
      "image",
      "image",
      "image",
    ]);
    expect(blocks.filter((block) => block.type === "image").map((block) => block.path)).toEqual([
      "0.png",
      "1.png",
      "2.png",
      "3.png",
      "4.png",
    ]);
    expect(blocks[1]).toMatchObject({
      type: "table",
      rows: [
        ["A ", "B"],
        ["", ""],
      ],
    });
  });

  it("keeps images in headings, quotes, linked text and lists", () => {
    const blocks = parseTelegramBlocks(
      "# hi ![](a.png) end\n\n> ![q](q.png)\n\n- [![l](l.png)](https://example.com)",
      true,
    );
    expect(blocks.map((block) => block.type)).toEqual([
      "heading",
      "image",
      "heading",
      "blockquote",
      "list",
    ]);
    expect(JSON.stringify(blocks)).toContain('"path":"l.png"');
  });

  it("suppresses recognized image syntax during streaming but not code", () => {
    const text =
      "hello ![x](a.png) ![y][ref]\n\n`![code](c.png)`\n\n```\n![code](d.png)\n```\n\n[ref]: b.png";
    const omitted = omitMarkdownImages(text);
    expect(omitted).not.toContain("![x]");
    expect(omitted).not.toContain("![y]");
    expect(omitted).toContain("![code](c.png)");
    expect(omitted).toContain("![code](d.png)");
    expect(hasMarkdownImages("`![x](a.png)`")).toBe(false);
    expect(hasMarkdownImages("![x](a.png)")).toBe(true);
  });

  it.each(["", "> ", "- "])("splits 51 images without dropping nested media (%s)", (prefix) => {
    const text = Array.from({ length: 51 }, (_, n) => `${prefix}![](${n}.png)`).join(
      prefix ? "\n" : "\n\n",
    );
    const parts = renderTelegramParts(text, undefined, true);
    expect(parts.length).toBeGreaterThan(1);
    const counts = parts.map((part) =>
      part.blocks.reduce((sum, block) => sum + countRichMedia(block), 0),
    );
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(51);
    expect(Math.max(...counts)).toBeLessThanOrEqual(50);
    expect(() => parts.map(getTelegramRenderedPartSignature)).not.toThrow();
  });
});
