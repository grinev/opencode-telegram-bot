import { describe, expect, it, vi } from "vitest";
import {
  TelegramEventDelivery,
  type TelegramDestination,
} from "../../../src/bot/events/telegram-event-delivery.js";

function createDestination() {
  const api = {
    sendMessage: vi.fn().mockResolvedValue({ message_id: 10 }),
    sendMessageDraft: vi.fn().mockResolvedValue(true),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(true),
  };

  return { api, destination: { api, chatId: 42 } as unknown as TelegramDestination };
}

function plainPart(text: string) {
  return { blocks: [], fallbackText: text, source: "plain" as const };
}

const rateLimitError = Object.assign(new Error("Too Many Requests: retry after 3"), {
  error_code: 429,
});

describe("bot/events/telegram-event-delivery", () => {
  it("sends to the destination it is given", async () => {
    const { api, destination } = createDestination();

    const messageId = await new TelegramEventDelivery().sendText(destination, "hello");

    expect(messageId).toBe(10);
    expect(api.sendMessage).toHaveBeenCalledWith(42, "hello");
  });

  it("tolerates an edit that changes nothing and a delete of a missing message", async () => {
    const { api, destination } = createDestination();
    const delivery = new TelegramEventDelivery();
    api.editMessageText.mockRejectedValueOnce(new Error("Bad Request: message is not modified"));
    api.deleteMessage
      .mockRejectedValueOnce(new Error("Bad Request: message to delete not found"))
      .mockRejectedValueOnce(new Error("Bad Request: message identifier is not specified"));

    await expect(delivery.editText(destination, 1, "same")).resolves.toBeUndefined();
    await expect(delivery.deleteText(destination, 1)).resolves.toBeUndefined();
    await expect(delivery.deleteText(destination, 2)).resolves.toBeUndefined();
  });

  it("passes a rate limit and other failures on so the streamers can retry", async () => {
    const { api, destination } = createDestination();
    const delivery = new TelegramEventDelivery();
    api.editMessageText.mockRejectedValueOnce(rateLimitError);
    api.deleteMessage.mockRejectedValueOnce(rateLimitError);
    api.sendMessage.mockRejectedValueOnce(new Error("Bad Request: chat not found"));

    await expect(delivery.editText(destination, 1, "text")).rejects.toBe(rateLimitError);
    await expect(delivery.deleteText(destination, 1)).rejects.toBe(rateLimitError);
    await expect(delivery.sendText(destination, "text")).rejects.toThrow("chat not found");
  });

  it("numbers drafts in sequence until it is reset", async () => {
    const { api, destination } = createDestination();
    const delivery = new TelegramEventDelivery();

    const first = await delivery.sendDraftPart(destination, plainPart("one"));
    const second = await delivery.sendDraftPart(destination, plainPart("two"));
    delivery.resetDraftIds();
    const afterReset = await delivery.sendDraftPart(destination, plainPart("three"));

    expect([first.messageId, second.messageId, afterReset.messageId]).toEqual([1, 2, 1]);
    expect(api.sendMessageDraft).toHaveBeenNthCalledWith(2, 42, 2, "two");
  });

  it("keeps the agent's link preview and leaves the bot's text to the default", async () => {
    const { api, destination } = createDestination();
    const delivery = new TelegramEventDelivery();
    const agentPreview = { link_preview_options: { is_disabled: false } };

    await delivery.sendRenderedPart(destination, plainPart("reply"), {
      disable_notification: true,
    });
    await delivery.editRenderedPart(destination, 10, plainPart("reply, edited"));
    await delivery.completeDraftPart(destination, plainPart("draft reply"));
    await delivery.sendText(destination, "🌐 webfetch https://example.com/");

    expect(api.sendMessage).toHaveBeenNthCalledWith(1, 42, "reply", {
      disable_notification: true,
      ...agentPreview,
    });
    expect(api.editMessageText).toHaveBeenCalledWith(42, 10, "reply, edited", agentPreview);
    expect(api.sendMessage).toHaveBeenNthCalledWith(2, 42, "draft reply", agentPreview);
    expect(api.sendMessage).toHaveBeenNthCalledWith(3, 42, "🌐 webfetch https://example.com/");
  });
});
