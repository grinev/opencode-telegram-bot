import { randomUUID } from "node:crypto";
import type { Event } from "@opencode-ai/sdk/v2";
import { opencodeClient, opencodeServerVersion, opencodeV2Client } from "../../opencode/client.js";
import {
  captureLegacyCompactionBaseline,
  readLegacyCompaction,
  verifyLegacyManualMarker,
  type CompactionOutcome,
  type CompactionSession,
  type V2CompactionState,
} from "../../opencode/manual-compaction.js";
import { isServerUnavailableError } from "../../utils/opencode-error.js";
import { isRecord } from "../../utils/type-guards.js";
import { logger } from "../../utils/logger.js";
import {
  ManualCompactionManager,
  type CompactionProgress,
  type ManualCompactionAttempt,
} from "../managers/manual-compaction-manager.js";

type ProgressSender = () => Promise<CompactionProgress | undefined>;

interface Presentation {
  isSelected(sessionId: string): boolean;
  openProgress(session: CompactionSession): ReturnType<ProgressSender>;
  notifySuccess(session: CompactionSession): Promise<void>;
  releaseInteractions(): void;
}

const CANCEL_WAIT_MS = 5_000;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const isTerminal = (state: V2CompactionState): state is Exclude<CompactionOutcome, "unknown"> =>
  state === "success" || state === "failure" || state === "interrupted";

function isAdmissionRejected(error: unknown): boolean {
  if (!isRecord(error)) return false;
  if (
    typeof error.name === "string" &&
    /(?:BadRequest|Conflict|NotFound|Unauthorized)(?:Error)?$/.test(error.name)
  )
    return true;
  const status = isRecord(error.cause) ? error.cause.status : undefined;
  return (
    error.reason === "UnexpectedStatus" &&
    typeof status === "number" &&
    status >= 400 &&
    status < 500
  );
}

export class ManualCompactionService {
  private readonly attempts = new ManualCompactionManager();
  private readonly probes = new Map<ManualCompactionAttempt, Promise<void>>();
  private readonly cancellations = new WeakMap<ManualCompactionAttempt, Promise<boolean>>();
  private readonly recentLegacySummaries = new Set<string>();
  private presentation?: Presentation;

  configurePresentation(presentation: Presentation): void {
    this.presentation = presentation;
  }

  get(sessionId: string | undefined): ManualCompactionAttempt | undefined {
    return sessionId ? this.attempts.get(sessionId) : undefined;
  }

  isActive(sessionId: string | undefined): boolean {
    return Boolean(this.get(sessionId));
  }

  reserve(session: CompactionSession): ManualCompactionAttempt | undefined {
    return this.attempts.reserve(
      session,
      opencodeServerVersion === "v2"
        ? {
            version: "v2",
            inputId: `msg_${randomUUID()}`,
            admission: "preparing",
            observed: new Map(),
            sawDurableRunning: false,
            withdrawing: false,
            withdrawalAcknowledged: false,
          }
        : {
            version: "v1",
            baseline: null,
            request: "preparing",
            abortAcknowledged: false,
            abortObserved: false,
            manualMarkers: new Set(),
          },
    );
  }

  showProgress(attempt: ManualCompactionAttempt, send?: ProgressSender): Promise<unknown> {
    if (!attempt.progress) {
      const sent = Promise.resolve()
        .then(() => (send ? send() : this.presentation?.openProgress(attempt.session)))
        .catch((error: unknown) => {
          logger.warn(`[Compaction] Could not display progress for ${attempt.session.id}`, error);
          return undefined;
        });
      attempt.progress = { sent, live: true };
    }
    return attempt.progress.sent;
  }

  select(sessionId: string): void {
    for (const attempt of this.attempts.all()) {
      if (attempt.session.id !== sessionId) {
        this.attempts.detach(attempt);
      } else if (attempt.detached) {
        attempt.detached = false;
        void this.showProgress(attempt);
        void this.observe(attempt, false);
      }
    }
  }

  detach(sessionId: string): void {
    const attempt = this.get(sessionId);
    if (attempt) this.attempts.detach(attempt);
  }

