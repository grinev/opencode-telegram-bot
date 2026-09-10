import { afterEach, describe, expect, it, vi } from "#vitest";
import { loadSut } from "#helpers/sut-loader.js";
const _$rt = globalThis.setTimeout;

function accelerateTime(): { restore: () => void } {
  const _origDn = Date.now;
  let _ft = _origDn();
  Date.now = () => _ft;
  globalThis.setTimeout = ((cb: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    if ((ms ?? 0) > 0) _ft += ms!;
    return _$rt(cb, 0, ...args);
  }) as typeof globalThis.setTimeout;
  return {
    restore() {
      globalThis.setTimeout = _$rt;
      Date.now = _origDn;
    },
  };
}
const mocked = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.mock("../../src/utils/safe-background-task.js", () => ({
  safeBackgroundTask: vi.fn(),
}));

vi.mock("../../src/bot/telegram-client-options.js", () => ({
  createTelegramBotOptions: () => ({ client: { fetch: mocked.fetch } }),
}));

const { cleanupBotRuntime, createBot, shouldRetryTelegramServerError } =
  await loadSut<typeof import("#src/bot/index.js")>(
    "#src/bot/index.ts",
    import.meta.url,
  );

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
    // accelerateTime (manual clock) instead of vi.useFakeTimers(): this SUT
    // settles a promise inside a timer callback, and on bun 1.4.0 an
    // `expect(promise).resolves/rejects` registered while fake timers are
    // active hangs when the promise settles from a fake timer. See the same
    // note in tests/utils/telegram-rate-limit-retry.test.ts.
    const { restore } = accelerateTime();
    try {
      mocked.fetch
        .mockResolvedValueOnce(telegramApiResponse(502))
        .mockResolvedValueOnce(telegramApiResponse(200, true));
      const bot = createBot();

      const result = bot.api.editMessageText(123, 456, "updated");

      await new Promise((r) => setTimeout(r, 0)); // yield for accelerated timeouts

      await expect(result).resolves.toBe(true);
      expect(mocked.fetch).toHaveBeenCalledTimes(2);
    } finally {
      restore();
    }
  });

  it("does not retry a transient server error when creating a message", async () => {
    mocked.fetch.mockResolvedValueOnce(telegramApiResponse(502));
    const bot = createBot();

    await expect(bot.api.sendMessage(123, "hello")).rejects.toMatchObject({ error_code: 502 });
    expect(mocked.fetch).toHaveBeenCalledTimes(1);
  });

  it("retries a rate limit error when creating a message", async () => {
    const { restore } = accelerateTime();
    try {
      mocked.fetch
        .mockResolvedValueOnce(telegramApiResponse(429))
        .mockResolvedValueOnce(telegramApiResponse(200, { message_id: 1 }));
      const bot = createBot();

      const result = bot.api.sendMessage(123, "hello");

      await new Promise((r) => setTimeout(r, 0)); // yield for accelerated timeouts

      await expect(result).resolves.toEqual({ message_id: 1 });
      expect(mocked.fetch).toHaveBeenCalledTimes(2);
    } finally {
      restore();
    }
  });
});
