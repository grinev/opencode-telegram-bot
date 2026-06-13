import { logger } from "../../utils/logger.js";

export interface AssistantRunStartInfo {
  startedAt: number;
  configuredAgent?: string;
  configuredProviderID?: string;
  configuredModelID?: string;
}

export interface AssistantRunResolvedInfo {
  agent?: string;
  providerID?: string;
  modelID?: string;
}

export interface AssistantRunInfo extends AssistantRunStartInfo {
  sessionId: string;
  actualAgent?: string;
  actualProviderID?: string;
  actualModelID?: string;
  hasCompletedResponse: boolean;
}

class AssistantRunState {
  private readonly runs = new Map<string, AssistantRunInfo>();

  startRun(sessionId: string, info: AssistantRunStartInfo): void {
    if (!sessionId) {
      return;
    }

    this.runs.set(sessionId, {
      sessionId,
      startedAt: info.startedAt,
      configuredAgent: info.configuredAgent,
      configuredProviderID: info.configuredProviderID,
      configuredModelID: info.configuredModelID,
      hasCompletedResponse: false,
    });

    logger.debug(
      `[AssistantRunState] Started run: session=${sessionId}, agent=${info.configuredAgent || "unknown"}, model=${info.configuredProviderID || "unknown"}/${info.configuredModelID || "unknown"}`,
    );
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

  finishRun(sessionId: string, reason: string): AssistantRunInfo | null {
    const run = this.runs.get(sessionId) ?? null;
    if (!run) {
      return null;
    }

    this.runs.delete(sessionId);
    logger.debug(`[AssistantRunState] Finished run: session=${sessionId}, reason=${reason}`);
    return { ...run };
  }

  clearRun(sessionId: string, reason: string): void {
    if (!this.runs.delete(sessionId)) {
      return;
    }

    logger.debug(`[AssistantRunState] Cleared run: session=${sessionId}, reason=${reason}`);
  }

  clearAll(reason: string): void {
    if (this.runs.size === 0) {
      return;
    }

    logger.debug(`[AssistantRunState] Cleared all runs: count=${this.runs.size}, reason=${reason}`);
    this.runs.clear();
  }

  __resetForTests(): void {
    this.runs.clear();
  }
}

export const assistantRunState = new AssistantRunState();
