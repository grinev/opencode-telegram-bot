import { logger } from "../utils/logger.js";

export interface ForegroundBusySession {
  sessionId: string;
  directory: string;
  markedAt: number;
}

class ForegroundSessionState {
  private activeSessions = new Map<string, ForegroundBusySession>();

  markBusy(sessionId: string, directory: string): void {
    if (!sessionId || !directory) {
      return;
    }

    this.activeSessions.set(sessionId, { sessionId, directory, markedAt: Date.now() });
    logger.debug(
      `[ScheduledTaskForeground] Marked session busy: session=${sessionId}, directory=${directory}, count=${this.activeSessions.size}`,
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

  getBusySessions(): ForegroundBusySession[] {
    return Array.from(this.activeSessions.values(), (session) => ({ ...session }));
  }

  isBusy(): boolean {
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