  async start(
    attempt: ManualCompactionAttempt,
    model: { providerID: string; modelID: string },
  ): Promise<void> {
    const { protocol, session } = attempt;
    if (attempt.outcome) return;
    try {
      if (protocol.version === "v2") {
        protocol.admission = "waiting";
        const result = await opencodeV2Client.session.manualCompaction.start(
          session.id,
          protocol.inputId,
        );
        if (result.data) {
          protocol.inputId = result.data;
          protocol.admission = "accepted";
        } else {
          logger.warn(`[Compaction] V2 admission failed for ${session.id}`, result.error);
          if (isAdmissionRejected(result.error)) {
            this.finish(attempt, "failure");
            return;
          }
          protocol.admission = "lost";
        }
      } else {
        protocol.baseline = await captureLegacyCompactionBaseline(session);
        if (attempt.outcome) return;
        protocol.request = "running";
        const result = await opencodeClient.session.summarize({
          sessionID: session.id,
          directory: session.directory,
          ...model,
        });
        protocol.request = "returned";
        if (result.error || result.data === false) {
          logger.warn(`[Compaction] V1 summarize failed for ${session.id}`, result.error);
          if (isServerUnavailableError(result.error)) {
            protocol.request = "lost";
          } else if (protocol.abortAcknowledged || protocol.abortObserved) {
            await this.observe(attempt);
            return;
          } else {
            this.finish(attempt, "failure");
            return;
          }
        }
      }
    } catch (error) {
      logger.warn(`[Compaction] Request failed for ${session.id}`, error);
      if (protocol.version === "v2") {
        protocol.admission = "lost";
      } else if (protocol.request === "preparing" || !isServerUnavailableError(error)) {
        this.finish(attempt, "failure");
        return;
      } else {
        protocol.request = "lost";
      }
    }
    await this.observe(attempt);
  }

  onEvent(event: Event, sessionId: string | null): void {
    if (event.type === "message.part.updated") {
      const { part } = event.properties;
      const protocol = this.get(sessionId ?? undefined)?.protocol;
      if (
        protocol?.version === "v1" &&
        protocol.request !== "preparing" &&
        part?.type === "compaction" &&
        part.auto === false &&
        !protocol.baseline?.has(part.messageID)
      ) {
        protocol.manualMarkers.add(part.messageID);
      }
      return;
    }

    if (
      event.type === "session.compacted" ||
      event.type === "session.idle" ||
      event.type === "session.error" ||
      (event.type as string) === "manual_compaction.changed"
    ) {
      const attempt = this.get(sessionId ?? undefined);
      if (!attempt) return;
      const protocol = attempt.protocol;
      if (
        event.type === "session.error" &&
        protocol.version === "v1" &&
        event.properties.error?.name === "MessageAbortedError"
      ) {
        protocol.abortObserved = true;
      }
      if ((event.type as string) === "manual_compaction.changed" && protocol.version === "v2") {
        const { inputID, phase } = event.properties as {
          inputID?: string;
          phase?: "delivered" | "started" | "failed" | "cancelled";
        };
        if (!inputID || (protocol.admission !== "waiting" && inputID !== protocol.inputId)) return;
        const previous = protocol.observed.get(inputID);
        if (phase === "cancelled" || (!previous && phase === "delivered")) {
          protocol.observed.set(inputID, phase);
        }
        if (phase === "started" && (!previous || previous === "delivered")) {
          protocol.observed.set(inputID, phase);
        }
        if (inputID !== protocol.inputId) return;
        if (
          phase === "cancelled" &&
          protocol.admission !== "waiting" &&
          protocol.admission !== "preparing"
        ) {
          this.finish(attempt, "interrupted");
          return;
        }
      }
      if (event.type === "session.idle" && protocol.version === "v2") {
        for (const [id, phase] of protocol.observed) {
          if (phase === "started" || phase === "delivered") protocol.observed.set(id, "ended");
        }
      }
      void this.observe(attempt);
    }
  }

  isLegacyCompactionSummary(event: Event): boolean | Promise<boolean> {
    if (event.type !== "message.updated") return false;
    const { info } = event.properties;
    if (info?.role !== "assistant" || !info.summary || !info.time?.completed) return false;
    if (this.recentLegacySummaries.has(info.id)) return true;
    const attempt = this.get(info.sessionID);
    const protocol = attempt?.protocol;
    if (
      !attempt ||
      protocol?.version !== "v1" ||
      protocol.request === "preparing" ||
      protocol.baseline?.has(info.parentID)
    )
      return false;
    if (protocol.manualMarkers.has(info.parentID)) {
      this.rememberLegacySummary(info.id);
      return true;
    }
    if (!protocol.baseline) return false;
    return this.identifyLegacySummary(attempt, info.parentID, info.id).then((manual) => {
      if (manual) this.rememberLegacySummary(info.id);
      return manual || this.recentLegacySummaries.has(info.id);
    });
  }

  private async identifyLegacySummary(
    attempt: ManualCompactionAttempt,
    parentId: string,
    summaryId: string,
  ): Promise<boolean> {
    try {
      return await verifyLegacyManualMarker(attempt.session, parentId);
    } catch (error) {
      logger.debug(
        `[Compaction] Delaying V1 summary ${summaryId} until outcome verification`,
        error,
      );
      await attempt.settled;
      if (this.recentLegacySummaries.has(summaryId)) return true;
      try {
        return await verifyLegacyManualMarker(attempt.session, parentId);
      } catch (retryError) {
        logger.debug(
          `[Compaction] Could not verify V1 summary ${summaryId} after settlement`,
          retryError,
        );
        return false;
      }
    }
  }

