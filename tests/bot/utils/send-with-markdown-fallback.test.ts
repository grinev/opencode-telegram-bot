import { describe, expect, it, vi } from "vitest";
import {
  editMessageWithMarkdownFallback,
  isTelegramMarkdownParseError,
  sendMessageWithMarkdownFallback,
} from "../../../src/bot/utils/send-with-markdown-fallback.js";

describe("bot/utils/send-with-markdown-fallback", () => {
  it("sends with MarkdownV2 when there is no parse error", async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const replyMarkup = { keyboard: [[{ text: "A" }]] };

    await sendMessageWithMarkdownFallback({
      api: { sendMessage },
      chatId: 123,
      text: "**hello**",
      options: { reply_markup: replyMarkup },
      parseMode: "MarkdownV2",
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenNthCalledWith(1, 123, "**hello**", {
      reply_markup: replyMarkup,
      parse_mode: "MarkdownV2",
    });
  });

  it("retries in raw mode when Telegram rejects markdown entities", async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error("Bad Request: can't parse entities: Unsupported start tag"))
      .mockResolvedValueOnce(undefined);

    await sendMessageWithMarkdownFallback({
      api: { sendMessage },
      chatId: 123,
      text: "<broken>",
      options: { reply_markup: { keyboard: [] } },
      parseMode: "MarkdownV2",
    });

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenNthCalledWith(1, 123, "<broken>", {
      reply_markup: { keyboard: [] },
      parse_mode: "MarkdownV2",
    });
    expect(sendMessage).toHaveBeenNthCalledWith(2, 123, "<broken>", {
      reply_markup: { keyboard: [] },
    });
  });

  it("does not swallow non-markdown Telegram errors", async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error("Bad Request: message is too long"));

    await expect(
      sendMessageWithMarkdownFallback({
        api: { sendMessage },
        chatId: 123,
        text: "hello",
        parseMode: "MarkdownV2",
      }),
    ).rejects.toThrow("message is too long");

    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("detects parse errors from api error description fields", () => {
    const error = {
      description: "Bad Request: can't find end of the entity starting at byte offset 42",
    };

    expect(isTelegramMarkdownParseError(error)).toBe(true);
    expect(isTelegramMarkdownParseError(new Error("network timeout"))).toBe(false);
  });

  it("supports Markdown parse mode with fallback", async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("Bad Request: can't parse entities: Character '_' is reserved"),
      )
      .mockResolvedValueOnce(undefined);

    await sendMessageWithMarkdownFallback({
      api: { sendMessage },
      chatId: 321,
      text: "*status* project_name",
      parseMode: "Markdown",
    });

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenNthCalledWith(1, 321, "*status* project_name", {
      parse_mode: "Markdown",
    });
    expect(sendMessage).toHaveBeenNthCalledWith(2, 321, "*status* project_name", undefined);
  });

  it("edits message with MarkdownV2 when there is no parse error", async () => {
    const editMessageText = vi.fn().mockResolvedValue(undefined);

    await editMessageWithMarkdownFallback({
      api: { editMessageText },
      chatId: 123,
      messageId: 777,
      text: "**hello**",
      options: { reply_markup: { inline_keyboard: [] } },
      parseMode: "MarkdownV2",
    });

    expect(editMessageText).toHaveBeenCalledTimes(1);
    expect(editMessageText).toHaveBeenNthCalledWith(1, 123, 777, "**hello**", {
      reply_markup: { inline_keyboard: [] },
      parse_mode: "MarkdownV2",
    });
  });

  it("retries message edit in raw mode when Telegram rejects markdown entities", async () => {
    const editMessageText = vi
      .fn()
      .mockRejectedValueOnce(new Error("Bad Request: can't parse entities: unsupported start tag"))
      .mockResolvedValueOnce(undefined);

    await editMessageWithMarkdownFallback({
      api: { editMessageText },
      chatId: 42,
      messageId: 8,
      text: "<broken>",
      options: { reply_markup: { inline_keyboard: [] } },
      parseMode: "MarkdownV2",
    });

    expect(editMessageText).toHaveBeenCalledTimes(2);
    expect(editMessageText).toHaveBeenNthCalledWith(1, 42, 8, "<broken>", {
      reply_markup: { inline_keyboard: [] },
      parse_mode: "MarkdownV2",
    });
    expect(editMessageText).toHaveBeenNthCalledWith(2, 42, 8, "<broken>", {
      reply_markup: { inline_keyboard: [] },
    });
  });
});
