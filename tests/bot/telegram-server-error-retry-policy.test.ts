import { afterEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.mock("../../src/utils/safe-background-task.js", () => ({
  safeBackgroundTask: vi.fn(),
}));

vi.mock("../../src/bot/telegram-client-options.js", () => ({
  createTelegramBotOptions: () => ({ client: { fetch: mocked.fetch } }),
}));

import { createBot, shouldRetryTelegramServerError } from "../../src/bot/index.js";
import { createTestAppContainer } from "../helpers/app-container.js";
import { telegramOutageNoticeService } from "../../src/app/services/telegram-outage-notice-service.js";
import { flushTelegramOutageNotices } from "../../src/bot/telegram-outage-notices.js";

const container = createTestAppContainer();

function telegramApiResponse(errorCode: number, result?: unknown): { json(): Promise<unknown> } {
  if (errorCode === 200) {
    return { json: () => Promise.resolve({ ok: true, result }) };
  }

  return {
    json: () =>
      Promise.resolve({
        ok: false,
        error_code: errorCode,
        description: `Telegram error ${errorCode}`,
        ...(errorCode === 429 ? { parameters: { retry_after: 1 } } : {}),
      }),
  };
}

describe("bot Telegram 5xx retry policy", () => {
  afterEach(() => {
    container.cleanupProcess("test");
    telegramOutageNoticeService.__resetForTests();
    vi.useRealTimers();
    mocked.fetch.mockReset();
  });

  it("allows retries only for safe state-update methods", () => {
    for (const method of [
      "editMessageReplyMarkup",
      "editMessageText",
      "sendChatAction",
      "sendMessageDraft",
      "sendRichMessageDraft",
    ]) {
      expect(shouldRetryTelegramServerError(method)).toBe(true);
    }
  });

  it("does not retry message creation or unknown methods after 5xx", () => {
    for (const method of [
      "sendMessage",
      "sendRichMessage",
      "sendDocument",
      "sendAudio",
      "deleteMessage",
      "unknownMethod",
    ]) {
      expect(shouldRetryTelegramServerError(method)).toBe(false);
    }
  });

  it("retries a transient server error for a safe edit method", async () => {
    vi.useFakeTimers();
    mocked.fetch
      .mockResolvedValueOnce(telegramApiResponse(502))
      .mockResolvedValueOnce(telegramApiResponse(200, true));
    const bot = createBot(container);

    const result = bot.api.editMessageText(123, 456, "updated");
    await vi.advanceTimersByTimeAsync(1000);

    await expect(result).resolves.toBe(true);
    expect(mocked.fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry a transient server error when creating a message", async () => {
    mocked.fetch.mockResolvedValueOnce(telegramApiResponse(502));
    const bot = createBot(container);

    await expect(bot.api.sendMessage(123, "hello")).rejects.toMatchObject({ error_code: 502 });
    expect(mocked.fetch).toHaveBeenCalledTimes(1);
  });

  it("retries a rate limit error when creating a message", async () => {
    vi.useFakeTimers();
    mocked.fetch
      .mockResolvedValueOnce(telegramApiResponse(429))
      .mockResolvedValueOnce(telegramApiResponse(200, { message_id: 1 }));
    const bot = createBot(container);

    const result = bot.api.sendMessage(123, "hello");
    await vi.advanceTimersByTimeAsync(1000);

    await expect(result).resolves.toEqual({ message_id: 1 });
    expect(mocked.fetch).toHaveBeenCalledTimes(2);
  });

  it("retries a connection-not-established error when creating a message", async () => {
    vi.useFakeTimers();
    const refused = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    mocked.fetch
      .mockRejectedValueOnce(refused)
      .mockResolvedValueOnce(telegramApiResponse(200, { message_id: 1 }));
    const bot = createBot(container);

    const result = bot.api.sendMessage(123, "hello");
    await vi.advanceTimersByTimeAsync(1000);

    await expect(result).resolves.toEqual({ message_id: 1 });
    expect(mocked.fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry a connection reset when creating a message", async () => {
    const reset = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    mocked.fetch.mockRejectedValueOnce(reset);
    const bot = createBot(container);

    await expect(bot.api.sendMessage(123, "hello")).rejects.toThrow(
      "Network request for 'sendMessage' failed!",
    );
    expect(mocked.fetch).toHaveBeenCalledTimes(1);
  });

  it("does not retry a rate limit when sending an outage notice", async () => {
    mocked.fetch.mockResolvedValue(telegramApiResponse(429));
    const bot = createBot(container);
    telegramOutageNoticeService.markAssistantReplyUndelivered();

    await flushTelegramOutageNotices({ api: bot.api, chatId: 123 });

    expect(mocked.fetch).toHaveBeenCalledTimes(1);
  });

  it("still retries a concurrent send while an outage notice fetch is pending", async () => {
    vi.useFakeTimers();
    let releaseNotice: ((value: { json(): Promise<unknown> }) => void) | undefined;
    const refused = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    mocked.fetch
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseNotice = resolve;
          }),
      )
      .mockRejectedValueOnce(refused)
      .mockResolvedValue(telegramApiResponse(200, { message_id: 2 }));
    const bot = createBot(container);
    telegramOutageNoticeService.markAssistantReplyUndelivered();

    const notice = flushTelegramOutageNotices({ api: bot.api, chatId: 123 });
    await vi.waitFor(() => {
      expect(releaseNotice).toBeDefined();
    });

    const other = bot.api.sendMessage(123, "hello");
    await vi.advanceTimersByTimeAsync(1000);
    await expect(other).resolves.toEqual({ message_id: 2 });

    releaseNotice?.(telegramApiResponse(429));
    await notice;
    expect(mocked.fetch).toHaveBeenCalledTimes(3);
  });

  it("does not apply the API transformer retry to startup-managed methods", async () => {
    mocked.fetch.mockResolvedValue(telegramApiResponse(429));
    const bot = createBot(container);

    await expect(bot.api.getWebhookInfo()).rejects.toMatchObject({ error_code: 429 });
    expect(mocked.fetch).toHaveBeenCalledTimes(1);
  });
});
