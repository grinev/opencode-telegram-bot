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

import {
  cleanupBotRuntime,
  createBot,
  shouldRetryTelegramServerError,
} from "../../src/bot/index.js";

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
    cleanupBotRuntime("test");
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
    const bot = createBot();

    const result = bot.api.editMessageText(123, 456, "updated");
    await vi.advanceTimersByTimeAsync(1000);

    await expect(result).resolves.toBe(true);
    expect(mocked.fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry a transient server error when creating a message", async () => {
    mocked.fetch.mockResolvedValueOnce(telegramApiResponse(502));
    const bot = createBot();

    await expect(bot.api.sendMessage(123, "hello")).rejects.toMatchObject({ error_code: 502 });
    expect(mocked.fetch).toHaveBeenCalledTimes(1);
  });

  it("retries a rate limit error when creating a message", async () => {
    vi.useFakeTimers();
    mocked.fetch
      .mockResolvedValueOnce(telegramApiResponse(429))
      .mockResolvedValueOnce(telegramApiResponse(200, { message_id: 1 }));
    const bot = createBot();

    const result = bot.api.sendMessage(123, "hello");
    await vi.advanceTimersByTimeAsync(1000);

    await expect(result).resolves.toEqual({ message_id: 1 });
    expect(mocked.fetch).toHaveBeenCalledTimes(2);
  });
});
