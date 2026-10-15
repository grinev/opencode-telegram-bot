import type { Api } from "grammy";
import { logger } from "../../utils/logger.js";
import { opencodeClient } from "../../opencode/client.js";
import { getGitWorktreeContext } from "../../app/services/worktree-service.js";
import { getCurrentSession } from "../../app/services/session-service.js";
import {
  getCurrentProject,
  getPinnedDashboardEnabled,
  getPinnedMessageId,
  setPinnedMessageId,
  clearPinnedMessageId,
} from "../../app/stores/settings-store.js";
import {
  DEFAULT_CONTEXT_LIMIT,
  getModelContextLimit,
  waitForModelContextLimit,
} from "../../app/services/model-context-limit-service.js";
import { getStoredModel } from "../../app/services/model-selection-service.js";
import { getPatchFileChanges } from "../../app/formatters/summary-formatter.js";
import { isExpectedOpencodeUnavailableError } from "../../utils/opencode-error.js";
import { safeBackgroundTask } from "../../utils/safe-background-task.js";
import type { FileChange, PinnedMessageState, TokensInfo } from "./pinned-message-types.js";
import { t } from "../../i18n/index.js";
import {
  formatContextLine,
  formatCostLine,
  formatModelDisplayName,
} from "./pinned-message-format.js";
import { getSessionStreamThrottleMs } from "../streaming/stream-throttle.js";

type SessionHistory = NonNullable<
  Awaited<ReturnType<typeof opencodeClient.session.messages>>["data"]
>;
type SessionDiff = NonNullable<Awaited<ReturnType<typeof opencodeClient.session.diff>>["data"]>;

/** A session's dashboard values as loaded from OpenCode; a part is null when its load failed. */
interface LoadedSessionValues {
  context: { tokensUsed: number; cost: number } | null;
  changedFiles: FileChange[] | null;
}

/** A session committed to the held state whose dashboard is not drawn yet. */
interface PreparedSession {
  generation: number;
  kind: "change" | "restore";
}

export type PinnedRenderScheduler = (render: () => Promise<void>) => Promise<void>;

export class PinnedMessageManager {
  private api: Api | null = null;
  private chatId: number | null = null;
  private state: PinnedMessageState = {
    messageId: null,
    chatId: null,
    sessionId: null,
    sessionTitle: t("pinned.default_session_title"),
    attachActive: false,
    attachBusy: false,
    projectPath: "",
    projectBranch: null,
    projectWorktreePath: null,
    tokensUsed: 0,
    tokensLimit: 0,
    lastUpdated: 0,
    changedFiles: [],
    cost: 0,
  };
  private contextLimit: number | null = null;
  private onKeyboardUpdateCallback?:
    | ((tokensUsed: number, tokensLimit: number) => void)
    | undefined;
  private updateDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private updateTask: Promise<void> | null = null;
  private pendingUpdate = false;
  private pendingForceUpdate = false;
  private lastRenderedMessageText: string | null = null;
  private leftoverUnpinMessageId: number | null = null;
  private sessionGeneration = 0;
  private preparing: Promise<void> | null = null;
  private prepared: PreparedSession | null = null;
  private valueUpdateCount = 0;
  private renderScheduler: PinnedRenderScheduler = (render) => render();

  /**
   * Initialize manager with bot API and chat ID
   */
  initialize(api: Api, chatId: number): void {
    this.api = api;
    this.chatId = chatId;

    // Restore pinned message ID from settings
    const savedMessageId = getPinnedMessageId();
    if (savedMessageId) {
      this.state.chatId = chatId;
      if (getPinnedDashboardEnabled()) {
        this.state.messageId = savedMessageId;
      } else {
        this.leftoverUnpinMessageId = savedMessageId;
      }
    }
  }

  /**
   * Called when session changes - send a new pinned message once its values are loaded
   */
  async onSessionChange(
    sessionId: string,
    sessionTitle: string,
    options: { directory?: string; created?: boolean } = {},
  ): Promise<void> {
    await this.prepareSessionChange(sessionId, sessionTitle, options);
    await this.showPreparedSession();
  }

  /**
   * Load a session's context, cost and files and commit them to the held state, without drawing.
   * The previous dashboard is no longer edited from here on; it stays pinned until the new one
   * is shown. The held session keeps its values (a rename re-sends them); a session created a
   * moment ago has nothing to load.
   */
  async prepareSessionChange(
    sessionId: string,
    sessionTitle: string,
    options: { directory?: string; created?: boolean } = {},
  ): Promise<void> {
    logger.info(`[PinnedManager] Session changed: ${sessionId}, title: ${sessionTitle}`);

    const generation = ++this.sessionGeneration;
    const sameSession = this.state.sessionId === sessionId;

    await this.trackPrepare(async () => {
      if (!getPinnedDashboardEnabled()) {
        await this.dropOwnedDashboardQuietly();
      }

      const values =
        sameSession || options.created
          ? null
          : await this.loadSessionValues(sessionId, this.resolveDirectory(options.directory));
      if (generation !== this.sessionGeneration) {
        logger.debug(`[PinnedManager] Dropping superseded session change: ${sessionId}`);
        return;
      }

      if (!sameSession) {
        this.state.tokensUsed = values?.context?.tokensUsed ?? 0;
        this.state.cost = values?.context?.cost ?? 0;
        this.state.changedFiles = values?.changedFiles ?? [];
      }
      this.commitSessionIdentity(sessionId, sessionTitle);
      if (this.state.messageId) {
        // Keep the dashboard being replaced tracked as a leftover: the specific unpin in
        // showPreparedSession needs its id, and unpinAllChatMessages is heavily rate-limited.
        await this.parkLeftoverDashboard(this.state.messageId);
      }

      await this.refreshProjectMetadata();
      await this.fetchContextLimit();
      if (generation !== this.sessionGeneration) {
        return;
      }

      this.notifyKeyboard();
      this.prepared = { generation, kind: "change" };
    });
  }

