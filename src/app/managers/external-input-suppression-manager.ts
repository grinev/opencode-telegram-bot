const MESSAGE_SUPPRESSION_TTL_MS = 5 * 60_000;

class ExternalUserInputSuppressionManager {
  private messageIdsBySession = new Map<string, Map<string, number>>();
  private messagePruneTimer: ReturnType<typeof setTimeout> | null = null;

  registerMessage(sessionId: string, messageId: string, now: number = Date.now()): void {
    if (!sessionId || !messageId) {
      return;
    }

    this.pruneMessages(now);
    const messageIds = this.messageIdsBySession.get(sessionId) ?? new Map<string, number>();
    messageIds.set(messageId, now + MESSAGE_SUPPRESSION_TTL_MS);
    this.messageIdsBySession.set(sessionId, messageIds);
    this.scheduleMessagePrune(now);
  }

  consumeMessage(sessionId: string, messageId: string): boolean {
    this.pruneMessages(Date.now());
    const messageIds = this.messageIdsBySession.get(sessionId);
    if (messageIds?.delete(messageId)) {
      if (messageIds.size === 0) {
        this.messageIdsBySession.delete(sessionId);
      }
      this.scheduleMessagePrune(Date.now());
      return true;
    }

    return false;
  }

  discardMessage(sessionId: string, messageId: string): void {
    const messageIds = this.messageIdsBySession.get(sessionId);
    if (!messageIds) {
      return;
    }

    messageIds.delete(messageId);
    if (messageIds.size === 0) {
      this.messageIdsBySession.delete(sessionId);
    }
    this.scheduleMessagePrune(Date.now());
  }

  clearSession(sessionId: string): void {
    this.messageIdsBySession.delete(sessionId);
    this.scheduleMessagePrune(Date.now());
  }

  clearAll(): void {
    this.messageIdsBySession.clear();
    if (this.messagePruneTimer) {
      clearTimeout(this.messagePruneTimer);
      this.messagePruneTimer = null;
    }
  }

  __resetForTests(): void {
    this.clearAll();
  }

  __getMessageCountForTests(): number {
    return Array.from(this.messageIdsBySession.values()).reduce(
      (count, messageIds) => count + messageIds.size,
      0,
    );
  }

  private pruneMessages(now: number): void {
    for (const [sessionId, messageIds] of this.messageIdsBySession.entries()) {
      for (const [messageId, expiresAt] of messageIds.entries()) {
        if (expiresAt <= now) {
          messageIds.delete(messageId);
        }
      }
      if (messageIds.size === 0) {
        this.messageIdsBySession.delete(sessionId);
      }
    }
  }

  private scheduleMessagePrune(now: number): void {
    if (this.messagePruneTimer) {
      clearTimeout(this.messagePruneTimer);
      this.messagePruneTimer = null;
    }

    const expirations = Array.from(this.messageIdsBySession.values()).flatMap((messageIds) =>
      Array.from(messageIds.values()),
    );
    if (expirations.length === 0) {
      return;
    }

    const expiresAt = Math.min(...expirations);
    this.messagePruneTimer = setTimeout(() => {
      this.messagePruneTimer = null;
      const pruneAt = Date.now();
      this.pruneMessages(pruneAt);
      this.scheduleMessagePrune(pruneAt);
    }, Math.max(0, expiresAt - now));
    this.messagePruneTimer.unref?.();
  }
}

export const externalUserInputSuppressionManager = new ExternalUserInputSuppressionManager();
