const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;

export const STREAM_THROTTLE_BASE_MS = SECOND_MS;
export const STREAM_THROTTLE_MAX_MS = 10 * SECOND_MS;

const TIER_TWO_AFTER_MS = MINUTE_MS;
const TIER_FIVE_AFTER_MS = 5 * MINUTE_MS;
const TIER_TEN_AFTER_MS = 15 * MINUTE_MS;

export type StreamThrottleMs = number | ((sessionId: string) => number);

const startedAtBySession = new Map<string, number>();

export function resolveProgressiveThrottleMs(elapsedMs: number): number {
  if (elapsedMs < TIER_TWO_AFTER_MS) {
    return STREAM_THROTTLE_BASE_MS;
  }

  if (elapsedMs < TIER_FIVE_AFTER_MS) {
    return 2 * SECOND_MS;
  }

  if (elapsedMs < TIER_TEN_AFTER_MS) {
    return 5 * SECOND_MS;
  }

  return STREAM_THROTTLE_MAX_MS;
}

export function noteStreamActivity(sessionId: string, now: number = Date.now()): void {
  if (!sessionId || startedAtBySession.has(sessionId)) {
    return;
  }

  startedAtBySession.set(sessionId, now);
}

export function getStreamThrottleMs(sessionId: string, now: number = Date.now()): number {
  if (!sessionId) {
    return STREAM_THROTTLE_BASE_MS;
  }

  const startedAt = startedAtBySession.get(sessionId);
  if (startedAt === undefined) {
    return STREAM_THROTTLE_BASE_MS;
  }

  return resolveProgressiveThrottleMs(now - startedAt);
}

export function getSessionStreamThrottleMs(sessionId: string, now: number = Date.now()): number {
  noteStreamActivity(sessionId, now);
  return getStreamThrottleMs(sessionId, now);
}

export function resolveStreamThrottleMs(throttleMs: StreamThrottleMs, sessionId: string): number {
  const value = typeof throttleMs === "function" ? throttleMs(sessionId) : throttleMs;
  return Math.max(0, Math.floor(value));
}

export function resetStreamThrottle(sessionId: string): void {
  if (!sessionId) {
    return;
  }

  startedAtBySession.delete(sessionId);
}

export function resetAllStreamThrottles(): void {
  startedAtBySession.clear();
}

export function __resetStreamThrottleForTests(): void {
  startedAtBySession.clear();
}