  /**
   * Load the values of the session a persisted pinned message belongs to, without drawing.
   * Nothing is committed unless both the context and the files loaded, so the message on
   * screen is left as it is and the next attach retries.
   */
  async prepareRestore(sessionId: string, sessionTitle: string, directory?: string): Promise<void> {
    logger.info(`[PinnedManager] Restoring existing pinned message for session: ${sessionId}`);

    const generation = ++this.sessionGeneration;

    await this.trackPrepare(async () => {
      if (!getPinnedDashboardEnabled()) {
        await this.dropOwnedDashboardQuietly();
      }

      const values = await this.loadSessionValues(sessionId, this.resolveDirectory(directory));
      if (generation !== this.sessionGeneration) {
        logger.debug(`[PinnedManager] Dropping superseded restore: ${sessionId}`);
        return;
      }

      if (!values.context || !values.changedFiles) {
        logger.warn(
          `[PinnedManager] Session values did not fully load; leaving the pinned message as it is: ${sessionId}`,
        );
        return;
      }

      this.state.tokensUsed = values.context.tokensUsed;
      this.state.cost = values.context.cost;
      this.state.changedFiles = values.changedFiles;
      this.commitSessionIdentity(sessionId, sessionTitle);

      await this.refreshProjectMetadata();
      await this.fetchContextLimit();
      if (generation !== this.sessionGeneration) {
        return;
      }

      this.notifyKeyboard();
      this.prepared = { generation, kind: "restore" };
    });
  }

  /**
   * Draw the session prepared last: send and pin a new dashboard after a change, or edit the
   * persisted one once after a restore. Does nothing when a newer change superseded it.
   */
  async showPreparedSession(): Promise<void> {
    const prepared = this.prepared;
    if (!prepared || prepared.generation !== this.sessionGeneration) {
      return;
    }
    this.prepared = null;

    if (prepared.kind === "change" && getPinnedDashboardEnabled()) {
      await this.unpinOldMessage();
      await this.createPinnedMessage();
    }
    this.fillContextLimitWhenListed();

    // Draws an update that landed while the message was being sent, or the restored values.
    await this.updatePinnedMessage();
  }

  /** Cancels a session change or restore still loading, so it never draws. */
  dropPendingPrepare(): void {
    if (this.preparing) {
      this.sessionGeneration++;
    }
  }

  /** Resolves once no session change or restore is loading. */
  async waitForSessionValues(): Promise<void> {
    while (this.preparing) {
      await this.preparing.catch(() => {});
    }
  }

  /**
   * Reload the held session's values and draw them. Never cancels a session change: it is
   * skipped while one loads, and its result is dropped when an update or a change arrives
   * meanwhile — the held values are then at least as fresh.
   */
  async refreshSessionValues(): Promise<void> {
    const sessionId = this.state.sessionId;
    if (!sessionId || this.preparing) {
      return;
    }

    const session = getCurrentSession();
    const directory = this.resolveDirectory(
      session?.id === sessionId ? session.directory : undefined,
    );
    const generation = this.sessionGeneration;
    const updateCount = this.valueUpdateCount;

    const values = await this.loadSessionValues(sessionId, directory);
    if (
      generation !== this.sessionGeneration ||
      updateCount !== this.valueUpdateCount ||
      this.state.sessionId !== sessionId
    ) {
      logger.debug(`[PinnedManager] Dropping session values refresh: ${sessionId}`);
      return;
    }

    if (values.context) {
      this.state.tokensUsed = values.context.tokensUsed;
      this.state.cost = values.context.cost;
    }
    if (values.changedFiles) {
      this.state.changedFiles = values.changedFiles;
    }
    await this.updatePinnedMessage();
  }

  /**
   * Route the redraws caused by session events through the given scheduler, so they can wait
   * while the chat's outbound messages are held. Values are applied at once regardless.
   */
  setRenderScheduler(scheduler: PinnedRenderScheduler): void {
    this.renderScheduler = scheduler;
  }

  private async trackPrepare(prepare: () => Promise<void>): Promise<void> {
    const task = prepare();
    this.preparing = task;
    try {
      await task;
    } finally {
      if (this.preparing === task) {
        this.preparing = null;
      }
    }
  }

  private commitSessionIdentity(sessionId: string, sessionTitle: string): void {
    this.state.sessionId = sessionId;
    this.state.sessionTitle = sessionTitle || t("pinned.default_session_title");
    this.state.attachActive = false;
    this.state.attachBusy = false;
    this.lastRenderedMessageText = null;
    this.pendingUpdate = false;
    this.pendingForceUpdate = false;
  }

  private notifyKeyboard(): void {
    if (this.onKeyboardUpdateCallback && this.state.tokensLimit > 0) {
      this.onKeyboardUpdateCallback(this.state.tokensUsed, this.state.tokensLimit);
    }
  }

  private resolveDirectory(directory: string | undefined): string | undefined {
    return directory ?? getCurrentProject()?.worktree;
  }

  /**
   * Called when session title is updated (after first message)
   */
  async onSessionTitleUpdate(newTitle: string): Promise<void> {
    if (this.state.sessionTitle !== newTitle && newTitle) {
      logger.debug(`[PinnedManager] Session title updated: ${newTitle}`);
      this.state.sessionTitle = newTitle;
      await this.updatePinnedMessage();
    }
  }

