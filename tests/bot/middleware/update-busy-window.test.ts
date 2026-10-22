import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Context, NextFunction } from "grammy";
import { updateBusyWindowMiddleware } from "../../../src/bot/middleware/update-busy-window.js";
import { updateBusyWindowService } from "../../../src/app/services/update-busy-window-service.js";
import { telegramOutageNoticeService } from "../../../src/app/services/telegram-outage-notice-service.js";
import { t } from "../../../src/i18n/index.js";
import { logger } from "../../../src/utils/logger.js";

const NOW_MS = Date.UTC(2026, 6, 27, 12, 0, 0);

function createNext(advanceMs: number): NextFunction {
  return vi.fn(async () => {
    vi.setSystemTime(NOW_MS + advanceMs);
  }) as unknown as NextFunction;
}

function createChatContext(sendMessage: ReturnType<typeof vi.fn>): Context {
  return { chat: { id: 1 }, api: { sendMessage } } as unknown as Context;
}

describe("updateBusyWindowMiddleware", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
    updateBusyWindowService.__resetForTests();
    telegramOutageNoticeService.__resetForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    updateBusyWindowService.__resetForTests();
    telegramOutageNoticeService.__resetForTests();
  });

  it("records a window for a handler that outlives the busy-record threshold", async () => {
    await updateBusyWindowMiddleware({} as Context, createNext(90_000));

    expect(updateBusyWindowService.covers(NOW_MS + 30_000)).toBe(true);
  });

  it("does not record a short handler", async () => {
    await updateBusyWindowMiddleware({} as Context, createNext(10_000));

    expect(updateBusyWindowService.covers(NOW_MS + 5_000)).toBe(false);
  });

  it("records the window even when the handler throws", async () => {
    const next = vi.fn(async () => {
      vi.setSystemTime(NOW_MS + 90_000);
      throw new Error("handler failed");
    }) as unknown as NextFunction;

    await expect(updateBusyWindowMiddleware({} as Context, next)).rejects.toThrow("handler failed");

    expect(updateBusyWindowService.covers(NOW_MS + 30_000)).toBe(true);
  });

  it("sends the busy notice when a handler blocks the chat silently for five seconds", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 1 });
    const next = vi.fn(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    }) as unknown as NextFunction;

    await updateBusyWindowMiddleware(createChatContext(sendMessage), next);

    expect(sendMessage).toHaveBeenCalledWith(1, t("bot.busy_operation"));
  });

  it("does not send the busy notice for a short handler", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 1 });
    const next = vi.fn(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    }) as unknown as NextFunction;

    await updateBusyWindowMiddleware(createChatContext(sendMessage), next);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("does not send the busy notice when the chat already shows progress", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 1 });
    const next = vi.fn(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
      telegramOutageNoticeService.noteChatSendSucceeded();
      await vi.advanceTimersByTimeAsync(3_000);
    }) as unknown as NextFunction;

    await updateBusyWindowMiddleware(createChatContext(sendMessage), next);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("sends the busy notice after an early chat update stops being recent", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 1 });
    const next = vi.fn(async () => {
      await vi.advanceTimersByTimeAsync(500);
      telegramOutageNoticeService.noteChatSendSucceeded();
      await vi.advanceTimersByTimeAsync(20_000);
    }) as unknown as NextFunction;

    await updateBusyWindowMiddleware(createChatContext(sendMessage), next);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(1, t("bot.busy_operation"));
  });

  it("logs and continues when the busy notice cannot be sent", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const sendMessage = vi.fn().mockRejectedValue(new Error("drop"));
    const next = vi.fn(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    }) as unknown as NextFunction;

    await updateBusyWindowMiddleware(createChatContext(sendMessage), next);
    await vi.advanceTimersByTimeAsync(0);

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
