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

const { getTelegramRetryAfterMs, isTransientTelegramServerError, withTelegramRateLimitRetry } = await loadSut<typeof import("#src/utils/telegram-rate-limit-retry.js")>(
  "#src/utils/telegram-rate-limit-retry.ts",
  import.meta.url,
);

describe("utils/telegram-rate-limit-retry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("extracts retry delay from Telegram error parameters", () => {
    const retryAfterMs = getTelegramRetryAfterMs({
      error_code: 429,
      parameters: {
        retry_after: 3,
      },
    });

    expect(retryAfterMs).toBe(3000);
  });

  it("retries failed operations with Telegram retry_after", async () => {
    // accelerateTime (manual clock) instead of vi.useFakeTimers(): this SUT
    // settles a promise inside a timer callback, and on bun 1.4.0 an
    // `expect(promise).resolves/rejects` registered while fake timers are
    // active hangs when the promise settles from a fake timer. See the same
    // note in tests/app/services/edge-tts.test.ts.
    const { restore } = accelerateTime();
    try {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error("429: Too Many Requests: retry after 1"))
        .mockResolvedValueOnce("ok");

      const promise = withTelegramRateLimitRetry(operation, { maxRetries: 2 });

      await new Promise((r) => setTimeout(r, 0)); // yield for accelerated timeouts

      await expect(promise).resolves.toBe("ok");
      expect(operation).toHaveBeenCalledTimes(2);
    } finally {
      restore();
    }
  });

  it("does not retry non-retryable errors", async () => {
    const operation = vi.fn().mockRejectedValueOnce(new Error("400: Bad Request"));

    await expect(withTelegramRateLimitRetry(operation, { maxRetries: 2 })).rejects.toThrow(
      "400: Bad Request",
    );
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("detects transient Telegram server errors", () => {
    expect(isTransientTelegramServerError({ error_code: 502, description: "Bad Gateway" })).toBe(
      true,
    );
    expect(
      isTransientTelegramServerError(new Error("Call to 'sendMessage' failed! (502: Bad Gateway)")),
    ).toBe(true);
    expect(isTransientTelegramServerError({ error_code: 400 })).toBe(false);
    expect(isTransientTelegramServerError(new Error("400: Bad Request"))).toBe(false);
  });

  it("backs off exponentially for transient server errors", () => {
    const error = { error_code: 502, description: "Bad Gateway" };

    expect(getTelegramRetryAfterMs(error, 500, 0)).toBe(500);
    expect(getTelegramRetryAfterMs(error, 500, 1)).toBe(1000);
    expect(getTelegramRetryAfterMs(error, 500, 2)).toBe(2000);
  });

  it("caps the transient server error backoff", () => {
    expect(getTelegramRetryAfterMs({ error_code: 503 }, 1000, 20)).toBe(8000);
  });

  it("retries transient server errors and eventually succeeds", async () => {
    // accelerateTime (manual clock): a rejection settled from a fake timer
    // hangs `expect(promise).resolves` on bun 1.4.0 (see the note above).
    const { restore } = accelerateTime();
    try {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error("Call to 'sendMessage' failed! (502: Bad Gateway)"))
        .mockResolvedValueOnce("ok");

      const promise = withTelegramRateLimitRetry(operation, {
        maxRetries: 3,
        fallbackDelayMs: 500,
        retryTransientServerErrors: true,
      });

      await new Promise((r) => setTimeout(r, 0)); // yield for accelerated timeouts

      await expect(promise).resolves.toBe("ok");
      expect(operation).toHaveBeenCalledTimes(2);
    } finally {
      restore();
    }
  });

  it("does not retry transient server errors by default", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error("Call to 'sendMessage' failed! (502: Bad Gateway)"));

    await expect(withTelegramRateLimitRetry(operation, { maxRetries: 3 })).rejects.toThrow("502");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("gives up on transient server errors after maxRetries", async () => {
    const { restore } = accelerateTime();
    try {
      const operation = vi
        .fn()
        .mockRejectedValue(new Error("Call to 'sendMessage' failed! (503: Service Unavailable)"));

      const promise = withTelegramRateLimitRetry(operation, {
        maxRetries: 2,
        fallbackDelayMs: 500,
        retryTransientServerErrors: true,
      }).catch((error: unknown) => error);

      for (let i = 0; i < 5; i += 1) {
        await new Promise((r) => setTimeout(r, 0)); // yield for accelerated timeouts
      }

      await expect(promise).resolves.toMatchObject({ message: expect.stringContaining("503") });
      expect(operation).toHaveBeenCalledTimes(3);
    } finally {
      restore();
    }
  });
});
