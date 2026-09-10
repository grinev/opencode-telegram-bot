import { describe, expect, it, vi } from "#vitest";
import type { Context } from "grammy";
import type { RichBlock } from "grammy/types";
import {
  convertRichMessage,
  getIncomingPrompt,
  normalizeRichMessage,
} from "../../../src/bot/handlers/rich-message-handler.js";
import { t } from "../../../src/i18n/index.js";

function photoBlock(fileId: string): RichBlock {
  return {
    type: "photo",
    photo: [
      { file_id: `${fileId}-small`, file_unique_id: "small", width: 320, height: 240 },
      { file_id: fileId, file_unique_id: "large", width: 1280, height: 960, file_size: 2048 },
    ],
  };
}

describe("bot/handlers/rich-message-handler", () => {
  it("keeps a plain sentence as plain text", () => {
    const result = convertRichMessage([
      { type: "paragraph", text: "How are you feeling today?" },
    ]);

    expect(result).toEqual({
      text: "How are you feeling today?",
      photos: [],
      skippedMediaCount: 0,
    });
  });

  it("converts structured blocks and inline formatting to Markdown", () => {
    const blocks: RichBlock[] = [
      { type: "heading", size: 2, text: "Report" },
      {
        type: "paragraph",
        text: [
          { type: "bold", text: "Bold" },
          " and ",
          { type: "italic", text: "italic" },
          " with ",
          { type: "url", text: "link", url: "https://example.com/a_(b)" },
        ],
      },
      { type: "pre", language: "ts", text: "const value = 1;" },
      {
        type: "list",
        items: [
          { label: "-", blocks: [{ type: "paragraph", text: "first" }] },
          {
            label: "-",
            has_checkbox: true,
            is_checked: true,
            blocks: [{ type: "paragraph", text: "done" }],
          },
        ],
      },
      {
        type: "blockquote",
        blocks: [{ type: "paragraph", text: "quoted" }],
      },
      {
        type: "table",
        cells: [
          [
            { text: "Name", is_header: true, align: "left", valign: "top" },
            { text: "Value", is_header: true, align: "right", valign: "top" },
          ],
          [
            { text: "A", align: "left", valign: "top" },
            { text: "1", align: "right", valign: "top" },
          ],
        ],
      },
      { type: "mathematical_expression", expression: "E = mc^2" },
    ];

    const result = convertRichMessage(blocks);

    expect(result.text).toContain("## Report");
    expect(result.text).toContain("**Bold** and _italic_");
    expect(result.text).toContain("[link](https://example.com/a_\\(b\\))");
    expect(result.text).toContain("```ts\nconst value = 1;\n```");
    expect(result.text).toContain("- first\n- [x] done");
    expect(result.text).toContain("> quoted");
    expect(result.text).toContain("| Name | Value |\n| :--- | ---: |\n| A | 1 |");
    expect(result.text).toContain("$$\nE = mc^2\n$$");
  });

  it("extracts nested photos and counts skipped media once per block", () => {
    const blocks: RichBlock[] = [
      {
        type: "collage",
        blocks: [
          photoBlock("photo-1"),
          { type: "video", video: {} as never, caption: { text: "Video caption" } },
          { type: "animation", animation: {} as never },
        ],
        caption: { text: "Collage caption" },
      },
      { type: "audio", audio: {} as never },
      { type: "voice_note", voice_note: {} as never },
      {
        type: "map",
        location: { latitude: 1, longitude: 2 },
        zoom: 13,
        width: 100,
        height: 100,
        caption: { text: "Map caption" },
      },
    ];

    const result = convertRichMessage(blocks, 42);

    expect(result.photos).toEqual([
      {
        fileId: "photo-1",
        filename: "rich-photo-42-1.jpg",
        source: "rich",
        fileSize: 2048,
      },
    ]);
    expect(result.skippedMediaCount).toBe(5);
    expect(result.text).toContain("Video caption");
    expect(result.text).toContain("Collage caption");
    expect(result.text).toContain("Map caption");
  });

  it("exposes empty rich text to downstream text routing and sends one skip notice", async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const next = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      message: {
        message_id: 7,
        rich_message: {
          blocks: [
            { type: "video", video: {} },
            { type: "audio", audio: {} },
          ],
        },
      },
      reply,
    } as unknown as Context;

    await normalizeRichMessage(ctx, next);

    expect(ctx.message?.text).toBe("");
    expect(getIncomingPrompt(ctx)).toEqual({ text: "", fileParts: [], photos: [] });
    expect(reply).toHaveBeenCalledOnce();
    expect(reply).toHaveBeenCalledWith(
      t("bot.rich_message_media_skipped", { count: "2" }),
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it("exposes a bot_command entity so slash-prefixed rich text is routed as a command", async () => {
    const next = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      message: {
        message_id: 8,
        rich_message: { blocks: [{ type: "paragraph", text: "/status extra" }] },
      },
      reply: vi.fn(),
    } as unknown as Context;

    await normalizeRichMessage(ctx, next);

    expect(ctx.message?.text).toBe("/status extra");
    expect(ctx.message?.entities).toEqual([
      { type: "bot_command", offset: 0, length: "/status".length },
    ]);
  });
});
