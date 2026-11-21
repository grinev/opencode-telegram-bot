import type { CompactionOutcome, CompactionSession } from "../../opencode/manual-compaction.js";

export interface CompactionProgress {
  finish(outcome: CompactionOutcome): Promise<unknown>;
}

export interface ManualCompactionAttempt {
  session: CompactionSession;
  protocol:
    | {
        version: "v1";
        baseline: ReadonlySet<string> | null;
        request: "preparing" | "running" | "returned" | "lost";
        abortAcknowledged: boolean;
        abortObserved: boolean;
        manualMarkers: Set<string>;
      }
    | {
        version: "v2";
        inputId: string;
        admission: "preparing" | "waiting" | "accepted" | "lost";
        observed: Map<string, "delivered" | "started" | "ended" | "cancelled">;
        sawDurableRunning: boolean;
        withdrawing: boolean;
        withdrawalAcknowledged: boolean;
      };
  settled: Promise<void>;
  signalSettlement(): void;
  progress?: { sent: Promise<CompactionProgress | undefined>; live: boolean };
  outcome?: CompactionOutcome;
  detached: boolean;
  retry: boolean;
}

export class ManualCompactionManager {
  private readonly attempts = new Map<string, ManualCompactionAttempt>();

  get(sessionId: string): ManualCompactionAttempt | undefined {
    return this.attempts.get(sessionId);
  }

  all(): ManualCompactionAttempt[] {
    return [...this.attempts.values()];
  }

  reserve(
    session: CompactionSession,
    protocol: ManualCompactionAttempt["protocol"],
  ): ManualCompactionAttempt | undefined {
    if (this.attempts.has(session.id)) return undefined;
    let signalSettlement!: () => void;
    const settled = new Promise<void>((resolve) => {
      signalSettlement = resolve;
    });
    const attempt = { session, protocol, settled, signalSettlement, detached: false, retry: false };
    this.attempts.set(session.id, attempt);
    return attempt;
  }

  settle(attempt: ManualCompactionAttempt, outcome: CompactionOutcome): boolean {
    if (this.attempts.get(attempt.session.id) !== attempt) return false;
    attempt.outcome = outcome;
    this.attempts.delete(attempt.session.id);
    attempt.signalSettlement();
    return true;
  }

  detach(attempt: ManualCompactionAttempt): void {
    attempt.detached = true;
    if (attempt.progress) {
      attempt.progress.live = false;
      delete attempt.progress;
    }
  }
}