  async setAttachState(active: boolean, busy: boolean): Promise<void> {
    const nextBusy = active ? busy : false;
    if (this.state.attachActive === active && this.state.attachBusy === nextBusy) {
      return;
    }

    this.state.attachActive = active;
    this.state.attachBusy = nextBusy;
    await this.updatePinnedMessage();
  }

  /**
   * Load context token usage from session history
   */
  async loadContextFromHistory(sessionId: string, directory: string): Promise<void> {
    const history = await this.fetchSessionHistory(sessionId, directory);
    if (!history) {
      return;
    }

    const context = this.readContextFromHistory(history);
    this.state.tokensUsed = context.tokensUsed;
    this.state.cost = context.cost;
    this.state.sessionId = sessionId;

    logger.info(
      `[PinnedManager] Loaded context from history: ${this.state.tokensUsed} tokens, cost: $${this.state.cost.toFixed(2)}`,
    );

    await this.updatePinnedMessage();
  }

  private async fetchSessionHistory(
    sessionId: string,
    directory: string,
  ): Promise<SessionHistory | null> {
    try {
      logger.debug(`[PinnedManager] Loading context from history for session: ${sessionId}`);

      const { data: messagesData, error } = await opencodeClient.session.messages({
        sessionID: sessionId,
        directory,
      });

      if (error || !messagesData) {
        if (isExpectedOpencodeUnavailableError(error)) {
          logger.warn("[PinnedManager] OpenCode server unavailable; skipping session history load");
        } else {
          logger.warn("[PinnedManager] Failed to load session history:", error);
        }
        return null;
      }

      return messagesData;
    } catch (err) {
      if (isExpectedOpencodeUnavailableError(err)) {
        logger.warn("[PinnedManager] OpenCode server unavailable; skipping session history load");
      } else {
        logger.error("[PinnedManager] Error loading context from history:", err);
      }
      return null;
    }
  }

  /**
   * The latest measured context size and the total cost in a session's history.
   * Context = input + cache.read (cache.read contains previously cached context).
   */
  private readContextFromHistory(history: SessionHistory): { tokensUsed: number; cost: number } {
    let latestContextSize = 0;
    let latestContextCreated = Number.NEGATIVE_INFINITY;
    let totalCost = 0;
    logger.debug(`[PinnedManager] Processing ${history.length} messages from history`);

    history.forEach(({ info }) => {
      if (info.role === "assistant") {
        const assistantInfo = info as {
          summary?: boolean;
          tokens?: {
            input: number;
            cache?: { read: number };
          };
          time?: { created?: number };
          cost?: number;
        };

        // Skip summary messages (technical, not real agent responses)
        if (assistantInfo.summary) {
          logger.debug(`[PinnedManager] Skipping summary message`);
          return;
        }

        const input = assistantInfo.tokens?.input || 0;
        const cacheRead = assistantInfo.tokens?.cache?.read || 0;
        const contextSize = input + cacheRead;
        const cost = assistantInfo.cost || 0;

        logger.debug(
          `[PinnedManager] Assistant message: input=${input}, cache.read=${cacheRead}, total=${contextSize}, cost=$${cost.toFixed(2)}`,
        );

        const created = assistantInfo.time?.created ?? 0;
        if (contextSize > 0 && created >= latestContextCreated) {
          latestContextSize = contextSize;
          latestContextCreated = created;
        }

        // Accumulate total session cost
        totalCost += cost;
      }
    });

    return { tokensUsed: latestContextSize, cost: totalCost };
  }

  /**
   * Called when session is compacted - reload context from history
   */
  async onSessionCompacted(sessionId: string, directory: string): Promise<void> {
    logger.info(`[PinnedManager] Session compacted, reloading context: ${sessionId}`);

    // Reload context from updated history (after compaction)
    await this.loadContextFromHistory(sessionId, directory);
  }

  /**
   * Called when assistant message completes with token info
   */
  async onMessageComplete(tokens: TokensInfo): Promise<void> {
    // Context = input + cache.read (cache.read contains previously cached context)
    // This represents the actual context window usage
    this.state.tokensUsed = tokens.input + tokens.cacheRead;
    this.valueUpdateCount++;

    logger.debug(
      `[PinnedManager] Tokens updated: ${this.state.tokensUsed}/${this.state.tokensLimit}`,
    );

    await this.renderScheduler(async () => {
      // Ensure context limit is available even if session was restored
      // without a fresh onSessionChange call (for example after /abort + continue).
      if (this.getContextLimit() === 0) {
        await this.fetchContextLimit();
      }

      // Also fetch latest session title (it may have changed after first message)
      await this.refreshSessionTitle();

      await this.updatePinnedMessage();
    });
  }

  /**
   * Update tokens in memory without triggering an API call.
   * Used for intermediate (non-completed) message.updated events
   * to keep pinned state in sync with keyboardManager.
   */
  updateTokensSilent(tokens: TokensInfo): void {
    this.state.tokensUsed = tokens.input + tokens.cacheRead;
    this.valueUpdateCount++;
    logger.debug(
      `[PinnedManager] Tokens updated (silent): ${this.state.tokensUsed}/${this.state.tokensLimit}`,
    );
  }

  /**
   * Refresh the pinned message with current in-memory state.
   * Used at thinking time to push accumulated silent updates to Telegram.
   */
  async refresh(): Promise<void> {
    await this.refreshProjectMetadata();
    await this.updatePinnedMessage(true);
  }

