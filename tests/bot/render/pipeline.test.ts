import { describe, expect, it } from "vitest";
import {
  renderTelegramBlocks,
  renderTelegramParts,
} from "../../../src/bot/render/pipeline.js";
import { validateTelegramEntities } from "../../../src/bot/render/validator.js";

describe("bot/render/pipeline", () => {
  it("renders markdown into block-level outputs", () => {
    expect(renderTelegramBlocks("# Title\n\nParagraph with **bold**\n\n- item")).toEqual([
      {
        blockType: "heading",
        mode: "full",
        text: "Title",
        entities: [{ type: "bold", offset: 0, length: 5 }],
        fallbackText: "Title",
        source: "entities",
      },
      {
        blockType: "paragraph",
        mode: "full",
        text: "Paragraph with bold",
        entities: [{ type: "bold", offset: 15, length: 4 }],
        fallbackText: "Paragraph with bold",
        source: "entities",
      },
      {
        blockType: "list",
        mode: "full",
        text: "- item",
        fallbackText: "- item",
        source: "plain",
      },
    ]);
  });

  it("renders markdown into sized parts with block separators", () => {
    const parts = renderTelegramParts("# Title\n\nParagraph with **bold**\n\n- item", {
      maxPartLength: 100,
    });

    expect(parts).toEqual([
      {
        text: "Title\n\nParagraph with bold\n\n- item",
        entities: [
          { type: "bold", offset: 0, length: 5 },
          { type: "bold", offset: 22, length: 4 },
        ],
        fallbackText: "Title\n\nParagraph with bold\n\n- item",
        source: "entities",
      },
    ]);
  });

  it("splits long rich paragraphs into multiple valid parts", () => {
    const parts = renderTelegramParts(
      "Paragraph **bold** line\nParagraph **bold** line\nParagraph **bold** line",
      {
        maxPartLength: 24,
      },
    );

    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((part) => part.text.length <= 24)).toBe(true);
    expect(parts.every((part) => validateTelegramEntities(part.text, part.entities ?? []).ok)).toBe(
      true,
    );
  });

  it("splits long code fences into multiple preformatted parts", () => {
    const parts = renderTelegramParts(
      "```ts\nconst first = 1;\nconst second = 2;\nconst third = 3;\n```",
      { maxPartLength: 18 },
    );

    expect(parts).toEqual([
      {
        text: "const first = 1;\n",
        entities: [{ type: "pre", offset: 0, length: 17, language: "ts" }],
        fallbackText: "const first = 1;\n",
        source: "entities",
      },
      {
        text: "const second = 2;\n",
        entities: [{ type: "pre", offset: 0, length: 18, language: "ts" }],
        fallbackText: "const second = 2;\n",
        source: "entities",
      },
      {
        text: "const third = 3;",
        entities: [{ type: "pre", offset: 0, length: 16, language: "ts" }],
        fallbackText: "const third = 3;",
        source: "entities",
      },
    ]);
  });

  it("splits long tables into multiple preformatted parts", () => {
    const parts = renderTelegramParts(
      "| Name | Score |\n| --- | --- |\n| api.js | +1.5 |\n| alert() | -1.5 |",
      { maxPartLength: 25 },
    );

    expect(parts.every((part) => part.entities?.[0]?.type === "pre")).toBe(true);
    expect(parts.every((part) => part.text.length <= 25)).toBe(true);
  });

  it("degrades oversized single links to plain parts without affecting neighboring blocks", () => {
    const markdown = [
      "Safe **block**.",
      "",
      "[averyveryverylonglink](https://example.com)",
      "",
      "Another **safe** block.",
    ].join("\n");

    const parts = renderTelegramParts(markdown, { maxPartLength: 12 });

    expect(parts.length).toBeGreaterThan(2);
    expect(parts.some((part) => part.entities?.some((entity) => entity.type === "bold"))).toBe(
      true,
    );
    expect(parts.some((part) => part.source === "plain" && part.text.includes("avery"))).toBe(true);
  });
});
