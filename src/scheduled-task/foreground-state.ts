import { logger } from "../utils/logger.js";

const DEFAULT_BUSY_TTL_MS = 30 * 60 * 1000; // 30 minutes

class ForegroundSessionState {
  // sessionId → expiration timestamp (Date.now() + ttlMs)
  private activeSessions = new Map<string, number>();

  markBusy(sessionId: string, ttlMs: number = DEFAULT_BUSY_TTL_MS): void {
    if (!sessionId) {
      return;
    }

    this.activeSessions.set(sessionId, Date.now() + ttlMs);
    logger.debug(
      `[ScheduledTaskForeground] Marked session busy: session=${sessionId}, count=${this.activeSessions.size}`,
    );
  }

  markIdle(sessionId: string): void {
    if (!sessionId) {
      return;
    }

    this.activeSessions.delete(sessionId);
    logger.debug(
      `[ScheduledTaskForeground] Marked session idle: session=${sessionId}, count=${this.activeSessions.size}`,
    );
  }

  // Remove entries whose TTL has expired. Called automatically by isBusy().
  sweepExpired(): number {
    const now = Date.now();
    let removed = 0;
    for (const [sessionId, expiresAt] of this.activeSessions) {
      if (expiresAt <= now) {
        this.activeSessions.delete(sessionId);
        removed++;
      }
    }
    if (removed > 0) {
      logger.info(
        `[ScheduledTaskForeground] Swept ${removed} expired busy session(s), remaining=${this.activeSessions.size}`,
      );
    }
    return removed;
  }

  isBusy(): boolean {
    this.sweepExpired();
    return this.activeSessions.size > 0;
  }

  clearAll(reason: string): void {
    if (this.activeSessions.size === 0) {
      return;
    }

    logger.info(
      `[ScheduledTaskForeground] Cleared foreground busy state: reason=${reason}, count=${this.activeSessions.size}`,
    );
    this.activeSessions.clear();
  }

  __resetForTests(): void {
    this.activeSessions.clear();
  }
}

export const foregroundSessionState = new ForegroundSessionState();