  private rememberLegacySummary(id: string): void {
    this.recentLegacySummaries.add(id);
    // The durable history can settle the attempt before the message reaches SSE.
    if (this.recentLegacySummaries.size > 128) {
      const oldest = this.recentLegacySummaries.values().next();
      if (!oldest.done) this.recentLegacySummaries.delete(oldest.value);
    }
  }

  reconcile(retryOnly = false, notify = true): void {
    for (const attempt of this.attempts.all()) {
      if (!retryOnly || attempt.retry) void this.observe(attempt, notify);
    }
  }

  private observe(attempt: ManualCompactionAttempt, notify = true): Promise<void> {
    // Queue a fresh read after any read already in flight: a terminal event can come between
    // the inbox/message read and its reply. Never let that later signal be swallowed.
    const next = (this.probes.get(attempt) ?? Promise.resolve())
      .then(() => this.readOutcome(attempt, notify))
      .catch((error: unknown) => {
        attempt.retry = true;
        logger.debug(`[Compaction] Could not verify outcome for ${attempt.session.id}`, error);
      })
      .finally(() => {
        if (this.probes.get(attempt) === next) this.probes.delete(attempt);
      });
    this.probes.set(attempt, next);
    return next;
  }

  private async inspectV2(sessionId: string, inputId: string, signal?: AbortSignal) {
    const result = await opencodeV2Client.session.manualCompaction.inspect(
      sessionId,
      inputId,
      signal,
    );
    if (!result.data) throw result.error ?? new Error("Missing OpenCode compaction status");
    return result.data;
  }

  private async inspectStableV2(sessionId: string, inputId: string): Promise<V2CompactionState> {
    const state = await this.inspectV2(sessionId, inputId);
    if (state !== "missing") return state;
    await delay(100);
    return this.inspectV2(sessionId, inputId);
  }

  private async inspectForCancellation(
    sessionId: string,
    inputId: string,
    deadline: number,
    waitForMissing = true,
  ): Promise<V2CompactionState> {
    let state = await this.inspectV2(sessionId, inputId);
    while (
      (state === "unverified" || (waitForMissing && state === "missing")) &&
      Date.now() < deadline
    ) {
      if (!this.isActive(sessionId)) break;
      await delay(100);
      state = await this.inspectV2(sessionId, inputId);
    }
    return state;
  }

  private async readOutcome(attempt: ManualCompactionAttempt, notify: boolean): Promise<void> {
    if (attempt.outcome) return;
    const { protocol, session } = attempt;
    if (protocol.version === "v2") {
      if (protocol.admission === "waiting" || protocol.admission === "preparing") return;
      const phase = protocol.observed.get(protocol.inputId);
      if (phase === "cancelled") {
        this.finish(attempt, "interrupted");
        return;
      }
      const state = await this.inspectStableV2(session.id, protocol.inputId);
      if (state === "running") protocol.sawDurableRunning = true;
      attempt.retry =
        state === "unverified" ||
        state === "missing" ||
        (state === "pending" && protocol.withdrawalAcknowledged);
      if (isTerminal(state)) this.finish(attempt, state, notify);
      if (state === "missing" && protocol.withdrawalAcknowledged && !protocol.withdrawing) {
        const acknowledgement = await opencodeV2Client.session.manualCompaction.waitForIdle(
          session.id,
        );
        if (!acknowledgement.data || attempt.outcome) return;
        const after = await this.inspectV2(session.id, protocol.inputId);
        if (isTerminal(after)) this.finish(attempt, after, notify);
        if (after === "missing") {
          // A withdrawal acknowledged while pending plus an idle barrier and an absent
          // durable result also confirms withdrawal when the cancellation event was lost.
          const delivered = protocol.observed.get(protocol.inputId);
          this.finish(
            attempt,
            !delivered || delivered === "cancelled" ? "interrupted" : "unknown",
            notify,
          );
        }
        return;
      }
      // Negative reads cannot distinguish an acknowledged request in promotion from a
      // vanished operation. Require positive evidence the matching execution already ended,
      // or that its durable running record existed before the inactive/absent read.
      if (
        state === "missing" &&
        !protocol.withdrawing &&
        (phase === "ended" ||
          protocol.sawDurableRunning ||
          (protocol.admission === "lost" && !phase))
      ) {
        this.finish(attempt, "unknown", notify);
      }
      return;
    }

    if (protocol.request === "preparing") return;
    const result = await readLegacyCompaction(session, protocol.baseline);
    attempt.retry = !result.idle && !result.outcome && protocol.request !== "running";
    if (result.outcome) {
      if (result.summaryId) this.rememberLegacySummary(result.summaryId);
      this.finish(attempt, result.outcome, notify);
    } else if (result.idle && protocol.request !== "running") {
      const knownAbort = result.hasMarker && (protocol.abortAcknowledged || protocol.abortObserved);
      this.finish(attempt, knownAbort ? "interrupted" : "unknown", notify);
    }
  }

