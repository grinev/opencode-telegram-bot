/**
 * Telegram occasionally answers with a transient gateway error (`502 Bad
 * Gateway` is the common one) instead of a proper Bot API response. These are
 * not caller mistakes and usually succeed on the next attempt, so they are
 * retried with an exponential backoff just like `429` is retried with the
 * server-provided `retry_after`.
 */
const TRANSIENT_SERVER_ERROR_CODES = new Set([500, 502, 503, 504]);

const MAX_SERVER_ERROR_BACKOFF_MS = 8000;

interface RetryAttemptInfo {
  attempt: number;
  retryAfterMs: number;
  error: unknown;
}

interface TelegramRateLimitRetryOptions {
  maxRetries?: number;
  fallbackDelayMs?: number;
  retryTransientServerErrors?: boolean;
  onRetry?: (info: RetryAttemptInfo) => void;
}

function getErrorMessage(error: unknown): string {
  const parts: string[] = [];

  if (error instanceof Error) {
    parts.push(error.message);
  }

  if (typeof error === "object" && error !== null) {
    const description = Reflect.get(error, "description");
    if (typeof description === "string") {
      parts.push(description);
    }

    const message = Reflect.get(error, "message");
    if (typeof message === "string") {
      parts.push(message);
    }
  }

  if (typeof error === "string") {
    parts.push(error);
  }

  return parts.join("\n");
}

function getRetryAfterSecondsFromError(error: unknown): number | null {
  if (typeof error === "object" && error !== null) {
    const parameters = Reflect.get(error, "parameters");
    if (typeof parameters === "object" && parameters !== null) {
      const retryAfter = Reflect.get(parameters, "retry_after");
      if (typeof retryAfter === "number" && Number.isFinite(retryAfter) && retryAfter > 0) {
        return retryAfter;
      }
    }
  }

  const message = getErrorMessage(error);
  const retryMatch = message.match(/retry after\s+(\d+)/i);
  if (!retryMatch) {
    return null;
  }

  const secondsText = retryMatch[1];
  if (!secondsText) {
    return null;
  }
  const parsedSeconds = Number.parseInt(secondsText, 10);
  if (!Number.isFinite(parsedSeconds) || parsedSeconds <= 0) {
    return null;
  }

  return parsedSeconds;
}

function getStatusCode(error: unknown): number | null {
  if (typeof error === "object" && error !== null) {
    const status = Reflect.get(error, "status");
    if (typeof status === "number" && Number.isFinite(status)) {
      return status;
    }

    const errorCode = Reflect.get(error, "error_code");
    if (typeof errorCode === "number" && Number.isFinite(errorCode)) {
      return errorCode;
    }
  }

  return null;
}

function isTelegramRateLimitError(error: unknown): boolean {
  if (getStatusCode(error) === 429) {
    return true;
  }

  const message = getErrorMessage(error).toLowerCase();
  return /\b429\b/.test(message) || message.includes("too many requests");
}

export function isTransientTelegramServerError(error: unknown): boolean {
  const status = getStatusCode(error);
  if (status !== null) {
    return TRANSIENT_SERVER_ERROR_CODES.has(status);
  }

  const message = getErrorMessage(error);
  return [...TRANSIENT_SERVER_ERROR_CODES].some((code) =>
    new RegExp(`\\b${code}\\b`).test(message),
  );
}

function getServerErrorBackoffMs(attempt: number, baseDelayMs: number): number {
  const normalizedAttempt = Math.max(0, Math.floor(attempt));
  const delayMs = baseDelayMs * 2 ** normalizedAttempt;
  return Math.min(Math.max(1, Math.floor(delayMs)), MAX_SERVER_ERROR_BACKOFF_MS);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Returns how long to wait before retrying, or `null` when the error is not
 * worth retrying. `attempt` is the number of retries already performed and only
 * affects the transient-server-error backoff.
 */
export function getTelegramRetryAfterMs(
  error: unknown,
  fallbackDelayMs: number = 1000,
  attempt: number = 0,
): number | null {
  if (isTelegramRateLimitError(error)) {
    const retryAfterSeconds = getRetryAfterSecondsFromError(error);
    if (retryAfterSeconds !== null) {
      return retryAfterSeconds * 1000;
    }

    return Math.max(1, Math.floor(fallbackDelayMs));
  }

  if (isTransientTelegramServerError(error)) {
    return getServerErrorBackoffMs(attempt, fallbackDelayMs);
  }

  return null;
}

export async function withTelegramRateLimitRetry<T>(
  operation: () => Promise<T>,
  options?: TelegramRateLimitRetryOptions,
): Promise<T> {
  const maxRetries = Math.max(0, Math.floor(options?.maxRetries ?? 3));
  const fallbackDelayMs = options?.fallbackDelayMs ?? 1000;
  const retryTransientServerErrors = options?.retryTransientServerErrors ?? false;

  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      const retryAfterMs = getTelegramRetryAfterMs(error, fallbackDelayMs, attempt);
      if (
        retryAfterMs === null ||
        (!retryTransientServerErrors && isTransientTelegramServerError(error)) ||
        attempt >= maxRetries
      ) {
        throw error;
      }

      attempt += 1;
      options?.onRetry?.({
        attempt,
        retryAfterMs,
        error,
      });
      await wait(retryAfterMs);
    }
  }
}
