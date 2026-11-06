import { randomBytes } from "node:crypto";
import type { GoalNotice, GoalState } from "../types/goal.js";

export interface GoalSnapshot {
  sessionId: string | null;
  goal: GoalState | null;
}

/**
 * The followed session's goal, and which pause or completion was already told
 * to the user. Nothing here is written to disk.
 */
export class GoalManager {
  private sessionId: string | null = null;
  private goal: GoalState | null = null;
  private announcedKey: string | null = null;
  private pauseNoticeSuppressed = false;
  private controlToken = randomBytes(4).toString("hex");

  getControlToken(): string {
    return this.controlToken;
  }

  claimControl(token: string): boolean {
    if (token !== this.controlToken || !this.goal || !this.sessionId) {
      return false;
    }
    this.controlToken = randomBytes(4).toString("hex");
    return true;
  }

  clear(): void {
    this.sessionId = null;
    this.goal = null;
    this.announcedKey = null;
    this.pauseNoticeSuppressed = false;
    this.controlToken = randomBytes(4).toString("hex");
  }

  snapshot(): GoalSnapshot {
    return { sessionId: this.sessionId, goal: this.goal };
  }

  /** The session the user is following changed. The previous snapshot must not linger. */
  follow(sessionId: string): void {
    if (this.sessionId === sessionId) {
      return;
    }

    this.sessionId = sessionId;
    this.goal = null;
    this.announcedKey = null;
    this.pauseNoticeSuppressed = false;
    this.controlToken = randomBytes(4).toString("hex");
  }

  suppressPauseNotice(): void {
    this.pauseNoticeSuppressed = true;
  }

  clearPauseSuppression(): void {
    this.pauseNoticeSuppressed = false;
  }

  /**
   * Stores a read or a change for the followed session. A pause or completion
   * is announced once, and only when the caller asked to announce. A refresh
   * that must not replay an old notice still records the key, so a later
   * identical read stays quiet.
   */
  apply(sessionId: string, goal: GoalState | null, announce: boolean): GoalNotice | null {
    if (sessionId !== this.sessionId) {
      return null;
    }

    if (
      goal?.id !== this.goal?.id ||
      goal?.status !== this.goal?.status ||
      goal?.objective !== this.goal?.objective
    ) {
      this.controlToken = randomBytes(4).toString("hex");
    }
    this.goal = goal;
    if (!goal || (goal.status !== "paused" && goal.status !== "complete")) {
      this.announcedKey = null;
      return null;
    }

    const key = noticeKey(goal);
    if (!announce || this.announcedKey === key) {
      this.announcedKey = key;
      return null;
    }

    this.announcedKey = key;
    if (goal.status === "paused" && this.pauseNoticeSuppressed) {
      this.pauseNoticeSuppressed = false;
      return null;
    }

    return { status: goal.status, ...(goal.reason ? { reason: goal.reason } : {}) };
  }

  markAnnounced(goal: GoalState): void {
    if (goal.status === "paused" || goal.status === "complete") {
      this.announcedKey = noticeKey(goal);
    }
  }
}

function noticeKey(goal: GoalState): string {
  return `${goal.id}:${goal.status}:${goal.updatedAt}`;
}