  /**
   * Called when cost info is received from SSE events
   */
  async onCostUpdate(cost: number): Promise<void> {
    if (!Number.isFinite(cost) || cost === 0) {
      logger.debug("[PinnedManager] Ignoring non-impacting cost update");
      return;
    }

    const currentCost = this.state.cost || 0;
    this.state.cost = currentCost + cost;
    this.valueUpdateCount++;
    logger.debug(
      `[PinnedManager] Cost added: $${cost.toFixed(2)}, total session: $${(this.state.cost || 0).toFixed(2)}`,
    );
    await this.renderScheduler(() => this.updatePinnedMessage());
  }

  /**
   * Set callback for keyboard updates when context changes
   */
  setOnKeyboardUpdate(callback: (tokensUsed: number, tokensLimit: number) => void): void {
    this.onKeyboardUpdateCallback = callback;
    logger.debug("[PinnedManager] Keyboard update callback registered");

    // Fire immediately with current state to fix race condition:
    // onSessionChange may have already run before this callback was registered.
    const limit = this.state.tokensLimit > 0 ? this.state.tokensLimit : this.contextLimit || 0;
    if (limit > 0) {
      callback(this.state.tokensUsed, limit);
    }
  }

  /**
   * Get current context information
   */
  getContextInfo(): { tokensUsed: number; tokensLimit: number } | null {
    // Use cached contextLimit if tokensLimit is not set yet
    const limit = this.state.tokensLimit > 0 ? this.state.tokensLimit : this.contextLimit || 0;
    if (limit === 0) {
      return null;
    }
    return {
      tokensUsed: this.state.tokensUsed,
      tokensLimit: limit,
    };
  }

  /**
   * Get context limit (for keyboard display when no session)
   * Returns cached limit or 0 if not available
   */
  getContextLimit(): number {
    return this.contextLimit || this.state.tokensLimit || 0;
  }

  /**
   * Refresh context limit for current model (call after model change)
   */
  async refreshContextLimit(): Promise<void> {
    await this.fetchContextLimit();
  }

  /**
   * The stored model changed: re-read its context limit, fill in its own limit once the catalog
   * lists it, and redraw the existing dashboard in place.
   */
  async onModelChange(): Promise<void> {
    await this.fetchContextLimit();
    this.fillContextLimitWhenListed();
    await this.refresh();
  }

  /**
   * Called when session.diff SSE event is received.
   * Only overwrites if non-empty (API may return empty while tool events collected data).
   */
  async onSessionDiff(diffs: FileChange[]): Promise<void> {
    if (diffs.length === 0 && this.state.changedFiles.length > 0) {
      logger.debug("[PinnedManager] Ignoring empty session.diff, keeping tool-collected data");
      return;
    }

    if (this.areFileDiffsEqual(this.state.changedFiles, diffs)) {
      logger.debug("[PinnedManager] Ignoring unchanged session.diff");
      return;
    }

    this.state.changedFiles = diffs;
    this.valueUpdateCount++;
    logger.debug(`[PinnedManager] Session diff updated: ${diffs.length} files`);
    this.scheduleDebouncedUpdate();
  }

  /**
   * Called when a single file is changed (from tool events: edit/write)
   */
  addFileChange(change: FileChange): void {
    const existing = this.state.changedFiles.find((f) => f.file === change.file);
    if (existing) {
      existing.additions += change.additions;
      existing.deletions += change.deletions;
    } else {
      this.state.changedFiles.push(change);
    }
    this.valueUpdateCount++;
    logger.debug(
      `[PinnedManager] File change added: ${change.file} (+${change.additions} -${change.deletions}), total: ${this.state.changedFiles.length}`,
    );

    // Schedule debounced update (avoid spamming Telegram API on rapid tool events)
    this.scheduleDebouncedUpdate();
  }

  private scheduleDebouncedUpdate(): void {
    if (this.updateDebounceTimer) {
      clearTimeout(this.updateDebounceTimer);
    }

    const delayMs = getSessionStreamThrottleMs(this.state.sessionId ?? "");
    this.updateDebounceTimer = setTimeout(() => {
      this.updateDebounceTimer = null;
      void this.renderScheduler(() => this.updatePinnedMessage());
    }, delayMs);
  }

  /**
   * Load a session's context, cost and changed files in parallel, without touching the held
   * state. Files come from session.diff(), or from the history's tool parts when it is empty.
   */
  private async loadSessionValues(
    sessionId: string,
    directory: string | undefined,
  ): Promise<LoadedSessionValues> {
    if (!directory) {
      logger.debug(
        `[PinnedManager] No project directory; skipping session values load: ${sessionId}`,
      );
      return { context: null, changedFiles: null };
    }

    const [history, diff] = await Promise.all([
      this.fetchSessionHistory(sessionId, directory),
      this.fetchSessionDiff(sessionId, directory),
    ]);

    let changedFiles: FileChange[] | null = null;
    if (diff && diff.length > 0) {
      changedFiles = diff
        .filter((d): d is typeof d & { file: string } => !!d.file)
        .map((d) => ({
          file: d.file,
          additions: d.additions,
          deletions: d.deletions,
        }));
      logger.info(`[PinnedManager] Loaded ${changedFiles.length} file diffs from session.diff()`);
    } else if (history) {
      changedFiles = this.readFileChangesFromHistory(history);
      logger.info(`[PinnedManager] Loaded ${changedFiles.length} file diffs from messages`);
    }

    return {
      context: history ? this.readContextFromHistory(history) : null,
      changedFiles,
    };
  }

