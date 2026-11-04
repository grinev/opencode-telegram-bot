import { opencodeServerVersion, opencodeV2Client } from "../../opencode/client.js";
import { isExpectedOpencodeUnavailableError } from "../../utils/opencode-error.js";
import { isRecord } from "../../utils/type-guards.js";
import { logger } from "../../utils/logger.js";
import type { GoalManager } from "../managers/goal-manager.js";
import type { GoalNotice, GoalState } from "../types/goal.js";
import { isNoActiveGoalReason, localizeGoalReason } from "../formatters/goal-text.js";

export type GoalReadResult =
  | { kind: "goal"; goal: GoalState }
  | { kind: "none" }
  | { kind: "unsupported" }
  | { kind: "error"; message: string };

export type GoalCommandResult =
  | { kind: "ok" }
  | { kind: "unsupported" }
  | { kind: "rejected"; message: string }
  | { kind: "error"; message: string };

export type AbortPauseOutcome =
  | { kind: "silent" }
  | { kind: "paused"; reason: string }
  | { kind: "failed"; reason: string };

type GoalNoticeListener = (sessionId: string, notice: GoalNotice) => void | Promise<void>;
type GoalSnapshotListener = () => void | Promise<void>;

/**
 * Reads and changes the followed session's server goal. It decides when a
 * pause or completion should be told; it does not send Telegram messages.
 */
export class GoalService {
  private capability: "unknown" | "supported" | "unsupported" = "unknown";
  private onNotice: GoalNoticeListener | null = null;
  private onSnapshot: GoalSnapshotListener | null = null;

  constructor(private readonly manager: GoalManager) {}

  setOnNotice(listener: GoalNoticeListener | null): void {
    this.onNotice = listener;
  }

  setOnSnapshot(listener: GoalSnapshotListener | null): void {
    this.onSnapshot = listener;
  }

  forgetCapability(): void {
    this.capability = "unknown";
  }

  follow(sessionId: string): void {
    this.manager.follow(sessionId);
  }

  async read(sessionId: string, directory: string): Promise<GoalReadResult> {
    if (!this.available()) {
      return { kind: "unsupported" };
    }

    let data: unknown;
    let error: unknown;
    try {
      ({ data, error } = await opencodeV2Client.goal.get({ sessionID: sessionId, directory }));
    } catch (caught) {
      return this.readFailure(caught);
    }
    if (error) {
      return this.readFailure(error);
    }

    this.capability = "supported";
    const goal = parseGoalState(data);
    return goal ? { kind: "goal", goal } : { kind: "none" };
  }

  async command(sessionId: string, directory: string, text: string): Promise<GoalCommandResult> {
    if (!this.available()) {
      return { kind: "unsupported" };
    }

    let error: unknown;
    try {
      ({ error } = await opencodeV2Client.goal.command({ sessionID: sessionId, directory, text }));
    } catch (caught) {
      return this.readFailure(caught).kind === "unsupported"
        ? { kind: "unsupported" }
        : { kind: "error", message: messageOf(caught) || localizeGoalReason("The goal stopped after an error") };
    }
    if (!error) {
      this.capability = "supported";
      return { kind: "ok" };
    }

    if (isUnsupported(error)) {
      this.capability = "unsupported";
      return { kind: "unsupported" };
    }

    const message = messageOf(error);
    if (message) {
      return { kind: "rejected", message: localizeGoalReason(message) };
    }

    return { kind: "error", message: localizeGoalReason(messageOf(error) || "") };
  }

  /**
   * Replaces the followed session's snapshot from the server. A failed read
   * keeps the previous snapshot and does not announce. Pass announce only when
   * a transition observed while following should be told once.
   */
  async refresh(sessionId: string, directory: string, announce: boolean): Promise<GoalReadResult> {
    this.manager.follow(sessionId);
    const result = await this.read(sessionId, directory);
    if (result.kind === "error") {
      logger.warn("[Goal] Refresh failed; keeping the last snapshot", {
        sessionId,
        message: result.message,
      });
      return result;
    }

    if (result.kind === "unsupported") {
      return result;
    }

    const goal = result.kind === "goal" ? result.goal : null;
    const notice = this.manager.apply(sessionId, goal, announce);
    await this.publish(sessionId, notice);
    return result;
  }

  async applyChanged(sessionId: string, goal: unknown): Promise<void> {
    if (this.manager.snapshot().sessionId !== sessionId) {
      return;
    }

    const parsed = goal === null ? null : parseGoalState(goal);
    if (goal !== null && !parsed) {
      logger.warn("[Goal] Ignoring a goal change with an unexpected shape", { sessionId });
      return;
    }

    this.capability = "supported";
    const notice = this.manager.apply(sessionId, parsed, true);
    await this.publish(sessionId, notice);
  }

  /**
   * A user `/goal pause`. One notice is the caller's to send; a changed event
   * for this pause is not announced again.
   */
  async pauseFromCommand(
    sessionId: string,
    directory: string,
  ): Promise<
    | { kind: "paused"; notice: GoalNotice }
    | { kind: "unsupported" }
    | { kind: "rejected"; message: string }
    | { kind: "error" }
  > {
    this.manager.suppressPauseNotice();
    const paused = await this.command(sessionId, directory, "pause");
    if (paused.kind === "unsupported") {
      this.manager.clearPauseSuppression();
      return { kind: "unsupported" };
    }
    if (paused.kind !== "ok") {
      this.manager.clearPauseSuppression();
      return paused.kind === "rejected"
        ? { kind: "rejected", message: paused.message }
        : { kind: "error" };
    }

    const read = await this.read(sessionId, directory);
    const goal = read.kind === "goal" ? read.goal : null;
    if (goal) {
      this.manager.markAnnounced(goal);
      this.manager.apply(sessionId, goal, false);
    }
    this.manager.clearPauseSuppression();
    await this.publish(sessionId, null);
    return {
      kind: "paused",
      notice: {
        status: "paused",
        reason: goal?.reason ?? "Paused by the user",
      },
    };
  }

