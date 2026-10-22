const CHAT_INTERVAL_MS = 1000;
const BURST_GAP_MS = 60_000;

export type TelegramOutageNoticeKind = "undelivered" | "skipped" | "busy";

export type SkippedMessagesReason = "outage" | "busy";

export interface TelegramOutageNoticesDue {
  undelivered: boolean;
  skipped: boolean;
  busy: boolean;
}

export class TelegramOutageNoticeService {
  private undeliveredPending = false;
  private skippedPending = false;
  private busyPending = false;
  private burstActive = false;
  private burstReasons = new Set<SkippedMessagesReason>();
  private lastStaleAt = 0;
  private lastChatSendAt = 0;
  private flushInFlight = false;

  markAssistantReplyUndelivered(): void {
    this.undeliveredPending = true;
  }

  markMessagesSkipped(reason: SkippedMessagesReason = "outage"): void {
    const now = Date.now();
    if (this.burstActive && now - this.lastStaleAt <= BURST_GAP_MS) {
      this.lastStaleAt = now;
      if (!this.burstReasons.has(reason)) {
        this.burstReasons.add(reason);
        this.markSkippedPending(reason);
      }
      return;
    }

    this.burstActive = true;
    this.burstReasons = new Set([reason]);
    this.markSkippedPending(reason);
    this.lastStaleAt = now;
  }

  private markSkippedPending(reason: SkippedMessagesReason): void {
    if (reason === "busy") {
      this.busyPending = true;
    } else {
      this.skippedPending = true;
    }
  }

  closeBurst(): void {
    this.burstActive = false;
    this.burstReasons = new Set();
  }

  noteChatSendSucceeded(): void {
    this.lastChatSendAt = Date.now();
  }

  /** Milliseconds since the last chat delivery, or null when nothing was sent yet. */
  msSinceLastChatSend(): number | null {
    if (this.lastChatSendAt === 0) {
      return null;
    }
    return Date.now() - this.lastChatSendAt;
  }

  msUntilAllowedSend(): number {
    if (this.lastChatSendAt === 0) {
      return 0;
    }
    return Math.max(0, this.lastChatSendAt + CHAT_INTERVAL_MS - Date.now());
  }

  takeDueNotices(): TelegramOutageNoticesDue | null {
    if (this.flushInFlight) {
      return null;
    }
    if (!this.undeliveredPending && !this.skippedPending && !this.busyPending) {
      return null;
    }
    this.flushInFlight = true;
    return {
      undelivered: this.undeliveredPending,
      skipped: this.skippedPending,
      busy: this.busyPending,
    };
  }

  reportNoticeResult(kind: TelegramOutageNoticeKind, delivered: boolean): void {
    if (!delivered) {
      return;
    }
    if (kind === "undelivered") {
      this.undeliveredPending = false;
    } else if (kind === "busy") {
      this.busyPending = false;
    } else {
      this.skippedPending = false;
    }
  }

  finishFlush(): void {
    this.flushInFlight = false;
  }

  __resetForTests(): void {
    this.undeliveredPending = false;
    this.skippedPending = false;
    this.busyPending = false;
    this.burstActive = false;
    this.burstReasons = new Set();
    this.lastStaleAt = 0;
    this.lastChatSendAt = 0;
    this.flushInFlight = false;
  }
}

export const telegramOutageNoticeService = new TelegramOutageNoticeService();