  private async fetchSessionDiff(
    sessionId: string,
    directory: string,
  ): Promise<SessionDiff | null> {
    try {
      logger.debug(`[PinnedManager] Loading file diffs for session: ${sessionId}`);

      const { data, error } = await opencodeClient.session.diff({
        sessionID: sessionId,
        directory,
      });

      logger.debug(
        `[PinnedManager] session.diff() result: error=${!!error}, data.length=${data?.length ?? 0}`,
      );

      return error || !data ? null : data;
    } catch (err) {
      if (isExpectedOpencodeUnavailableError(err)) {
        logger.debug("[PinnedManager] OpenCode server unavailable; skipping diff restore");
      } else {
        logger.debug("[PinnedManager] Could not load diffs from API:", err);
      }
      return null;
    }
  }

  /**
   * Extract file changes from a session's completed edit/write/apply_patch tool parts
   */
  private readFileChangesFromHistory(history: SessionHistory): FileChange[] {
    const filesMap = new Map<string, FileChange>();

    let toolCount = 0;
    let fileToolCount = 0;

    for (const { parts } of history) {
      for (const part of parts) {
        if (part.type !== "tool") continue;
        toolCount++;

        const toolPart = part as {
          tool: string;
          state: {
            status: string;
            input?: { [key: string]: unknown };
            metadata?: { [key: string]: unknown };
          };
        };

        if (toolPart.state.status !== "completed") continue;

        if (
          toolPart.tool === "edit" ||
          toolPart.tool === "write" ||
          toolPart.tool === "apply_patch"
        ) {
          fileToolCount++;
        }

        const patchChanges =
          toolPart.tool === "apply_patch" ? getPatchFileChanges(toolPart.state.metadata) : [];

        if (patchChanges.length > 0) {
          for (const change of patchChanges) {
            const existing = filesMap.get(change.path);
            if (existing) {
              existing.additions += change.additions;
              existing.deletions += change.deletions;
            } else {
              filesMap.set(change.path, {
                file: change.path,
                additions: change.additions,
                deletions: change.deletions,
              });
            }
          }
        } else if (
          (toolPart.tool === "edit" || toolPart.tool === "apply_patch") &&
          toolPart.state.metadata &&
          "filediff" in toolPart.state.metadata
        ) {
          const filediff = toolPart.state.metadata.filediff as {
            file?: string;
            additions?: number;
            deletions?: number;
          };
          if (filediff.file) {
            const existing = filesMap.get(filediff.file);
            if (existing) {
              existing.additions += filediff.additions || 0;
              existing.deletions += filediff.deletions || 0;
            } else {
              filesMap.set(filediff.file, {
                file: filediff.file,
                additions: filediff.additions || 0,
                deletions: filediff.deletions || 0,
              });
            }
          }
        } else if (
          toolPart.tool === "write" &&
          toolPart.state.input &&
          "filePath" in toolPart.state.input &&
          "content" in toolPart.state.input
        ) {
          const filePath = toolPart.state.input.filePath as string;
          const content = toolPart.state.input.content as string;
          const lines = content.split("\n").length;
          const existing = filesMap.get(filePath);
          if (existing) {
            existing.additions += lines;
          } else {
            filesMap.set(filePath, {
              file: filePath,
              additions: lines,
              deletions: 0,
            });
          }
        }
      }
    }

    logger.debug(
      `[PinnedManager] readFileChangesFromHistory: found ${toolCount} tool parts, ${fileToolCount} file tools`,
    );

    return Array.from(filesMap.values());
  }

  /**
   * Refresh session title from API
   */
  private async refreshSessionTitle(): Promise<void> {
    const session = getCurrentSession();
    const project = getCurrentProject();

    if (!session || !project) {
      return;
    }

    try {
      const { data: sessionData } = await opencodeClient.session.get({
        sessionID: session.id,
        directory: project.worktree,
      });

      if (sessionData && sessionData.title !== this.state.sessionTitle) {
        this.state.sessionTitle = sessionData.title;
        logger.debug(`[PinnedManager] Session title refreshed: ${sessionData.title}`);
      }
    } catch (err) {
      if (isExpectedOpencodeUnavailableError(err)) {
        logger.debug("[PinnedManager] OpenCode server unavailable; skipping session title refresh");
      } else {
        logger.debug("[PinnedManager] Could not refresh session title:", err);
      }
    }
  }

  /**
   * Refresh current project name and git branch.
   */
  private async refreshProjectMetadata(): Promise<void> {
    const project = getCurrentProject();
    this.state.projectPath = project?.worktree || t("pinned.unknown");
    this.state.projectBranch = null;
    this.state.projectWorktreePath = null;

    if (!project?.worktree) {
      return;
    }

    try {
      const worktreeContext = await getGitWorktreeContext(project.worktree);
      if (!worktreeContext) {
        return;
      }

      this.state.projectPath = worktreeContext.mainProjectPath;
      this.state.projectBranch = worktreeContext.branch;
      this.state.projectWorktreePath = worktreeContext.isLinkedWorktree
        ? worktreeContext.activeWorktreePath
        : null;
    } catch (err) {
      logger.debug("[PinnedManager] Could not resolve git worktree metadata:", err);
    }
  }

  /**
   * Make file path relative to project worktree
   */
  private makeRelativePath(filePath: string): string {
    const normalized = filePath.replace(/\\/g, "/");
    const project = getCurrentProject();

    if (project?.worktree) {
      const worktree = project.worktree.replace(/\\/g, "/");
      if (normalized.startsWith(worktree)) {
        // Remove worktree prefix and leading slash
        let relative = normalized.slice(worktree.length);
        if (relative.startsWith("/")) {
          relative = relative.slice(1);
        }
        return relative || normalized;
      }
    }

    // Fallback: just show last 3 segments if path is still absolute
    const segments = normalized.split("/");
    if (segments.length <= 3) return normalized;
    return ".../" + segments.slice(-3).join("/");
  }

