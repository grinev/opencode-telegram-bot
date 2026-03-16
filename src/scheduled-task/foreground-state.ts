import { logger } from "../utils/logger.js";

class ForegroundSessionState {
  private activeSessionIds = new Set<string>();

  markBusy(sessionId: string): void {
    if (!sessionId) {
      return;
    }

    this.activeSessionIds.add(sessionId);
    logger.debug(
      `[ScheduledTaskForeground] Marked session busy: session=${sessionId}, count=${this.activeSessionIds.size}`,
    );
  }

  markIdle(sessionId: string): void {
    if (!sessionId) {
      return;
    }

    this.activeSessionIds.delete(sessionId);
    logger.debug(
      `[ScheduledTaskForeground] Marked session idle: session=${sessionId}, count=${this.activeSessionIds.size}`,
    );
  }

  isBusy(): boolean {
    return this.activeSessionIds.size > 0;
  }

  clearAll(reason: string): void {
    if (this.activeSessionIds.size === 0) {
      return;
    }

    logger.info(
      `[ScheduledTaskForeground] Cleared foreground busy state: reason=${reason}, count=${this.activeSessionIds.size}`,
    );
    this.activeSessionIds.clear();
  }

  __resetForTests(): void {
    this.activeSessionIds.clear();
  }
}

export const foregroundSessionState = new ForegroundSessionState();