  cancel(attempt: ManualCompactionAttempt): Promise<boolean> {
    const pending = this.cancellations.get(attempt);
    if (pending) return pending;
    const cancellation = this.requestCancellation(attempt).finally(() =>
      this.cancellations.delete(attempt),
    );
    this.cancellations.set(attempt, cancellation);
    return cancellation;
  }

  private async requestCancellation(attempt: ManualCompactionAttempt): Promise<boolean> {
    const { protocol, session } = attempt;
    if (attempt.outcome) return attempt.outcome === "interrupted";
    if (
      protocol.version === "v1"
        ? protocol.request === "preparing"
        : protocol.admission === "preparing"
    ) {
      this.finish(attempt, "interrupted");
      return true;
    }

    try {
      const deadline = Date.now() + CANCEL_WAIT_MS;
      if (protocol.version === "v2") {
        while (protocol.admission === "waiting" && !attempt.outcome && Date.now() < deadline) {
          await delay(100);
        }
        if (protocol.admission === "waiting") return false;
        if (attempt.outcome) return attempt.outcome === "interrupted";

        const state = await this.inspectForCancellation(session.id, protocol.inputId, deadline);
        if (state === "pending") {
          protocol.withdrawing = true;
          try {
            const result = await opencodeV2Client.session.manualCompaction.withdraw(
              session.id,
              protocol.inputId,
            );
            protocol.withdrawalAcknowledged ||= result.data === true;
            if (attempt.outcome) return attempt.outcome === "interrupted";
            const after = await this.inspectForCancellation(
              session.id,
              protocol.inputId,
              deadline,
              !protocol.withdrawalAcknowledged,
            );
            if (attempt.outcome) return attempt.outcome === "interrupted";
            if (isTerminal(after)) this.finish(attempt, after);
            if (after === "running") {
              await opencodeV2Client.session.manualCompaction.interrupt(session.id);
            } else if (result.error && after === "pending") {
              return false;
            }
          } finally {
            protocol.withdrawing = false;
          }
        } else if (state === "running" && !attempt.outcome) {
          await opencodeV2Client.session.manualCompaction.interrupt(session.id);
        }
      } else {
        const result = await opencodeClient.session.abort(
          { sessionID: session.id, directory: session.directory },
          { signal: AbortSignal.timeout(CANCEL_WAIT_MS) },
        );
        if (result.data !== true) return false;
        protocol.abortAcknowledged = true;
      }

      do {
        await this.observe(attempt);
        if (attempt.outcome || Date.now() >= deadline) break;
        await delay(250);
      } while (Date.now() < deadline);
    } catch (error) {
      logger.warn(`[Compaction] Could not confirm cancellation for ${session.id}`, error);
    }
    return attempt.outcome === "interrupted";
  }

  async withdrawBeforeStop(): Promise<void> {
    const signal = AbortSignal.timeout(750);
    await Promise.allSettled(
      this.attempts.all().map(async ({ session, protocol }) => {
        if (protocol.version !== "v2" || protocol.admission !== "accepted") return;
        if ((await this.inspectV2(session.id, protocol.inputId, signal)) === "pending") {
          await opencodeV2Client.session.manualCompaction.withdraw(
            session.id,
            protocol.inputId,
            signal,
          );
        }
      }),
    );
  }

  serverInterrupted(): void {
    for (const attempt of this.attempts.all()) this.finish(attempt, "interrupted", false, false);
  }

  private finish(
    attempt: ManualCompactionAttempt,
    outcome: CompactionOutcome,
    notify = true,
    releaseInteractions = true,
  ): void {
    if (!this.attempts.settle(attempt, outcome)) return;
    const { session } = attempt;
    if (releaseInteractions && this.presentation?.isSelected(session.id)) {
      this.presentation.releaseInteractions();
    }
    if (!attempt.detached || this.presentation?.isSelected(session.id)) {
      if (attempt.detached) attempt.detached = false;
      void this.showProgress(attempt)
        .then(async () => {
          const progress = attempt.progress;
          const message = await progress?.sent;
          if (!progress?.live || this.presentation?.isSelected(session.id) === false) return;
          await message?.finish(outcome);
        })
        .catch((error: unknown) => {
          logger.debug(`[Compaction] Could not finish progress for ${session.id}`, error);
        });
    } else if (outcome === "success" && notify) {
      void this.presentation?.notifySuccess(session).catch((error: unknown) => {
        logger.warn(`[Compaction] Could not notify completion for ${session.id}`, error);
      });
    }
  }
}
