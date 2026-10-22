export const STALE_THRESHOLD_MS = 60_000;
export const BUSY_CANCEL_MS = 15_000;
// The stale check floors the age to whole seconds, so a handler just under the cancel
// window can still leave a message looking one second older; record with that margin.
const RECORD_THRESHOLD_MS = BUSY_CANCEL_MS - 1000;
const WINDOW_TTL_MS = 60 * 60_000;

export interface UpdateBusyWindow {
  startedAt: number;
  endedAt: number;
}

/**
 * Remembers update handlers that ran longer than the busy-cancel window. A message the
 * user sent while the bot was busy was delayed by the bot itself, not by a Telegram outage,
 * and the stale-update middleware uses these windows to tell the two apart.
 *
 * The window starts at the beginning of the handler's first second: Telegram dates messages
 * in whole seconds, so a message sent in that same second must still be covered.
 *
 * Only handlers that individually outlive the threshold are recorded: a backlog of shorter
 * handlers can still delay a message past it without a window.
 */
export class UpdateBusyWindowService {
  private windows: UpdateBusyWindow[] = [];

  record(startedAt: number, endedAt: number): void {
    if (endedAt - startedAt < RECORD_THRESHOLD_MS) {
      return;
    }

    this.windows.push({ startedAt: Math.floor(startedAt / 1000) * 1000, endedAt });
    this.windows = this.windows.filter((window) => endedAt - window.endedAt <= WINDOW_TTL_MS);
  }

  covers(timestampMs: number): boolean {
    const now = Date.now();
    return this.windows.some(
      (window) =>
        now - window.endedAt <= WINDOW_TTL_MS &&
        timestampMs >= window.startedAt &&
        timestampMs <= window.endedAt,
    );
  }

  __resetForTests(): void {
    this.windows = [];
  }
}

export const updateBusyWindowService = new UpdateBusyWindowService();