  private areFileDiffsEqual(current: FileChange[], next: FileChange[]): boolean {
    if (current.length !== next.length) {
      return false;
    }

    for (let index = 0; index < current.length; index++) {
      const left = current[index];
      const right = next[index];
      if (
        !left ||
        !right ||
        left.file !== right.file ||
        left.additions !== right.additions ||
        left.deletions !== right.deletions
      ) {
        return false;
      }
    }

    return true;
  }

  /**
   * Fetch context limit from current model configuration
   */
  private async fetchContextLimit(): Promise<void> {
    try {
      const model = getStoredModel();
      this.contextLimit = await getModelContextLimit(model.providerID, model.modelID);
      this.state.tokensLimit = this.contextLimit;
      logger.debug(`[PinnedManager] Context limit: ${this.contextLimit}`);
    } catch (err) {
      if (isExpectedOpencodeUnavailableError(err)) {
        logger.warn("[PinnedManager] OpenCode server unavailable; using default context limit");
      } else {
        logger.error("[PinnedManager] Error fetching context limit:", err);
      }
      this.contextLimit = DEFAULT_CONTEXT_LIMIT;
      this.state.tokensLimit = this.contextLimit;
    }
  }

  /**
   * The limit just drawn is the default while the server has not listed the model's provider
   * yet (a location waking after idle): fill in the model's own limit once it is listed.
   */
  private fillContextLimitWhenListed(): void {
    const sessionId = this.state.sessionId;
    const model = getStoredModel();
    if (!model.providerID || !model.modelID) {
      return;
    }

    safeBackgroundTask({
      taskName: "pinned.fillContextLimit",
      task: () => waitForModelContextLimit(model.providerID, model.modelID),
      onSuccess: async (limit) => {
        const currentModel = getStoredModel();
        if (
          limit === null ||
          limit === this.contextLimit ||
          this.state.sessionId !== sessionId ||
          currentModel.providerID !== model.providerID ||
          currentModel.modelID !== model.modelID
        ) {
          return;
        }

        logger.info(
          `[PinnedManager] Context limit filled in after the model was listed: ${model.providerID}/${model.modelID}, limit=${limit}`,
        );
        this.contextLimit = limit;
        this.state.tokensLimit = limit;
        await this.updatePinnedMessage(true);
      },
    });
  }

  /**
   * Format the pinned message text
   */
  private formatMessage(): string {
    const currentModel = getStoredModel();
    const modelName = formatModelDisplayName(
      currentModel.providerID,
      currentModel.modelID,
      currentModel.variant,
    );
    const projectDisplayName = this.state.projectBranch
      ? `${this.state.projectPath}: ${this.state.projectBranch}`
      : this.state.projectPath;

    const lines = [
      `${this.state.sessionTitle}`,
      t("pinned.line.project", { project: projectDisplayName }),
    ];

    if (this.state.projectWorktreePath) {
      lines.push(t("pinned.line.worktree", { worktree: this.state.projectWorktreePath }));
    }

    lines.push(t("pinned.line.model", { model: modelName }));

    lines.push(formatContextLine(this.state.tokensUsed, this.state.tokensLimit));

    if (this.state.cost !== undefined && this.state.cost !== null) {
      lines.push(formatCostLine(this.state.cost));
    }

    if (this.state.changedFiles.length > 0) {
      const maxFiles = 10;
      const total = this.state.changedFiles.length;
      const filesToShow = this.state.changedFiles.slice(0, maxFiles);

      lines.push("");
      lines.push(t("pinned.files.title", { count: total }));

      for (const f of filesToShow) {
        const relativePath = this.makeRelativePath(f.file);
        const parts = [];
        if (f.additions > 0) parts.push(`+${f.additions}`);
        if (f.deletions > 0) parts.push(`-${f.deletions}`);
        const diffStr = parts.length > 0 ? ` (${parts.join(" ")})` : "";
        lines.push(t("pinned.files.item", { path: relativePath, diff: diffStr }));
      }

      if (total > maxFiles) {
        lines.push(t("pinned.files.more", { count: total - maxFiles }));
      }
    }

    return lines.join("\n");
  }

  async applyPinnedDashboardEnabled(enabled: boolean): Promise<void> {
    if (!enabled) {
      await this.unpinOwnedDashboard();
      return;
    }

    if (!this.api || !this.chatId) {
      throw new Error("Pinned manager is not initialized");
    }

    if (this.leftoverUnpinMessageId) {
      // Retires the parked dashboard, and the held one too when a failed unpin left both.
      await this.unpinOwnedDashboard();
    }

    const session = getCurrentSession();
    if (!session) {
      return;
    }

    if (this.state.messageId && this.state.sessionId === session.id) {
      try {
        await this.api.pinChatMessage(this.chatId, this.state.messageId, {
          disable_notification: true,
        });
        setPinnedMessageId(this.state.messageId);
        return;
      } catch (err) {
        if (!this.isMessageMissingError(err)) {
          throw err;
        }
        this.forgetOwnedDashboard();
      }
    } else if (this.state.messageId) {
      await this.unpinOwnedDashboard();
    }

    this.state.sessionId = session.id;
    this.state.sessionTitle = session.title || t("pinned.default_session_title");
    this.hydrateDashboardFromLocalState();
    await this.sendAndPinForEnable();
  }

