const SUPPRESSION_TTL_MS = 60_000;
const MESSAGE_SUPPRESSION_TTL_MS = 5 * 60_000;

interface SuppressionEntry {
  text: string;
  createdAt: number;
}

function normalizeExternalUserInputText(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

class ExternalUserInputSuppressionManager {
  private entriesBySession = new Map<string, SuppressionEntry[]>();
  private messageIdsBySession = new Map<string, Map<string, number>>();
  private messagePruneTimer: ReturnType<typeof setTimeout> | null = null;

  register(sessionId: string, text: string, now: number = Date.now()): void {
    const normalizedText = normalizeExternalUserInputText(text);
    if (!sessionId || !normalizedText) {
      return;
    }

    this.prune(now);

    const sessionEntries = this.entriesBySession.get(sessionId) ?? [];
    sessionEntries.push({ text: normalizedText, createdAt: now });
    this.entriesBySession.set(sessionId, sessionEntries);
  }

  consume(sessionId: string, text: string, now: number = Date.now()): boolean {
    const normalizedText = normalizeExternalUserInputText(text);
    if (!sessionId || !normalizedText) {
      return false;
    }

    this.prune(now);

    const sessionEntries = this.entriesBySession.get(sessionId);
    if (!sessionEntries?.length) {
      return false;
    }

    const entryIndex = sessionEntries.findIndex((entry) => entry.text === normalizedText);
    if (entryIndex < 0) {
      return false;
    }

    sessionEntries.splice(entryIndex, 1);
    if (sessionEntries.length === 0) {
      this.entriesBySession.delete(sessionId);
    }

    return true;
  }

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

  consumeMessage(sessionId: string, messageId: string, _fallbackText: string): boolean {
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
    this.entriesBySession.delete(sessionId);
    this.messageIdsBySession.delete(sessionId);
    this.scheduleMessagePrune(Date.now());
  }

  clearAll(): void {
    this.entriesBySession.clear();
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

  private prune(now: number): void {
    for (const [sessionId, sessionEntries] of this.entriesBySession.entries()) {
      const activeEntries = sessionEntries.filter((entry) => now - entry.createdAt <= SUPPRESSION_TTL_MS);
      if (activeEntries.length === 0) {
        this.entriesBySession.delete(sessionId);
        continue;
      }

      this.entriesBySession.set(sessionId, activeEntries);
    }
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
