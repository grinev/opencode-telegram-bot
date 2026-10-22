import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Context, NextFunction } from "grammy";

const mocked = vi.hoisted(() => ({
  loggerDebugMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    debug: mocked.loggerDebugMock,
    info: mocked.loggerInfoMock,
    warn: mocked.loggerWarnMock,
    error: mocked.loggerErrorMock,
  },
}));

import { staleUpdateMiddleware } from "../../../src/bot/middleware/stale-update.js";
import { telegramOutageNoticeService } from "../../../src/app/services/telegram-outage-notice-service.js";
import { updateBusyWindowService } from "../../../src/app/services/update-busy-window-service.js";
import { t } from "../../../src/i18n/index.js";

const NOW_MS = Date.UTC(2026, 6, 27, 12, 0, 0);
const NOW_SECONDS = Math.floor(NOW_MS / 1000);

function createMessageContext(
  ageSeconds: number,
  api?: { sendMessage: ReturnType<typeof vi.fn> },
): Context {
  return {
    update: { update_id: 1000 },
    chat: { id: 1 },
    api,
    message: {
      message_id: 42,
      date: NOW_SECONDS - ageSeconds,
      text: "hello",
    } as Context["message"],
  } as unknown as Context;
}

function createCallbackContext(messageAgeSeconds: number): Context {
  return {
    update: { update_id: 1001 },
    callbackQuery: {
      data: "project:123",
      message: {
        message_id: 43,
        date: NOW_SECONDS - messageAgeSeconds,
      },
    } as unknown as Context["callbackQuery"],
  } as unknown as Context;
}

function createUpdateWithoutMessage(): Context {
  return {
    update: { update_id: 1002 },
    myChatMember: { date: NOW_SECONDS },
  } as unknown as Context;
}

describe("staleUpdateMiddleware", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
    mocked.loggerWarnMock.mockReset();
    telegramOutageNoticeService.__resetForTests();
    updateBusyWindowService.__resetForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes through a fresh message", async () => {
    const ctx = createMessageContext(0);
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await staleUpdateMiddleware(ctx, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(mocked.loggerWarnMock).not.toHaveBeenCalled();
  });

  it("passes through a message exactly at the age threshold", async () => {
    const ctx = createMessageContext(60);
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await staleUpdateMiddleware(ctx, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(mocked.loggerWarnMock).not.toHaveBeenCalled();
  });

  it("drops a message just past the age threshold and logs a warning", async () => {
    const ctx = createMessageContext(61);
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await staleUpdateMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(mocked.loggerWarnMock).toHaveBeenCalledTimes(1);
  });

  it("drops a message queued for an hour", async () => {
    const ctx = createMessageContext(3600);
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await staleUpdateMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(mocked.loggerWarnMock).toHaveBeenCalledTimes(1);
  });

  it("always passes through a callback query, even under an old bot message", async () => {
    const ctx = createCallbackContext(6 * 3600);
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await staleUpdateMiddleware(ctx, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(mocked.loggerWarnMock).not.toHaveBeenCalled();
  });

  it("passes through an update without a message", async () => {
    const ctx = createUpdateWithoutMessage();
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await staleUpdateMiddleware(ctx, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(mocked.loggerWarnMock).not.toHaveBeenCalled();
  });

  it("sends one skip notice for a stale burst and not for the next stale", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 1 });
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await staleUpdateMiddleware(createMessageContext(61, { sendMessage }), next);
    await staleUpdateMiddleware(createMessageContext(90, { sendMessage }), next);

    expect(next).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("retries a failed skip notice on the next inbound", async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error("drop"))
      .mockResolvedValue({ message_id: 1 });
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await staleUpdateMiddleware(createMessageContext(61, { sendMessage }), next);
    await staleUpdateMiddleware(createMessageContext(62, { sendMessage }), next);

    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it("sends a skip notice again after a 60-second gap", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 1 });
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await staleUpdateMiddleware(createMessageContext(61, { sendMessage }), next);
    vi.setSystemTime(NOW_MS + 61_000);
    await staleUpdateMiddleware(createMessageContext(61, { sendMessage }), next);

    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it("flushes a pending undelivered notice on a fresh inbound", async () => {
    telegramOutageNoticeService.markAssistantReplyUndelivered();
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 1 });
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await staleUpdateMiddleware(createMessageContext(0, { sendMessage }), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("runs a message at the busy-cancel boundary", async () => {
    updateBusyWindowService.record(NOW_MS - 120_000, NOW_MS - 10_000);
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 1 });
    const ctx = createMessageContext(15, { sendMessage });
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await staleUpdateMiddleware(ctx, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(mocked.loggerWarnMock).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("drops a message delayed by a busy bot past the cancel window with the busy notice", async () => {
    updateBusyWindowService.record(NOW_MS - 20 * 60_000, NOW_MS - 10_000);
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 1 });
    const ctx = createMessageContext(16, { sendMessage });
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await staleUpdateMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(mocked.loggerWarnMock).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(1, t("bot.busy_messages_skipped"));
  });

  it("runs a transport-delayed message without a busy window", async () => {
    const ctx = createMessageContext(30);
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await staleUpdateMiddleware(ctx, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(mocked.loggerWarnMock).not.toHaveBeenCalled();
  });

  it("prefers the busy notice for an old message covered by a busy window", async () => {
    updateBusyWindowService.record(NOW_MS - 30 * 60_000, NOW_MS - 10_000);
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 1 });
    const ctx = createMessageContext(61, { sendMessage });
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await staleUpdateMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(1, t("bot.busy_messages_skipped"));
  });

  it("keeps the outage notice for a stale message outside busy windows", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 1 });
    const ctx = createMessageContext(61, { sendMessage });
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await staleUpdateMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(1, t("bot.stale_messages_skipped"));
  });

  it("passes through a message dated in the future when clocks drift", async () => {
    const ctx = createMessageContext(-30);
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await staleUpdateMiddleware(ctx, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(mocked.loggerWarnMock).not.toHaveBeenCalled();
  });
});
