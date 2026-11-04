import { resetAllStreamThrottles, resetStreamThrottle } from "../../bot/streaming/stream-throttle.js";
import { logger } from "../../utils/logger.js";
import type { AssistantRunStep } from "../formatters/assistant-run-footer-formatter.js";

export interface AssistantRunStartInfo {
  startedAt: number;
  configuredAgent?: string | undefined;
  configuredProviderID?: string | undefined;
  configuredModelID?: string | undefined;
}

export interface AssistantRunResolvedInfo {
  agent?: string | undefined;
  providerID?: string | undefined;
  modelID?: string | undefined;
}

export interface AssistantRunInfo extends AssistantRunStartInfo {
  sessionId: string;
  /** False for a turn the bot only observed: OpenCode's own follow-up or a prompt typed in a client. */
  startedByBot: boolean;
  actualAgent?: string | undefined;
  actualProviderID?: string | undefined;
  actualModelID?: string | undefined;
  hasCompletedResponse: boolean;
  steps: AssistantRunStep[];
  /** A client stop after the reply completed. Not a server shutdown. */
  interrupted: boolean;
  /** A permission reject or a cancelled question: this close sends no footer. */
  suppressFooter: boolean;
  /** Further steps belong to the next run. Set when the turn's idle is seen. */
  sealed: boolean;
}

export class AssistantRunState {
  private readonly runs = new Map<string, AssistantRunInfo>();
  /** Steps of a turn whose run has not opened yet. Adopted when an observed run opens. */
  private readonly pendingSteps = new Map<string, AssistantRunStep[]>();
  private readonly pendingSuppress = new Set<string>();

  startRun(sessionId: string, info: AssistantRunStartInfo): void {
    if (!sessionId) {
      return;
    }

    resetStreamThrottle(sessionId);
    const steps = this.pendingSteps.get(sessionId) ?? [];
    this.pendingSteps.delete(sessionId);
    const suppressFooter = this.pendingSuppress.has(sessionId);
    this.pendingSuppress.delete(sessionId);
    this.runs.set(sessionId, {
      sessionId,
      startedByBot: true,
      startedAt: info.startedAt,
      configuredAgent: info.configuredAgent,
      configuredProviderID: info.configuredProviderID,
      configuredModelID: info.configuredModelID,
      hasCompletedResponse: false,
      steps,
      interrupted: false,
      suppressFooter,
      sealed: false,
    });

    logger.debug(
      `[AssistantRunState] Started run: session=${sessionId}, agent=${info.configuredAgent || "unknown"}, model=${info.configuredProviderID || "unknown"}/${info.configuredModelID || "unknown"}`,
    );
  }

  /** Opens a run for a turn the bot did not start; its agent and model come with its reply. */
  startObservedRun(sessionId: string, startedAt: number): void {
    if (!sessionId || this.runs.has(sessionId)) {
      return;
    }

    this.runs.set(sessionId, {
      sessionId,
      startedByBot: false,
      startedAt,
      hasCompletedResponse: false,
      steps: this.pendingSteps.get(sessionId) ?? [],
      interrupted: false,
      suppressFooter: this.pendingSuppress.has(sessionId),
      sealed: false,
    });
    this.pendingSteps.delete(sessionId);
    this.pendingSuppress.delete(sessionId);

    logger.debug(`[AssistantRunState] Started observed run: session=${sessionId}`);
  }

  markResponseCompleted(sessionId: string, info?: AssistantRunResolvedInfo): void {
    const run = this.runs.get(sessionId);
    if (!run) {
      return;
    }

    run.hasCompletedResponse = true;
    if (info?.agent) {
      run.actualAgent = info.agent;
    }
    if (info?.providerID) {
      run.actualProviderID = info.providerID;
    }
    if (info?.modelID) {
      run.actualModelID = info.modelID;
    }
  }

  /** Remembers one assistant step. A later step for the same message replaces it. */
  recordStep(sessionId: string, step: AssistantRunStep): void {
    if (!sessionId) {
      return;
    }

    const run = this.runs.get(sessionId);
    const steps =
      run && !run.sealed ? run.steps : (this.pendingSteps.get(sessionId) ?? []);
    const index = steps.findIndex((item) => item.messageID === step.messageID);
    if (index === -1) {
      steps.push(step);
    } else {
      steps[index] = step;
    }

    if (run && !run.sealed) {
      run.steps = steps;
      return;
    }

    this.pendingSteps.set(sessionId, steps);
  }

  /** Steps that arrive after this belong to the next run, not the one about to close. */
  sealRun(sessionId: string): void {
    const run = this.runs.get(sessionId);
    if (run) {
      run.sealed = true;
    }
  }

  markInterrupted(sessionId: string): void {
    const run = this.runs.get(sessionId);
    if (run) {
      run.interrupted = true;
    }
  }

  suppressFooter(sessionId: string): void {
    if (!sessionId) {
      return;
    }

    const run = this.runs.get(sessionId);
    if (run && !run.sealed) {
      run.suppressFooter = true;
      return;
    }

    this.pendingSuppress.add(sessionId);
  }

  isFooterSuppressed(sessionId: string): boolean {
    return this.runs.get(sessionId)?.suppressFooter === true;
  }

  /** Drops a footerless mark that an abort set and then found the session still busy. */
  clearFooterSuppression(sessionId: string): void {
    const run = this.runs.get(sessionId);
    if (run) {
      run.suppressFooter = false;
    }
    this.pendingSuppress.delete(sessionId);
  }

  hasRun(sessionId: string): boolean {
    return this.runs.has(sessionId);
  }

  hasBotRun(sessionId: string): boolean {
    return this.runs.get(sessionId)?.startedByBot === true;
  }

  isResponseCompleted(sessionId: string): boolean {
    return this.runs.get(sessionId)?.hasCompletedResponse === true;
  }

  finishRun(sessionId: string, reason: string): AssistantRunInfo | null {
    resetStreamThrottle(sessionId);
    const run = this.runs.get(sessionId) ?? null;
    if (!run) {
      return null;
    }

    this.runs.delete(sessionId);
    logger.debug(`[AssistantRunState] Finished run: session=${sessionId}, reason=${reason}`);
    return { ...run, steps: [...run.steps] };
  }

  clearRun(sessionId: string, reason: string): void {
    resetStreamThrottle(sessionId);
    this.pendingSteps.delete(sessionId);
    this.pendingSuppress.delete(sessionId);
    if (!this.runs.delete(sessionId)) {
      return;
    }

    logger.debug(`[AssistantRunState] Cleared run: session=${sessionId}, reason=${reason}`);
  }

  clearAll(reason: string): void {
    resetAllStreamThrottles();
    const count = this.runs.size;
    this.pendingSteps.clear();
    this.pendingSuppress.clear();
    if (count === 0) {
      return;
    }

    logger.debug(`[AssistantRunState] Cleared all runs: count=${count}, reason=${reason}`);
    this.runs.clear();
  }
}