  private async sendAndPinForEnable(): Promise<void> {
    if (!this.api || !this.chatId) {
      throw new Error("Pinned manager is not initialized");
    }

    const text = this.formatMessage();
    const sentMessage = await this.api.sendMessage(this.chatId, text);

    this.state.messageId = sentMessage.message_id;
    this.state.chatId = this.chatId;
    this.state.lastUpdated = Date.now();
    this.lastRenderedMessageText = text;

    try {
      await this.api.pinChatMessage(this.chatId, sentMessage.message_id, {
        disable_notification: true,
      });
    } catch (err) {
      if (this.isMessageMissingError(err)) {
        this.forgetOwnedDashboard();
      }
      throw err;
    }

    setPinnedMessageId(sentMessage.message_id);
    logger.info(`[PinnedManager] Created and pinned message: ${sentMessage.message_id}`);
  }

  private async unpinOwnedDashboard(): Promise<void> {
    const messageId = this.state.messageId;
    const leftoverId = this.leftoverUnpinMessageId;
    if (!messageId && !leftoverId) {
      return;
    }

    if (!this.api || !this.chatId) {
      this.forgetOwnedDashboard();
      return;
    }

    if (messageId) {
      await this.unpinMessageOrThrow(messageId);
    }
    if (leftoverId && leftoverId !== messageId) {
      await this.unpinMessageOrThrow(leftoverId);
    }
    this.forgetOwnedDashboard();
  }

  private async unpinMessageOrThrow(messageId: number): Promise<void> {
    if (!this.api || !this.chatId) {
      throw new Error("Pinned manager is not initialized");
    }

    try {
      await this.api.unpinChatMessage(this.chatId, messageId);
    } catch (err) {
      if (!this.isMessageMissingError(err)) {
        throw err;
      }
    }
  }

  private forgetOwnedDashboard(): void {
    this.state.messageId = null;
    this.leftoverUnpinMessageId = null;
    this.lastRenderedMessageText = null;
    this.pendingUpdate = false;
    this.pendingForceUpdate = false;
    clearPinnedMessageId();
  }

  private hydrateDashboardFromLocalState(): void {
    if (!this.state.projectPath) {
      const project = getCurrentProject();
      this.state.projectPath = project?.worktree || t("pinned.unknown");
    }

    if (!this.state.tokensLimit) {
      const limit = this.contextLimit || DEFAULT_CONTEXT_LIMIT;
      this.contextLimit = limit;
      this.state.tokensLimit = limit;
    }
  }

  private async dropOwnedDashboardQuietly(): Promise<void> {
    const messageId = this.state.messageId ?? this.leftoverUnpinMessageId;
    if (!messageId) {
      return;
    }

    if (!this.api || !this.chatId) {
      await this.parkLeftoverDashboard(messageId);
      return;
    }

    try {
      await this.api.unpinChatMessage(this.chatId, messageId);
    } catch (err) {
      if (!this.isMessageMissingError(err)) {
        logger.warn("[PinnedManager] Could not unpin leftover dashboard:", err);
        await this.parkLeftoverDashboard(messageId);
        return;
      }
    }

    this.forgetOwnedDashboard();
  }

  private async parkLeftoverDashboard(messageId: number): Promise<void> {
    const previousLeftoverId = this.leftoverUnpinMessageId;
    if (previousLeftoverId !== null && previousLeftoverId !== messageId) {
      // Retire the previously parked dashboard before its reference is replaced, so a failed
      // unpin cannot leave a pinned message the bot no longer tracks.
      try {
        await this.unpinMessageOrThrow(previousLeftoverId);
      } catch (err) {
        logger.warn(
          `[PinnedManager] Replacing parked dashboard ${previousLeftoverId} with ${messageId}; the older message is no longer tracked:`,
          err,
        );
      }
    }
    this.leftoverUnpinMessageId = messageId;
    this.state.messageId = null;
    this.lastRenderedMessageText = null;
  }

  private isMessageMissingError(err: unknown): boolean {
    const errorMessage = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
    return (
      errorMessage.includes("message to edit not found") ||
      errorMessage.includes("message to pin not found") ||
      errorMessage.includes("message to unpin not found") ||
      errorMessage.includes("message not found") ||
      errorMessage.includes("not pinned")
    );
  }

  private async createPinnedMessage(): Promise<void> {
    if (!getPinnedDashboardEnabled()) {
      return;
    }

    if (!this.api || !this.chatId) {
      logger.warn("[PinnedManager] API or chatId not initialized");
      return;
    }

    try {
      const text = this.formatMessage();

      // Send new message
      const sentMessage = await this.api.sendMessage(this.chatId, text);

      if (this.state.messageId) {
        // A dashboard from an interrupted flow is still pinned: keep its id tracked so the
        // next unpin removes it instead of losing the pin.
        await this.parkLeftoverDashboard(this.state.messageId);
      }
      this.state.messageId = sentMessage.message_id;
      this.state.chatId = this.chatId;
      this.state.lastUpdated = Date.now();
      this.lastRenderedMessageText = text;

      // Save to settings for persistence
      setPinnedMessageId(sentMessage.message_id);

      // Pin the message (silently)
      await this.api.pinChatMessage(this.chatId, sentMessage.message_id, {
        disable_notification: true,
      });

      logger.info(`[PinnedManager] Created and pinned message: ${sentMessage.message_id}`);
    } catch (err) {
      logger.error("[PinnedManager] Error creating pinned message:", err);
    }
  }

