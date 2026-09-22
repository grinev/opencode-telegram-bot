import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getTelegramRetryAfterMs,
  isTransientTelegramServerError,
  isUnsentTelegramNetworkError,
  withTelegramRateLimitRetry,
} from "../../src/utils/telegram-rate-limit-retry.js";

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
    vi.useFakeTimers();

    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error("429: Too Many Requests: retry after 1"))
      .mockResolvedValueOnce("ok");

    const promise = withTelegramRateLimitRetry(operation, { maxRetries: 2 });

    await vi.advanceTimersByTimeAsync(1000);

    await expect(promise).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("detects connection-not-established errors on a wrapped fetch error", () => {
    expect(isUnsentTelegramNetworkError({ error: { code: "ECONNREFUSED" } })).toBe(true);
    expect(isUnsentTelegramNetworkError({ error: { code: "ENOTFOUND" } })).toBe(true);
    expect(isUnsentTelegramNetworkError({ error: { code: "EAI_AGAIN" } })).toBe(true);
    expect(isUnsentTelegramNetworkError({ error: { type: "request-timeout" } })).toBe(true);
    expect(isUnsentTelegramNetworkError({ error: { code: "ECONNRESET" } })).toBe(false);
    expect(
      isUnsentTelegramNetworkError(
        Object.assign(
          new Error("Client network socket disconnected before secure TLS connection was established"),
          { code: "ECONNRESET" },
        ),
      ),
    ).toBe(true);
    expect(isUnsentTelegramNetworkError(new Error("Network request for 'sendMessage' failed!"))).toBe(
      false,
    );
  });

  it("retries connection-not-established errors and does not retry a reset after write", async () => {
    vi.useFakeTimers();

    const refused = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    const operation = vi.fn().mockRejectedValueOnce(refused).mockResolvedValueOnce("ok");
    const promise = withTelegramRateLimitRetry(operation, {
      maxRetries: 2,
      fallbackDelayMs: 500,
    });
    await vi.advanceTimersByTimeAsync(500);
    await expect(promise).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);

    const reset = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    const resetOperation = vi.fn().mockRejectedValueOnce(reset);
    await expect(withTelegramRateLimitRetry(resetOperation, { maxRetries: 2 })).rejects.toThrow(
      "socket hang up",
    );
    expect(resetOperation).toHaveBeenCalledTimes(1);
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
    vi.useFakeTimers();

    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error("Call to 'sendMessage' failed! (502: Bad Gateway)"))
      .mockResolvedValueOnce("ok");

    const promise = withTelegramRateLimitRetry(operation, {
      maxRetries: 3,
      fallbackDelayMs: 500,
      retryTransientServerErrors: true,
    });

    await vi.advanceTimersByTimeAsync(500);

    await expect(promise).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("does not retry transient server errors by default", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error("Call to 'sendMessage' failed! (502: Bad Gateway)"));

    await expect(withTelegramRateLimitRetry(operation, { maxRetries: 3 })).rejects.toThrow("502");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("gives up on transient server errors after maxRetries", async () => {
    vi.useFakeTimers();

    const operation = vi
      .fn()
      .mockRejectedValue(new Error("Call to 'sendMessage' failed! (503: Service Unavailable)"));

    const promise = withTelegramRateLimitRetry(operation, {
      maxRetries: 2,
      fallbackDelayMs: 500,
      retryTransientServerErrors: true,
    }).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(10_000);

    await expect(promise).resolves.toMatchObject({ message: expect.stringContaining("503") });
    expect(operation).toHaveBeenCalledTimes(3);
  });
});
