import { opencodeClient } from "../../opencode/client.js";
import { logger } from "../../utils/logger.js";
import { safeBackgroundTask } from "../../utils/safe-background-task.js";
import {
  DEFAULT_CONTEXT_LIMIT,
  getModelContextLimit,
  waitForModelContextLimit,
} from "../services/model-context-limit-service.js";
import { getStoredModel } from "../services/model-selection-service.js";
import type { SessionInfo } from "../types/session.js";
import type { FileChange } from "../types/summary.js";

type SessionLocation = Pick<SessionInfo, "id" | "directory">;

export interface SessionMetrics {
  tokensUsed: number | null;
  cost: number | null;
  changedFiles: FileChange[] | null;
}

interface LiveMetrics extends SessionMetrics {
  session: SessionLocation;
  contextRevision: number;
  costRevision: number;
  diffRevision: number;
  snapshotRevision: number;
  lastSnapshotCost: number | null;
}

// Large sessions can be hundreds of MB; only the latest context needs history.
const HISTORY_LIMIT = 100;

async function readContext(
  session: SessionLocation,
  previousCost: number | null,
): Promise<Pick<SessionMetrics, "tokensUsed" | "cost">> {
  const params = { sessionID: session.id, directory: session.directory };
  const [historyResult, sessionResult] = await Promise.allSettled([
    opencodeClient.session.messages({ ...params, limit: HISTORY_LIMIT }),
    opencodeClient.session.get(params),
  ]);

  const history = historyResult.status === "fulfilled" && !historyResult.value.error
    ? historyResult.value.data
    : undefined;
  const data = sessionResult.status === "fulfilled" && !sessionResult.value.error
    ? sessionResult.value.data
    : undefined;
  const sessionCost = typeof data?.cost === "number" ? data.cost : null;
  if (!history) {
    logger.debug(`[SessionMetrics] History unavailable for ${session.id}`);
    return { tokensUsed: null, cost: sessionCost };
  }

  let tokensUsed = 0;
  let latestCreated = Number.NEGATIVE_INFINITY;
  let windowCost = 0;
  for (const { info } of history) {
    if (info.role !== "assistant" || info.summary) continue;
    const contextSize = (info.tokens?.input ?? 0) + (info.tokens?.cache?.read ?? 0);
    const created = info.time?.created ?? 0;
    if (contextSize > 0 && created >= latestCreated) {
      tokensUsed = contextSize;
      latestCreated = created;
    }
    windowCost += info.cost ?? 0;
  }
  return { tokensUsed, cost: sessionCost ?? Math.max(previousCost ?? 0, windowCost) };
}

async function readFiles(session: SessionLocation): Promise<FileChange[] | null> {
  try {
    const { data, error } = await opencodeClient.session.diff({
      sessionID: session.id,
      directory: session.directory,
    });
    if (!error && data) {
      return data.flatMap(({ file, additions, deletions }) =>
        file ? [{ file, additions, deletions }] : [],
      );
    }
  } catch (error) {
    logger.debug(`[SessionMetrics] Could not load diff for ${session.id}:`, error);
  }
  return null;
}

export class SessionMetricsManager {
  private live: LiveMetrics | null = null;
  private preparing: Promise<void> | null = null;
  private contextLimit = 0;
  private limitRevision = 0;
  private onContext?: (tokensUsed: number, tokensLimit: number) => void;

  setOnKeyboardUpdate(callback: (tokensUsed: number, tokensLimit: number) => void): void {
    this.onContext = callback;
    this.notifyContext();
  }

  private notifyContext(): void {
    const context = this.getContextInfo();
    if (context) this.onContext?.(context.tokensUsed, context.tokensLimit);
  }

  getContextInfo(): { tokensUsed: number; tokensLimit: number } | null {
    const tokensUsed = this.live?.tokensUsed;
    return tokensUsed == null || !this.contextLimit
      ? null
      : { tokensUsed, tokensLimit: this.contextLimit };
  }

  getContextLimit(): number {
    return this.contextLimit;
  }

  private findSession(session: SessionLocation): LiveMetrics | null {
    const live = this.live;
    return live?.session.id === session.id && live.session.directory === session.directory
      ? live
      : null;
  }

  clear(): void {
    this.live = null;
    this.preparing = null;
  }

  async prepare(
    session: SessionLocation,
    { created = false, force = false }: { created?: boolean; force?: boolean } = {},
  ): Promise<void> {
    const existing = this.findSession(session);
    if (existing && !force) {
      await this.preparing;
      return;
    }
    const live = existing ?? {
      session,
      tokensUsed: created ? 0 : null,
      cost: created ? 0 : null,
      changedFiles: created ? [] : null,
      contextRevision: 0,
      costRevision: 0,
      diffRevision: 0,
      snapshotRevision: 0,
      lastSnapshotCost: null,
    };
    this.live = live;
    const task = Promise.all([
      this.refreshContextLimit(),
      ...(created ? [] : [this.refreshContext(live), this.refreshFiles(live)]),
    ]).then(() => {});
    this.preparing = task;
    try {
      await task;
    } finally {
      if (this.preparing === task) this.preparing = null;
    }
  }