  /**
   * Pauses an active goal without saying so itself. The caller names the
   * outcome. No active goal, or a server without the plugin, stays silent.
   */
  async pauseForAbort(sessionId: string, directory: string): Promise<AbortPauseOutcome> {
    if (!this.available() || this.capability === "unsupported") {
      return { kind: "silent" };
    }

    this.manager.suppressPauseNotice();
    const paused = await this.command(sessionId, directory, "pause");
    if (paused.kind === "unsupported") {
      this.manager.clearPauseSuppression();
      return { kind: "silent" };
    }

    if (paused.kind === "rejected" && isNoActiveGoalReason(paused.message)) {
      const read = await this.read(sessionId, directory);
      this.manager.clearPauseSuppression();
      if (read.kind === "goal" && read.goal.status === "active") {
        return { kind: "failed", reason: paused.message };
      }
      return { kind: "silent" };
    }

    if (paused.kind === "ok") {
      return this.confirmPaused(sessionId, directory, tPausedByUser());
    }

    const read = await this.read(sessionId, directory);
    if (read.kind === "goal" && read.goal.status === "paused") {
      this.manager.markAnnounced(read.goal);
      this.manager.apply(sessionId, read.goal, false);
      this.manager.clearPauseSuppression();
      await this.publish(sessionId, null);
      return { kind: "paused", reason: localizeGoalReason(read.goal.reason ?? "Paused by the user") };
    }

    this.manager.clearPauseSuppression();
    return {
      kind: "failed",
      reason: paused.kind === "rejected" || paused.kind === "error" ? paused.message : tPausedByUser(),
    };
  }

  private async confirmPaused(
    sessionId: string,
    directory: string,
    fallbackReason: string,
  ): Promise<AbortPauseOutcome> {
    const read = await this.read(sessionId, directory);
    if (read.kind === "goal" && read.goal.status === "paused") {
      this.manager.markAnnounced(read.goal);
      this.manager.apply(sessionId, read.goal, false);
      this.manager.clearPauseSuppression();
      await this.publish(sessionId, null);
      return { kind: "paused", reason: localizeGoalReason(read.goal.reason ?? "Paused by the user") };
    }

    if (read.kind === "goal" && read.goal.status !== "paused") {
      this.manager.clearPauseSuppression();
      return { kind: "failed", reason: localizeGoalReason("The goal stopped after an error") };
    }

    // The pause command succeeded. A following read that fails must not turn that into a success claim the other way.
    this.manager.clearPauseSuppression();
    if (read.kind === "error") {
      return { kind: "paused", reason: fallbackReason };
    }

    return { kind: "paused", reason: fallbackReason };
  }

  private async publish(sessionId: string, notice: GoalNotice | null): Promise<void> {
    try {
      await this.onSnapshot?.();
    } catch (error) {
      logger.warn("[Goal] Dashboard refresh failed", error);
    }

    if (!notice || !this.onNotice) {
      return;
    }

    try {
      await this.onNotice(sessionId, notice);
    } catch (error) {
      logger.warn("[Goal] Pause notice failed", error);
    }
  }

  private available(): boolean {
    try {
      return opencodeServerVersion === "v2";
    } catch {
      return false;
    }
  }

  private readFailure(error: unknown): GoalReadResult {
    if (isUnsupported(error)) {
      this.capability = "unsupported";
      return { kind: "unsupported" };
    }

    return { kind: "error", message: messageOf(error) };
  }
}

export function parseGoalState(value: unknown): GoalState | null {
  if (!isRecord(value)) {
    return null;
  }

  const { id, objective, status, rounds, maxRounds, updatedAt, reason } = value;
  if (status !== "active" && status !== "paused" && status !== "complete") {
    return null;
  }
  if (typeof id !== "string" || typeof objective !== "string") {
    return null;
  }
  if (typeof rounds !== "number" || typeof maxRounds !== "number" || typeof updatedAt !== "number") {
    return null;
  }

  return {
    id,
    objective,
    status,
    rounds,
    maxRounds,
    updatedAt,
    ...(typeof reason === "string" && reason.length > 0 ? { reason } : {}),
  };
}

function tPausedByUser(): string {
  return localizeGoalReason("Paused by the user");
}

function isUnsupported(error: unknown): boolean {
  if (!isRecord(error)) {
    return false;
  }

  if (error.name === "GoalUnsupportedError") {
    return true;
  }

  const type = typeof error.type === "string" ? error.type : "";
  return type === "rpc.method_not_found" || type === "rpc.unavailable";
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (!isRecord(error)) {
    return "";
  }
  if (typeof error.message === "string") {
    return error.message;
  }
  const data = error.data;
  if (isRecord(data) && typeof data.message === "string") {
    return data.message;
  }
  if (isExpectedOpencodeUnavailableError(error)) {
    return "fetch failed";
  }
  return "";
}