  /**
   * Update existing pinned message text
   */
  private async updatePinnedMessage(forceUpdate: boolean = false): Promise<void> {
    if (!getPinnedDashboardEnabled()) {
      if (this.onKeyboardUpdateCallback && this.state.tokensLimit > 0) {
        this.onKeyboardUpdateCallback(this.state.tokensUsed, this.state.tokensLimit);
      }
      return;
    }

    // Nothing to draw before the session is known (a restart whose values did not load yet).
    if (!this.api || !this.chatId || !this.state.messageId || !this.state.sessionId) {
      return;
    }

    this.pendingUpdate = true;
    if (forceUpdate) {
      this.pendingForceUpdate = true;
    }

    // A flush that already finished its loop would miss this update: wait, then flush again.
    while (this.updateTask) {
      await this.updateTask;
    }
    if (!this.pendingUpdate) {
      return;
    }

    this.updateTask = this.flushPendingPinnedUpdates().finally(() => {
      this.updateTask = null;
    });

    await this.updateTask;
  }

  private async flushPendingPinnedUpdates(): Promise<void> {
    while (this.pendingUpdate) {
      this.pendingUpdate = false;
      const shouldForceUpdate = this.pendingForceUpdate;
      this.pendingForceUpdate = false;

      if (!this.api || !this.chatId || !this.state.messageId) {
        return;
      }

      const text = this.formatMessage();

      if (!shouldForceUpdate && text === this.lastRenderedMessageText) {
        logger.debug("[PinnedManager] Skipping pinned update: message content unchanged");
        continue;
      }

      try {
        await this.api.editMessageText(this.chatId, this.state.messageId, text);
        this.state.lastUpdated = Date.now();
        this.lastRenderedMessageText = text;

        logger.debug(`[PinnedManager] Updated pinned message: ${this.state.messageId}`);

        // Trigger keyboard update callback
        if (this.onKeyboardUpdateCallback && this.state.tokensLimit > 0) {
          setImmediate(() => {
            this.onKeyboardUpdateCallback!(this.state.tokensUsed, this.state.tokensLimit);
          });
        }
      } catch (err: unknown) {
        const errorMessage =
          err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();

        // Handle "message is not modified" error silently
        if (errorMessage.includes("message is not modified")) {
          this.lastRenderedMessageText = text;
          continue;
        }

        // Handle "message to edit not found" - recreate
        if (errorMessage.includes("message to edit not found")) {
          logger.warn("[PinnedManager] Pinned message was deleted, recreating...");
          this.state.messageId = null;
          this.lastRenderedMessageText = null;
          this.pendingForceUpdate = false;
          clearPinnedMessageId();
          if (getPinnedDashboardEnabled()) {
            await this.createPinnedMessage();
          }
          continue;
        }

        logger.error("[PinnedManager] Error updating pinned message:", err);
      }
    }
  }

  /**
   * Unpin old message before creating new one
   */
  private async unpinOldMessage(): Promise<void> {
    if (!getPinnedDashboardEnabled()) {
      this.forgetOwnedDashboard();
      return;
    }

    if (!this.api || !this.chatId) {
      return;
    }

    try {
      // Unpin only the message this bot owns: Telegram rate-limits unpinAllChatMessages
      // hard, so it stalls every switch once a couple of them land close together.
      // No known dashboard means there is nothing to unpin.
      await this.unpinOwnedDashboard();

      logger.debug("[PinnedManager] Unpinned old messages");
    } catch (err) {
      logger.error("[PinnedManager] Error unpinning messages:", err);
    }
  }

  /**
   * Get current state (for debugging/status)
   */
  getState(): PinnedMessageState {
    return { ...this.state };
  }

  /**
   * Check if manager is initialized
   */
  isInitialized(): boolean {
    return this.api !== null && this.chatId !== null;
  }

  /**
   * Clear pinned message (when switching projects)
   */
  async clear(): Promise<void> {
    this.sessionGeneration++;
    this.prepared = null;

    if (!getPinnedDashboardEnabled()) {
      await this.dropOwnedDashboardQuietly();
    }

    const parkedLeftover = this.leftoverUnpinMessageId;
    const dropTarget = this.state.messageId ?? parkedLeftover;

    if (!this.api || !this.chatId) {
      this.resetClearedSessionState();
      this.leftoverUnpinMessageId = parkedLeftover;
      if (!parkedLeftover) {
        clearPinnedMessageId();
      }
      return;
    }

    try {
      if (getPinnedDashboardEnabled()) {
        // Specific unpin: unpinAllChatMessages is heavily rate-limited. A failed unpin is
        // parked for a later retry, and the reset below still runs.
        await this.dropOwnedDashboardQuietly();
      }

      this.resetClearedSessionState();
      // The drop unpins and forgets the dashboard it targeted; a parked message it did not
      // touch stays tracked, but one it just unpinned must not come back.
      this.leftoverUnpinMessageId =
        this.leftoverUnpinMessageId ?? (parkedLeftover !== dropTarget ? parkedLeftover : null);
      if (!this.leftoverUnpinMessageId) {
        clearPinnedMessageId();
      }

      logger.info("[PinnedManager] Cleared pinned message state");
    } catch (err) {
      logger.error("[PinnedManager] Error clearing pinned message:", err);
    }
  }

  private resetClearedSessionState(): void {
    this.state.messageId = null;
    this.state.sessionId = null;
    this.state.sessionTitle = t("pinned.default_session_title");
    this.state.attachActive = false;
    this.state.attachBusy = false;
    this.state.projectPath = "";
    this.state.projectBranch = null;
    this.state.projectWorktreePath = null;
    this.state.tokensUsed = 0;
    this.state.tokensLimit = 0;
    this.state.changedFiles = [];
    this.lastRenderedMessageText = null;
    this.pendingUpdate = false;
    this.pendingForceUpdate = false;
  }
}
