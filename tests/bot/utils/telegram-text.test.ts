import { describe, expect, it, vi } from "vitest";
import {
  editRenderedBotPart,
  editBotText,
  getTelegramRenderedPartSignature,
  sendBotText,
  sendRenderedBotPart,
} from "../../../src/bot/utils/telegram-text.js";

describe("bot/utils/telegram-text", () => {
  it("sends raw messages by default", async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);

    await sendBotText({
      api: { sendMessage },
      target: { chatId: 100 },
      text: "plain text",
      options: { reply_markup: { keyboard: [] } },
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(100, "plain text", {
      reply_markup: { keyboard: [] },
    });
  });

  it("uses MarkdownV2 mode when requested", async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);

    await sendBotText({
      api: { sendMessage },
      target: { chatId: 100 },
      text: "**formatted**",
      format: "markdown_v2",
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(100, "**formatted**", {
      parse_mode: "MarkdownV2",
    });
  });

  it("uses raw fallback text when markdown parse fails", async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("Bad Request: can't parse entities: Character '.' is reserved"),
      )
      .mockRejectedValueOnce(new Error("Bad Request: can't parse entities: unsupported start tag"))
      .mockResolvedValueOnce(undefined);

    await sendBotText({
      api: { sendMessage },
      target: { chatId: 100 },
      text: "Build succeeded.",
      rawFallbackText: "Build succeeded.",
      format: "markdown_v2",
    });

    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(sendMessage).toHaveBeenNthCalledWith(3, 100, "Build succeeded.", undefined);
  });

  it("edits raw messages by default", async () => {
    const editMessageText = vi.fn().mockResolvedValue(undefined);

    await editBotText({
      api: { editMessageText },
      chatId: 100,
      messageId: 200,
      text: "updated",
    });

    expect(editMessageText).toHaveBeenCalledTimes(1);
    expect(editMessageText).toHaveBeenCalledWith(100, 200, "updated", undefined);
  });

  it("sends rendered parts with entities and no parse mode", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 123 });

    await expect(
      sendRenderedBotPart({
        api: { sendMessage },
        target: { chatId: 100 },
        part: {
          text: "Hello",
          entities: [{ type: "bold", offset: 0, length: 5 }],
          fallbackText: "Hello",
          source: "entities",
        },
        options: { reply_markup: { keyboard: [] }, parse_mode: "MarkdownV2" },
      }),
    ).resolves.toEqual({
      messageId: 123,
      deliveredSignature: getTelegramRenderedPartSignature({
        text: "Hello",
        entities: [{ type: "bold", offset: 0, length: 5 }],
      }),
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(100, "Hello", {
      reply_markup: { keyboard: [] },
      entities: [{ type: "bold", offset: 0, length: 5 }],
    });
  });

  it("sends plain rendered parts without entities", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 321 });

    await expect(
      sendRenderedBotPart({
        api: { sendMessage },
        target: { chatId: 100 },
        part: {
          text: "plain text",
          fallbackText: "plain text",
          source: "plain",
        },
        options: { reply_markup: { keyboard: [] } },
      }),
    ).resolves.toEqual({
      messageId: 321,
      deliveredSignature: getTelegramRenderedPartSignature({ text: "plain text" }),
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(100, "plain text", {
      reply_markup: { keyboard: [] },
    });
  });

  it("retries rendered entity parts in raw mode when Telegram rejects entities", async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error("Bad Request: can't parse entities: unsupported start tag"))
      .mockResolvedValueOnce({ message_id: 222 });

    await expect(
      sendRenderedBotPart({
        api: { sendMessage },
        target: { chatId: 100 },
        part: {
          text: "Hello",
          entities: [{ type: "bold", offset: 0, length: 5 }],
          fallbackText: "Hello raw",
          source: "entities",
        },
        options: { reply_markup: { keyboard: [] }, parse_mode: "MarkdownV2" },
      }),
    ).resolves.toEqual({
      messageId: 222,
      deliveredSignature: getTelegramRenderedPartSignature({ text: "Hello raw" }),
    });

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenNthCalledWith(1, 100, "Hello", {
      reply_markup: { keyboard: [] },
      entities: [{ type: "bold", offset: 0, length: 5 }],
    });
    expect(sendMessage).toHaveBeenNthCalledWith(2, 100, "Hello raw", {
      reply_markup: { keyboard: [] },
    });
  });

  it("edits rendered parts with entities and raw fallback", async () => {
    const editMessageText = vi
      .fn()
      .mockRejectedValueOnce(new Error("Bad Request: can't parse entities: unsupported start tag"))
      .mockResolvedValueOnce(undefined);

    await expect(
      editRenderedBotPart({
        api: { editMessageText },
        chatId: 100,
        messageId: 500,
        part: {
          text: "Hello",
          entities: [{ type: "italic", offset: 0, length: 5 }],
          fallbackText: "Hello raw",
          source: "entities",
        },
        options: { reply_markup: { inline_keyboard: [] }, parse_mode: "MarkdownV2" },
      }),
    ).resolves.toEqual({
      deliveredSignature: getTelegramRenderedPartSignature({ text: "Hello raw" }),
    });

    expect(editMessageText).toHaveBeenCalledTimes(2);
    expect(editMessageText).toHaveBeenNthCalledWith(1, 100, 500, "Hello", {
      reply_markup: { inline_keyboard: [] },
      entities: [{ type: "italic", offset: 0, length: 5 }],
    });
    expect(editMessageText).toHaveBeenNthCalledWith(2, 100, 500, "Hello raw", {
      reply_markup: { inline_keyboard: [] },
    });
  });
});