  async waitForSessionValues(): Promise<void> {
    while (this.preparing) {
      await this.preparing;
    }
  }

  private async refreshContext(live: LiveMetrics): Promise<void> {
    const contextRevision = ++live.contextRevision;
    const costRevision = ++live.costRevision;
    const values = await readContext(live.session, live.cost);
    if (this.live !== live) return;
    if (live.costRevision === costRevision) live.cost = values.cost ?? live.cost;
    if (live.contextRevision === contextRevision) {
      live.tokensUsed = values.tokensUsed ?? live.tokensUsed;
      this.notifyContext();
    }
  }

  private async refreshFiles(live: LiveMetrics): Promise<void> {
    const revision = ++live.diffRevision;
    const files = await readFiles(live.session);
    if (files && this.live === live && live.diffRevision === revision) {
      live.changedFiles = files;
    }
  }

  async onSessionCompacted(id: string, directory: string): Promise<void> {
    const live = this.findSession({ id, directory });
    if (live) await this.refreshContext(live);
  }

  onTokens(sessionId: string, tokensUsed: number): void {
    const live = this.live;
    if (live?.session.id !== sessionId) return;
    live.contextRevision++;
    live.tokensUsed = tokensUsed;
    this.notifyContext();
  }

  onCostUpdate(sessionId: string, cost: number): void {
    const live = this.live;
    if (live?.session.id !== sessionId || live.cost === null || !Number.isFinite(cost)) return;
    live.costRevision++;
    live.cost += cost;
  }

  onSessionDiff(sessionId: string, files: FileChange[]): void {
    const live = this.live;
    if (live?.session.id !== sessionId) return;
    live.diffRevision++;
    live.changedFiles = files;
  }

  async snapshot(session: SessionLocation): Promise<SessionMetrics & { tokensLimit: number }> {
    const live = this.findSession(session);
    const contextRevision = live?.contextRevision;
    const costRevision = live?.costRevision;
    const diffRevision = live ? ++live.diffRevision : undefined;
    const snapshotRevision = live ? ++live.snapshotRevision : undefined;
    const previousCosts = [live?.cost, live?.lastSnapshotCost].filter((cost) => cost != null);
    const previousCost = previousCosts.length ? Math.max(...previousCosts) : null;
    const { providerID, modelID } = getStoredModel();
    const [context, files, tokensLimit] = await Promise.all([
      readContext(session, previousCost),
      readFiles(session),
      getModelContextLimit(providerID, modelID).catch(() => DEFAULT_CONTEXT_LIMIT),
    ]);
    if (live && this.live === live && live.diffRevision === diffRevision && files) {
      live.changedFiles = files;
    }
    const readCost = context.cost ?? previousCost;
    // The server read may already include the in-flight completion. Compare totals, do not add.
    const cost = live && live.costRevision !== costRevision && live.cost !== null
      ? Math.max(readCost ?? live.cost, live.cost)
      : readCost;
    if (live && this.live === live && live.snapshotRevision === snapshotRevision) {
      live.lastSnapshotCost = cost;
    }
    return {
      tokensUsed:
        (live?.contextRevision !== contextRevision ? live?.tokensUsed : context.tokensUsed) ??
        live?.tokensUsed ??
        null,
      tokensLimit,
      cost,
      changedFiles:
        (live?.diffRevision !== diffRevision ? live?.changedFiles : files) ??
        live?.changedFiles ??
        files,
    };
  }

  async refreshContextLimit(): Promise<void> {
    const { providerID, modelID } = getStoredModel();
    const revision = ++this.limitRevision;
    const apply = (limit: number): void => {
      if (revision !== this.limitRevision) return;
      const model = getStoredModel();
      if (model.providerID !== providerID || model.modelID !== modelID) return;
      this.contextLimit = limit;
      this.notifyContext();
    };
    try {
      apply(await getModelContextLimit(providerID, modelID));
    } catch (error) {
      logger.warn("[SessionMetrics] Could not load model context limit:", error);
      apply(DEFAULT_CONTEXT_LIMIT);
    }
    if (providerID && modelID && revision === this.limitRevision) {
      safeBackgroundTask({
        taskName: "sessionMetrics.waitForContextLimit",
        task: () => waitForModelContextLimit(providerID, modelID),
        onSuccess: (limit) => {
          if (limit !== null && limit !== this.contextLimit) apply(limit);
        },
      });
    }
  }
}
