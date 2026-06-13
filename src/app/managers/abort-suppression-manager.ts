// Covers abort request timeout, post-abort status polling, and delayed SSE reconnect delivery.
const USER_ABORT_SUPPRESSION_WINDOW_MS = 90_000;

const userAbortRequestedAtBySession = new Map<string, number>();

function deleteExpiredAbortRequests(now: number = Date.now()): void {
  for (const [sessionId, requestedAt] of userAbortRequestedAtBySession) {
    if (now - requestedAt > USER_ABORT_SUPPRESSION_WINDOW_MS) {
      userAbortRequestedAtBySession.delete(sessionId);
    }
  }
}

export function markUserAbortRequested(sessionId: string): void {
  const now = Date.now();
  deleteExpiredAbortRequests(now);
  userAbortRequestedAtBySession.set(sessionId, now);
}

export function shouldSuppressUserAbortSessionError(sessionId: string, message: string): boolean {
  if (message.trim().toLowerCase() !== "aborted") {
    return false;
  }

  const requestedAt = userAbortRequestedAtBySession.get(sessionId);
  if (requestedAt === undefined) {
    return false;
  }

  userAbortRequestedAtBySession.delete(sessionId);
  return Date.now() - requestedAt <= USER_ABORT_SUPPRESSION_WINDOW_MS;
}

export function __resetUserAbortErrorSuppressionForTests(): void {
  userAbortRequestedAtBySession.clear();
}

export function __getUserAbortErrorSuppressionSizeForTests(): number {
  return userAbortRequestedAtBySession.size;
}
