const SUPPRESSION_TTL_MS = 60_000;

interface SuppressionEntry {
  text: string;
  createdAt: number;
}

function normalizeExternalUserInputText(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

class ExternalUserInputSuppressionManager {
  private entriesBySession = new Map<string, SuppressionEntry[]>();

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

  clearAll(): void {
    this.entriesBySession.clear();
  }

  __resetForTests(): void {
    this.clearAll();
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
}

export const externalUserInputSuppressionManager = new ExternalUserInputSuppressionManager();
