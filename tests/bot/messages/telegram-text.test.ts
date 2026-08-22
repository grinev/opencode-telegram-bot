import { describe, expect, it, vi } from "vitest";
import {
  completeDraftPart,
  editRenderedBotPart,
  editBotText,
  getTelegramRenderedPartSignature,
  sendBotText,
  sendDraftBotPart,
  sendRenderedBotPart,
} from "../../../src/bot/messages/telegram-text.js";
import { PLAIN_MAX_PART_CHARS } from "../../../src/bot/render/limits.js";
import type { TelegramRenderedPart } from "../../../src/bot/render/types.js";

const richPart: TelegramRenderedPart = {
  blocks: [{ type: "paragraph", text: { type: "bold", text: "Hello" } }],
  fallbackText: "Hello",
  source: "blocks",
};

const plainPart: TelegramRenderedPart = {
  blocks: [],
  fallbackText: "plain text",
  source: "plain",
};

function plainSignature(text: string): string {
  return getTelegramRenderedPartSignature({ blocks: [], fallbackText: text, source: "plain" });
}

function badRequestError(message: string): Error & { error_code: number } {
  return Object.assign(new Error(message), { error_code: 400 });
}

describe("bot/messages/telegram-text", () => {
  it("sends raw messages by default", async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);

    await sendBotText({
      api: { sendMessage },
      chatId: 100,
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
      chatId: 100,
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
        badRequestError("Bad Request: can't parse entities: Character '.' is reserved"),
      )
      .mockRejectedValueOnce(badRequestError("Bad Request: can't parse entities: unsupported start tag"))
      .mockResolvedValueOnce(undefined);

    await sendBotText({
      api: { sendMessage },
      chatId: 100,
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

  describe("sendRenderedBotPart", () => {
    it("sends native blocks and strips parse mode", async () => {
      const sendMessage = vi.fn();
      const sendRichMessage = vi.fn().mockResolvedValue({ message_id: 123 });

      await expect(
        sendRenderedBotPart({
          api: { sendMessage, sendRichMessage },
          chatId: 100,
          part: richPart,
          options: { reply_markup: { keyboard: [] }, parse_mode: "MarkdownV2" },
        }),
      ).resolves.toEqual({
        messageId: 123,
        deliveredSignature: getTelegramRenderedPartSignature(richPart),
      });

      expect(sendMessage).not.toHaveBeenCalled();
      expect(sendRichMessage).toHaveBeenCalledWith(
        100,
        { blocks: richPart.blocks },
        { reply_markup: { keyboard: [] } },
      );
    });

    it("sends plain parts as text without touching the rich API", async () => {
      const sendMessage = vi.fn().mockResolvedValue({ message_id: 321 });
      const sendRichMessage = vi.fn();

      await expect(
        sendRenderedBotPart({
          api: { sendMessage, sendRichMessage },
          chatId: 100,
          part: plainPart,
          options: { reply_markup: { keyboard: [] } },
        }),
      ).resolves.toEqual({
        messageId: 321,
        deliveredSignature: plainSignature("plain text"),
      });

      expect(sendRichMessage).not.toHaveBeenCalled();
      expect(sendMessage).toHaveBeenCalledWith(100, "plain text", {
        reply_markup: { keyboard: [] },
      });
    });

    it("passes the entities of a plain part through to sendMessage", async () => {
      const sendMessage = vi.fn().mockResolvedValue({ message_id: 321 });
      const sendRichMessage = vi.fn();
      const entities = [{ type: "expandable_blockquote" as const, offset: 3, length: 4 }];

      const result = await sendRenderedBotPart({
        api: { sendMessage, sendRichMessage },
        chatId: 100,
        part: { ...plainPart, entities },
      });

      expect(sendMessage).toHaveBeenCalledWith(100, "plain text", { entities });
      expect(result.deliveredSignature).not.toBe(plainSignature("plain text"));
    });

    it("retries as plain text after a rich send failure", async () => {
      const sendMessage = vi.fn().mockResolvedValue({ message_id: 222 });
      const sendRichMessage = vi.fn().mockRejectedValue(badRequestError("Bad Request: RICH_BLOCK_INVALID"));

      await expect(
        sendRenderedBotPart({
          api: { sendMessage, sendRichMessage },
          chatId: 100,
          part: { ...richPart, fallbackText: "Hello raw" },
          options: { reply_markup: { keyboard: [] } },
        }),
      ).resolves.toEqual({
        messageId: 222,
        deliveredSignature: plainSignature("Hello raw"),
        degradedToPlain: true,
      });

      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(sendMessage).toHaveBeenCalledWith(100, "Hello raw", {
        reply_markup: { keyboard: [] },
      });
    });

    it("splits an oversized plain fallback across several messages", async () => {
      const fallbackText = "x".repeat(PLAIN_MAX_PART_CHARS * 2 + 10);
      const sendMessage = vi
        .fn()
        .mockResolvedValueOnce({ message_id: 11 })
        .mockResolvedValueOnce({ message_id: 12 })
        .mockResolvedValueOnce({ message_id: 13 });
      const sendRichMessage = vi.fn().mockRejectedValue(badRequestError("Bad Request: too long"));

      const result = await sendRenderedBotPart({
        api: { sendMessage, sendRichMessage },
        chatId: 100,
        part: { ...richPart, fallbackText },
      });

      expect(sendMessage).toHaveBeenCalledTimes(3);
      for (const call of sendMessage.mock.calls) {
        expect(String(call[1]).length).toBeLessThanOrEqual(PLAIN_MAX_PART_CHARS);
      }
      expect(result).toEqual({
        messageId: 11,
        deliveredSignature: plainSignature(fallbackText),
        degradedToPlain: true,
      });
    });

    it("rethrows instead of degrading when the caller opts out", async () => {
      const sendMessage = vi.fn();
      const sendRichMessage = vi.fn().mockRejectedValue(badRequestError("Bad Request: RICH_BLOCK_INVALID"));

      await expect(
        sendRenderedBotPart({
          api: { sendMessage, sendRichMessage },
          chatId: 100,
          part: richPart,
          allowPlainFallback: false,
        }),
      ).rejects.toThrow("RICH_BLOCK_INVALID");

      expect(sendMessage).not.toHaveBeenCalled();
    });

    it.each([429, 502])("does not retry as plain text after a rich %i error", async (errorCode) => {
      const error = Object.assign(new Error(`Telegram error ${errorCode}`), { error_code: errorCode });
      const sendMessage = vi.fn();
      const sendRichMessage = vi.fn().mockRejectedValue(error);

      await expect(
        sendRenderedBotPart({
          api: { sendMessage, sendRichMessage },
          chatId: 100,
          part: richPart,
        }),
      ).rejects.toBe(error);

      expect(sendMessage).not.toHaveBeenCalled();
    });
  });

  describe("editRenderedBotPart", () => {
    it("passes the entities of a plain part through to editMessageText", async () => {
      const editMessageText = vi.fn().mockResolvedValue(undefined);
      const entities = [{ type: "blockquote" as const, offset: 3, length: 4 }];

      await editRenderedBotPart({
        api: { editMessageText },
        chatId: 100,
        messageId: 500,
        part: { ...plainPart, entities },
      });

      expect(editMessageText).toHaveBeenCalledWith(100, 500, "plain text", { entities });
    });

    it("edits with native blocks", async () => {
      const editMessageText = vi.fn().mockResolvedValue(undefined);

      await expect(
        editRenderedBotPart({
          api: { editMessageText },
          chatId: 100,
          messageId: 500,
          part: richPart,
          options: { reply_markup: { inline_keyboard: [] }, parse_mode: "MarkdownV2" },
        }),
      ).resolves.toEqual({
        deliveredSignature: getTelegramRenderedPartSignature(richPart),
      });

      expect(editMessageText).toHaveBeenCalledWith(
        100,
        500,
        { blocks: richPart.blocks },
        { reply_markup: { inline_keyboard: [] } },
      );
    });

    it("retries a failed rich edit as plain text when it fits one message", async () => {
      const editMessageText = vi
        .fn()
        .mockRejectedValueOnce(badRequestError("Bad Request: RICH_BLOCK_INVALID"))
        .mockResolvedValueOnce(undefined);

      await expect(
        editRenderedBotPart({
          api: { editMessageText },
          chatId: 100,
          messageId: 500,
          part: { ...richPart, fallbackText: "Hello raw" },
        }),
      ).resolves.toEqual({
        deliveredSignature: plainSignature("Hello raw"),
        degradedToPlain: true,
      });

      expect(editMessageText).toHaveBeenNthCalledWith(2, 100, 500, "Hello raw", undefined);
    });

    it("rethrows when the plain text would not fit a single edit", async () => {
      const editMessageText = vi.fn().mockRejectedValue(badRequestError("Bad Request: RICH_BLOCK_INVALID"));

      await expect(
        editRenderedBotPart({
          api: { editMessageText },
          chatId: 100,
          messageId: 500,
          part: { ...richPart, fallbackText: "y".repeat(5000) },
        }),
      ).rejects.toThrow("RICH_BLOCK_INVALID");

      expect(editMessageText).toHaveBeenCalledTimes(1);
    });

    it("rethrows instead of degrading when the caller opts out", async () => {
      const editMessageText = vi.fn().mockRejectedValue(badRequestError("Bad Request: RICH_BLOCK_INVALID"));

      await expect(
        editRenderedBotPart({
          api: { editMessageText },
          chatId: 100,
          messageId: 500,
          part: richPart,
          allowPlainFallback: false,
        }),
      ).rejects.toThrow("RICH_BLOCK_INVALID");

      expect(editMessageText).toHaveBeenCalledTimes(1);
    });
  });

  describe("draft transports", () => {
    it("streams native blocks as a rich draft", async () => {
      const sendMessageDraft = vi.fn();
      const sendRichMessageDraft = vi.fn().mockResolvedValue(true);

      await expect(
        sendDraftBotPart({
          api: { sendMessageDraft, sendRichMessageDraft },
          chatId: 100,
          draftId: 7,
          part: richPart,
        }),
      ).resolves.toEqual({ deliveredSignature: getTelegramRenderedPartSignature(richPart) });

      expect(sendMessageDraft).not.toHaveBeenCalled();
      expect(sendRichMessageDraft).toHaveBeenCalledWith(100, 7, { blocks: richPart.blocks });
    });

    it("streams plain parts as a text draft", async () => {
      const sendMessageDraft = vi.fn().mockResolvedValue(true);
      const sendRichMessageDraft = vi.fn();

      await expect(
        sendDraftBotPart({
          api: { sendMessageDraft, sendRichMessageDraft },
          chatId: 100,
          draftId: 7,
          part: plainPart,
        }),
      ).resolves.toEqual({ deliveredSignature: plainSignature("plain text") });

      expect(sendRichMessageDraft).not.toHaveBeenCalled();
      expect(sendMessageDraft).toHaveBeenCalledWith(100, 7, "plain text");
    });

    it("propagates draft failures instead of degrading", async () => {
      const sendMessageDraft = vi.fn();
      const sendRichMessageDraft = vi.fn().mockRejectedValue(new Error("Bad Request: draft failed"));

      await expect(
        sendDraftBotPart({
          api: { sendMessageDraft, sendRichMessageDraft },
          chatId: 100,
          draftId: 7,
          part: richPart,
        }),
      ).rejects.toThrow("draft failed");

      expect(sendMessageDraft).not.toHaveBeenCalled();
    });

    it("persists a draft as a native message", async () => {
      const sendMessage = vi.fn();
      const sendRichMessage = vi.fn().mockResolvedValue({ message_id: 900 });

      await expect(
        completeDraftPart({
          api: { sendMessage, sendRichMessage },
          chatId: 100,
          part: richPart,
          options: { disable_notification: true },
        }),
      ).resolves.toEqual({
        messageId: 900,
        deliveredSignature: getTelegramRenderedPartSignature(richPart),
      });

      expect(sendRichMessage).toHaveBeenCalledWith(
        100,
        { blocks: richPart.blocks },
        { disable_notification: true },
      );
    });

    it("propagates completion failures so the caller can resend", async () => {
      const sendMessage = vi.fn();
      const sendRichMessage = vi.fn().mockRejectedValue(new Error("Bad Request: complete failed"));

      await expect(
        completeDraftPart({
          api: { sendMessage, sendRichMessage },
          chatId: 100,
          part: richPart,
        }),
      ).rejects.toThrow("complete failed");

      expect(sendMessage).not.toHaveBeenCalled();
    });
  });
});
