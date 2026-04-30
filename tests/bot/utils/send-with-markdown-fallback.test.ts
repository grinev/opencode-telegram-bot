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
      target: { chatId: 123 },
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
      target: { chatId: 123 },
      text: "<broken>",
      options: { reply_markup: { keyboard: [] } },
      parseMode: "MarkdownV2",
    });

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenNthCalledWith(1, 123, "<broken>", {
      reply_markup: { keyboard: [] },
      parse_mode: "MarkdownV2",
    });
    expect(sendMessage).toHaveBeenNthCalledWith(2, 123, "<broken\\>", {
      reply_markup: { keyboard: [] },
      parse_mode: "MarkdownV2",
    });
  });

  it("drops markdown formatting options on send fallback", async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("Bad Request: can't parse entities: Character '+' is reserved"),
      )
      .mockRejectedValueOnce(
        new Error("Bad Request: can't parse entities: Character '+' is reserved"),
      )
      .mockResolvedValueOnce(undefined);

    await sendMessageWithMarkdownFallback({
      api: { sendMessage },
      target: { chatId: 777 },
      text: "a+b",
      options: {
        reply_markup: { keyboard: [] },
        parse_mode: "MarkdownV2",
        entities: [],
      },
      parseMode: "MarkdownV2",
    });

    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(sendMessage).toHaveBeenNthCalledWith(1, 777, "a+b", {
      reply_markup: { keyboard: [] },
      parse_mode: "MarkdownV2",
      entities: [],
    });
    expect(sendMessage).toHaveBeenNthCalledWith(2, 777, "a\\+b", {
      reply_markup: { keyboard: [] },
      parse_mode: "MarkdownV2",
      entities: [],
    });
    expect(sendMessage).toHaveBeenNthCalledWith(3, 777, "a+b", {
      reply_markup: { keyboard: [] },
    });
  });

  it("uses explicit raw fallback text on send fallback", async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("Bad Request: can't parse entities: Character '.' is reserved"),
      )
      .mockRejectedValueOnce(new Error("Bad Request: can't parse entities: unsupported start tag"))
      .mockResolvedValueOnce(undefined);

    await sendMessageWithMarkdownFallback({
      api: { sendMessage },
      target: { chatId: 444 },
      text: "Done.",
      rawFallbackText: "Done.",
      parseMode: "MarkdownV2",
    });

    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(sendMessage).toHaveBeenNthCalledWith(3, 444, "Done.", undefined);
  });

  it("unescapes MarkdownV2 text for raw send fallback when explicit fallback is not provided", async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("Bad Request: can't parse entities: Character '.' is reserved"),
      )
      .mockRejectedValueOnce(new Error("Bad Request: can't parse entities: unsupported start tag"))
      .mockResolvedValueOnce(undefined);

    await sendMessageWithMarkdownFallback({
      api: { sendMessage },
      target: { chatId: 445 },
      text: "Done.",
      parseMode: "MarkdownV2",
    });

    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(sendMessage).toHaveBeenNthCalledWith(3, 445, "Done.", undefined);
  });

  it("retries with escaped MarkdownV2 for reserved parentheses", async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("Bad Request: can't parse entities: Character '(' is reserved"),
      )
      .mockResolvedValueOnce(undefined);

    await sendMessageWithMarkdownFallback({
      api: { sendMessage },
      target: { chatId: 888 },
      text: "Cost (USD)",
      parseMode: "MarkdownV2",
    });

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenNthCalledWith(1, 888, "Cost (USD)", {
      parse_mode: "MarkdownV2",
    });
    expect(sendMessage).toHaveBeenNthCalledWith(2, 888, "Cost \\(USD\\)", {
      parse_mode: "MarkdownV2",
    });
  });

  it("does not double-escape already escaped MarkdownV2 text on retry", async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("Bad Request: can't parse entities: Character '.' is reserved"),
      )
      .mockResolvedValueOnce(undefined);

    await sendMessageWithMarkdownFallback({
      api: { sendMessage },
      target: { chatId: 889 },
      text: "Table \\| row \\| and dot .",
      parseMode: "MarkdownV2",
    });

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenNthCalledWith(1, 889, "Table \\| row \\| and dot .", {
      parse_mode: "MarkdownV2",
    });
    expect(sendMessage).toHaveBeenNthCalledWith(2, 889, "Table \\| row \\| and dot \\.", {
      parse_mode: "MarkdownV2",
    });
  });

  it("does not swallow non-markdown Telegram errors", async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error("Bad Request: message is too long"));

    await expect(
      sendMessageWithMarkdownFallback({
        api: { sendMessage },
        target: { chatId: 123 },
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
      target: { chatId: 321 },
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
    expect(editMessageText).toHaveBeenNthCalledWith(2, 42, 8, "<broken\\>", {
      reply_markup: { inline_keyboard: [] },
      parse_mode: "MarkdownV2",
    });
  });

  it("drops markdown formatting options on edit fallback", async () => {
    const editMessageText = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("Bad Request: can't parse entities: Character '+' is reserved"),
      )
      .mockRejectedValueOnce(
        new Error("Bad Request: can't parse entities: Character '+' is reserved"),
      )
      .mockResolvedValueOnce(undefined);

    await editMessageWithMarkdownFallback({
      api: { editMessageText },
      chatId: 501,
      messageId: 902,
      text: "a+b",
      options: {
        reply_markup: { inline_keyboard: [] },
        parse_mode: "MarkdownV2",
        entities: [],
      },
      parseMode: "MarkdownV2",
    });

    expect(editMessageText).toHaveBeenCalledTimes(3);
    expect(editMessageText).toHaveBeenNthCalledWith(1, 501, 902, "a+b", {
      reply_markup: { inline_keyboard: [] },
      parse_mode: "MarkdownV2",
      entities: [],
    });
    expect(editMessageText).toHaveBeenNthCalledWith(2, 501, 902, "a\\+b", {
      reply_markup: { inline_keyboard: [] },
      parse_mode: "MarkdownV2",
      entities: [],
    });
    expect(editMessageText).toHaveBeenNthCalledWith(3, 501, 902, "a+b", {
      reply_markup: { inline_keyboard: [] },
    });
  });

  it("uses explicit raw fallback text on edit fallback", async () => {
    const editMessageText = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("Bad Request: can't parse entities: Character '.' is reserved"),
      )
      .mockRejectedValueOnce(new Error("Bad Request: can't parse entities: unsupported start tag"))
      .mockResolvedValueOnce(undefined);

    await editMessageWithMarkdownFallback({
      api: { editMessageText },
      chatId: 111,
      messageId: 222,
      text: "Done.",
      rawFallbackText: "Done.",
      parseMode: "MarkdownV2",
    });

    expect(editMessageText).toHaveBeenCalledTimes(3);
    expect(editMessageText).toHaveBeenNthCalledWith(3, 111, 222, "Done.", undefined);
  });

  it("unescapes MarkdownV2 text for raw edit fallback when explicit fallback is not provided", async () => {
    const editMessageText = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("Bad Request: can't parse entities: Character '.' is reserved"),
      )
      .mockRejectedValueOnce(new Error("Bad Request: can't parse entities: unsupported start tag"))
      .mockResolvedValueOnce(undefined);

    await editMessageWithMarkdownFallback({
      api: { editMessageText },
      chatId: 112,
      messageId: 223,
      text: "Done.",
      parseMode: "MarkdownV2",
    });

    expect(editMessageText).toHaveBeenCalledTimes(3);
    expect(editMessageText).toHaveBeenNthCalledWith(3, 112, 223, "Done.", undefined);
  });
});
