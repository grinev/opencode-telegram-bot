import { beforeEach, describe, expect, it, vi } from "vitest";
import { InputFile } from "grammy";
const { readImage } = vi.hoisted(() => ({ readImage: vi.fn() }));
vi.mock("../../../src/app/services/assistant-image-service.js", () => ({
  readAssistantImage: readImage,
}));
import {
  completeDraftPart,
  editRenderedBotPart,
  sendRenderedBotPart,
} from "../../../src/bot/messages/telegram-text.js";
import { renderTelegramParts } from "../../../src/bot/render/pipeline.js";
import { getTelegramRenderedPartSignature } from "../../../src/bot/render/part-signature.js";
import { defined } from "../../helpers/defined.js";

function imagePart(text = "**before** ![name](a.png) after") {
  return {
    ...defined(renderTelegramParts(text, undefined, true)[0]),
    imageDirectory: "/remote/project",
  };
}

describe("assistant image delivery", () => {
  it("retains good photos when Telegram rejects another member of the rich reply", async () => {
    const invalid = Object.assign(new Error("IMAGE_PROCESS_FAILED"), { error_code: 400 });
    const sendRichMessage = vi
      .fn()
      .mockRejectedValueOnce(invalid)
      .mockResolvedValueOnce({ message_id: 42 });
    const editMessageText = vi.fn().mockImplementation(async (_chat, _id, message) => {
      if (message.blocks[1]?.type === "photo") throw invalid;
      return true;
    });
    await sendRenderedBotPart({
      api: { sendMessage: vi.fn(), sendRichMessage, editMessageText },
      chatId: 1,
      part: imagePart("![good](good.png)\n\n![bad](bad.jpg)"),
    });
    expect(sendRichMessage).toHaveBeenCalledTimes(2);
    expect(editMessageText).toHaveBeenCalledTimes(2);
    const last = editMessageText.mock.calls.at(-2);
    expect(last?.[1]).toBe(42);
    expect(last?.[2].blocks.map((block: { type: string }) => block.type)).toEqual([
      "photo",
      "paragraph",
    ]);
    expect(last?.[2].blocks[1].text).toContain("bad");
  });

  it("continues to good photos when the first candidate is rejected without changing its notice", async () => {
    const invalid = Object.assign(new Error("IMAGE_PROCESS_FAILED"), { error_code: 400 });
    const sendRichMessage = vi
      .fn()
      .mockRejectedValueOnce(invalid)
      .mockResolvedValueOnce({ message_id: 42 });
    const editMessageText = vi.fn().mockImplementation(async (_chat, _id, message) => {
      if (message.blocks[0]?.type === "photo") throw invalid;
      if (message.blocks.every((block: { type: string }) => block.type === "paragraph")) {
        throw Object.assign(new Error("MESSAGE_NOT_MODIFIED"), { error_code: 400 });
      }
      return true;
    });
    await sendRenderedBotPart({
      api: { sendMessage: vi.fn(), sendRichMessage, editMessageText },
      chatId: 1,
      part: imagePart("![bad](bad.jpg)\n\n![good](good.png)"),
    });
    expect(sendRichMessage).toHaveBeenCalledTimes(2);
    expect(editMessageText).toHaveBeenCalledTimes(2);
    const final = editMessageText.mock.calls.at(-1)?.[2];
    expect(final.blocks.map((block: { type: string }) => block.type)).toEqual([
      "paragraph",
      "photo",
    ]);
    expect(final.blocks[0].text).toContain("bad");
  });

  it("does not issue another send after an ambiguous correction edit", async () => {
    const sendRichMessage = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("IMAGE_PROCESS_FAILED"), { error_code: 400 }))
      .mockResolvedValueOnce({ message_id: 42 });
    const editMessageText = vi.fn().mockRejectedValue(new Error("ambiguous edit"));
    await expect(
      sendRenderedBotPart({
        api: { sendMessage: vi.fn(), sendRichMessage, editMessageText },
        chatId: 1,
        part: imagePart("![one](one.png)\n\n![two](two.png)"),
      }),
    ).rejects.toThrow("ambiguous edit");
    expect(sendRichMessage).toHaveBeenCalledTimes(2);
    expect(editMessageText).toHaveBeenCalledTimes(1);
  });

  it("delivers a short notice for an image-only reply with an oversized alt", async () => {
    readImage.mockResolvedValueOnce({ reason: "unavailable" });
    const sendRichMessage = vi.fn().mockResolvedValue({ message_id: 1 });
    await sendRenderedBotPart({
      api: { sendMessage: vi.fn(), sendRichMessage },
      chatId: 1,
      part: imagePart(`![${"x".repeat(33000)}](missing.png)`),
    });
    expect(sendRichMessage.mock.calls[0]?.[1].blocks[0].text.length).toBeLessThan(400);
  });
  beforeEach(() => {
    readImage
      .mockReset()
      .mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), filename: "a.png" });
  });

  it.each(["send", "edit", "draft completion"])(
    "uploads only inside the final rich part (%s)",
    async (mode) => {
      const part = imagePart();
      const signature = getTelegramRenderedPartSignature(part);
      const api = {
        sendMessage: vi.fn(),
        sendRichMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
        editMessageText: vi.fn().mockResolvedValue(true),
      };
      if (mode === "edit") await editRenderedBotPart({ api, chatId: 1, messageId: 2, part });
      else if (mode === "send") await sendRenderedBotPart({ api, chatId: 1, part });
      else await completeDraftPart({ api, chatId: 1, part });
      const payload =
        mode === "edit"
          ? api.editMessageText.mock.calls[0]?.[2]
          : api.sendRichMessage.mock.calls[0]?.[1];
      expect(payload.blocks.map((block: { type: string }) => block.type)).toEqual([
        "paragraph",
        "photo",
        "paragraph",
      ]);
      expect(payload.blocks[1].photo.media).toBeInstanceOf(InputFile);
      expect(payload.blocks[1].caption).toBeUndefined();
      expect(readImage).toHaveBeenCalledWith("/remote/project", "a.png");
      expect(api.sendMessage).not.toHaveBeenCalled();
      expect(getTelegramRenderedPartSignature(part)).toBe(signature);
    },
  );

  it.each(["unavailable", "unsupported", "too_large"])(
    "replaces unavailable image-only replies with a notice (%s)",
    async (reason) => {
      readImage.mockResolvedValueOnce({ reason });
      const sendRichMessage = vi.fn().mockResolvedValue({ message_id: 1 });
      await sendRenderedBotPart({
        api: { sendMessage: vi.fn(), sendRichMessage },
        chatId: 1,
        part: imagePart("![name](missing.png)"),
      });
      expect(sendRichMessage.mock.calls[0]?.[1].blocks[0]).toMatchObject({
        type: "paragraph",
        text: expect.stringContaining("name"),
      });
    },
  );

  it("retries only definite photo rejections as notices and never as separate media/text messages", async () => {
    const sendRichMessage = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("PHOTO_INVALID_DIMENSIONS"), { error_code: 400 }),
      )
      .mockResolvedValueOnce({ message_id: 1 });
    const sendMessage = vi.fn();
    await sendRenderedBotPart({
      api: { sendMessage, sendRichMessage },
      chatId: 1,
      part: imagePart(),
    });
    expect(sendRichMessage).toHaveBeenCalledTimes(2);
    expect(sendRichMessage.mock.calls[1]?.[1].blocks[1]).toMatchObject({ type: "paragraph" });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("does not resend after an ambiguous rich-send failure", async () => {
    const sendRichMessage = vi.fn().mockRejectedValue(new Error("connection reset"));
    const sendMessage = vi.fn();
    await expect(
      sendRenderedBotPart({ api: { sendMessage, sendRichMessage }, chatId: 1, part: imagePart() }),
    ).rejects.toThrow("connection reset");
    expect(sendRichMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("does not send old images if the foreground session changes during file reads", async () => {
    let current = true;
    readImage.mockImplementationOnce(async () => {
      current = false;
      return { bytes: new Uint8Array([1]), filename: "a.png" };
    });
    const sendRichMessage = vi.fn();
    await expect(
      sendRenderedBotPart({
        api: { sendMessage: vi.fn(), sendRichMessage },
        chatId: 1,
        part: { ...imagePart(), canDeliver: () => current },
      }),
    ).rejects.toThrow("session change");
    expect(sendRichMessage).not.toHaveBeenCalled();
  });

  it("reads current bytes again on an intentional replay", async () => {
    const api = {
      sendMessage: vi.fn(),
      sendRichMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
    };
    await sendRenderedBotPart({ api, chatId: 1, part: imagePart() });
    await sendRenderedBotPart({ api, chatId: 1, part: imagePart() });
    expect(readImage).toHaveBeenCalledTimes(2);
  });
});
