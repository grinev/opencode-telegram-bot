import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Api } from "grammy";
import { telegramOutageNoticeService } from "../../src/app/services/telegram-outage-notice-service.js";
import { flushTelegramOutageNotices } from "../../src/bot/telegram-outage-notices.js";
import { t } from "../../src/i18n/index.js";

describe("telegram-outage-notices", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    telegramOutageNoticeService.__resetForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    telegramOutageNoticeService.__resetForTests();
  });

  it("does not send when nothing is pending", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 1 });

    await flushTelegramOutageNotices({
      api: { sendMessage } as unknown as Api,
      chatId: 1,
    });

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("sends the undelivered notice and waits a second after a chat send", async () => {
    telegramOutageNoticeService.noteChatSendSucceeded();
    telegramOutageNoticeService.markAssistantReplyUndelivered();
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 1 });

    const flush = flushTelegramOutageNotices({
      api: { sendMessage } as unknown as Api,
      chatId: 1,
    });
    expect(sendMessage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    await flush;

    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("sends the busy notice for messages delayed by a long handler", async () => {
    telegramOutageNoticeService.markMessagesSkipped("busy");
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 1 });

    await flushTelegramOutageNotices({
      api: { sendMessage } as unknown as Api,
      chatId: 1,
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(1, t("bot.busy_messages_skipped"));
  });

  it("queues both reasons when a burst mixes outage and busy skips", async () => {
    telegramOutageNoticeService.markMessagesSkipped("outage");
    telegramOutageNoticeService.markMessagesSkipped("busy");
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 1 });

    const flush = flushTelegramOutageNotices({
      api: { sendMessage } as unknown as Api,
      chatId: 1,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    await flush;

    expect(sendMessage).toHaveBeenNthCalledWith(1, 1, t("bot.stale_messages_skipped"));
    expect(sendMessage).toHaveBeenNthCalledWith(2, 1, t("bot.busy_messages_skipped"));
  });

  it("spaces two notices one second apart", async () => {
    telegramOutageNoticeService.markAssistantReplyUndelivered();
    telegramOutageNoticeService.markMessagesSkipped();
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 1 });

    const flush = flushTelegramOutageNotices({
      api: { sendMessage } as unknown as Api,
      chatId: 1,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    await flush;
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it("does not duplicate when a nested flush runs in flight", async () => {
    telegramOutageNoticeService.markAssistantReplyUndelivered();
    const sendMessage = vi.fn().mockImplementation(async () => {
      await flushTelegramOutageNotices({
        api: { sendMessage } as unknown as Api,
        chatId: 1,
      });
      return { message_id: 1 };
    });

    await flushTelegramOutageNotices({
      api: { sendMessage } as unknown as Api,
      chatId: 1,
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("re-checks the one-second slot after another chat send during the wait", async () => {
    telegramOutageNoticeService.noteChatSendSucceeded();
    telegramOutageNoticeService.markAssistantReplyUndelivered();
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 1 });

    const flush = flushTelegramOutageNotices({
      api: { sendMessage } as unknown as Api,
      chatId: 1,
    });
    await vi.advanceTimersByTimeAsync(800);
    telegramOutageNoticeService.noteChatSendSucceeded();
    await vi.advanceTimersByTimeAsync(200);
    expect(sendMessage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(800);
    await flush;
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("leaves the notice pending when send fails", async () => {
    telegramOutageNoticeService.markAssistantReplyUndelivered();
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error("drop"))
      .mockResolvedValue({ message_id: 1 });

    await flushTelegramOutageNotices({
      api: { sendMessage } as unknown as Api,
      chatId: 1,
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);

    await flushTelegramOutageNotices({
      api: { sendMessage } as unknown as Api,
      chatId: 1,
    });
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });
});
