import type { Api } from "grammy";
import { logger } from "../../utils/logger.js";
import { directApi, opencodeV2 } from "../../opencode/client.js";
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
} from "../../app/services/model-context-limit-service.js";
import { getStoredModel } from "../../app/services/model-selection-service.js";
import { isExpectedOpencodeUnavailableError } from "../../utils/opencode-error.js";
import type { FileChange, PinnedMessageState, TokensInfo } from "./pinned-message-types.js";
import { t } from "../../i18n/index.js";
import {
  formatContextLine,
  formatCostLine,
  formatModelDisplayName,
} from "./pinned-message-format.js";
import { getSessionStreamThrottleMs } from "../streaming/stream-throttle.js";

class PinnedMessageManager {
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
   * Called when session changes - create new pinned message
   */
  async onSessionChange(sessionId: string, sessionTitle: string): Promise<void> {
    logger.info(`[PinnedManager] Session changed: ${sessionId}, title: ${sessionTitle}`);

    if (!getPinnedDashboardEnabled()) {
      await this.dropOwnedDashboardQuietly();
    }

    // Reset tokens for new session
    this.state.tokensUsed = 0;
    this.state.cost = 0;

    // Update state
    this.state.sessionId = sessionId;
    this.state.sessionTitle = sessionTitle || t("pinned.default_session_title");
    this.state.attachActive = false;
    this.state.attachBusy = false;

    await this.refreshProjectMetadata();

    // Fetch context limit for current model
    await this.fetchContextLimit();

    // Trigger keyboard update callback with reset context (0 tokens)
    if (this.onKeyboardUpdateCallback && this.state.tokensLimit > 0) {
      this.onKeyboardUpdateCallback(this.state.tokensUsed, this.state.tokensLimit);
    }

    // Reset changed files for new session
    this.state.changedFiles = [];
    this.lastRenderedMessageText = null;
    this.pendingUpdate = false;
    this.pendingForceUpdate = false;

    if (getPinnedDashboardEnabled()) {
      await this.unpinOldMessage();
      await this.createPinnedMessage();
    }

    await this.loadDiffsFromApi(sessionId);
  }

  /**
   * Restore in-memory state for a persisted pinned message without creating a new Telegram message.
   */
  async restoreExistingSession(sessionId: string, sessionTitle: string): Promise<void> {
    logger.info(`[PinnedManager] Restoring existing pinned message for session: ${sessionId}`);

    if (!getPinnedDashboardEnabled()) {
      await this.dropOwnedDashboardQuietly();
    }

    this.state.sessionId = sessionId;
    this.state.sessionTitle = sessionTitle || t("pinned.default_session_title");
    this.state.attachActive = false;
    this.state.attachBusy = false;
    this.state.changedFiles = [];
    this.lastRenderedMessageText = null;
    this.pendingUpdate = false;
    this.pendingForceUpdate = false;

    await this.refreshProjectMetadata();
    await this.fetchContextLimit();

    if (this.onKeyboardUpdateCallback && this.state.tokensLimit > 0) {
      this.onKeyboardUpdateCallback(this.state.tokensUsed, this.state.tokensLimit);
    }

    if (getPinnedDashboardEnabled()) {
      await this.updatePinnedMessage(true);
    }
    await this.loadDiffsFromApi(sessionId);
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
   * Load context token usage from the latest assistant message.
   * The session record's tokens are cumulative (summed over every turn), so the
   * current context size must be read from the most recent assistant message's
   * per-message totals instead (input + cache.read).
   */
  async loadContextFromHistory(sessionId: string, _directory: string): Promise<void> {
    try {
      logger.debug(`[PinnedManager] Loading context from history for session: ${sessionId}`);

      const { data: messagesBody, error } = await opencodeV2.session.messages({
        sessionID: sessionId,
      });

      if (error || !messagesBody) {
        if (isExpectedOpencodeUnavailableError(error)) {
          logger.warn("[PinnedManager] OpenCode server unavailable; skipping session history load");
        } else {
          logger.warn("[PinnedManager] Failed to load session history:", error);
        }
        return;
      }

      // Latest measured context size + total session cost from the history.
      let latestContextSize = 0;
      let latestContextCreated = Number.NEGATIVE_INFINITY;
      let totalCost = 0;

      for (const message of messagesBody.data) {
        if (message.type !== "assistant") {
          continue;
        }
        const tokens = message.tokens;
        if (!tokens) {
          continue;
        }
        const input = tokens.input || 0;
        const cacheRead = tokens.cache?.read || 0;
        const contextSize = input + cacheRead;
        const cost = message.cost || 0;
        const created = message.time?.created ?? 0;

        if (contextSize > 0 && created >= latestContextCreated) {
          latestContextSize = contextSize;
          latestContextCreated = created;
        }

        totalCost += cost;
      }

      this.state.tokensUsed = latestContextSize;
      this.state.cost = totalCost;
      this.state.sessionId = sessionId;

      logger.info(
        `[PinnedManager] Loaded context from history: ${this.state.tokensUsed} tokens, cost: $${this.state.cost.toFixed(2)}`,
      );

      await this.updatePinnedMessage();
    } catch (err) {
      if (isExpectedOpencodeUnavailableError(err)) {
        logger.warn("[PinnedManager] OpenCode server unavailable; skipping session history load");
      } else {
        logger.error("[PinnedManager] Error loading context from history:", err);
      }
    }
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
    // Ensure context limit is available even if session was restored
    // without a fresh onSessionChange call (for example after /abort + continue).
    if (this.getContextLimit() === 0) {
      await this.fetchContextLimit();
    }

    // Context = input + cache.read (cache.read contains previously cached context)
    // This represents the actual context window usage
    this.state.tokensUsed = tokens.input + tokens.cacheRead;

    logger.debug(
      `[PinnedManager] Tokens updated: ${this.state.tokensUsed}/${this.state.tokensLimit}`,
    );

    // Also fetch latest session title (it may have changed after first message)
    await this.refreshSessionTitle();

    await this.updatePinnedMessage();
  }

  /**
   * Update tokens in memory without triggering an API call.
   * Used for intermediate (non-completed) message.updated events
   * to keep pinned state in sync with keyboardManager.
   */
  updateTokensSilent(tokens: TokensInfo): void {
    this.state.tokensUsed = tokens.input + tokens.cacheRead;
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
    logger.debug(
      `[PinnedManager] Cost added: $${cost.toFixed(2)}, total session: $${(this.state.cost || 0).toFixed(2)}`,
    );
    await this.updatePinnedMessage();
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
      void this.updatePinnedMessage();
    }, delayMs);
  }

  /**
   * Load file diffs from API for current session.
   * Tries session.diff() first, falls back to parsing session.messages() tool parts.
   */
  private async loadDiffsFromApi(sessionId: string): Promise<void> {
    try {
      const project = getCurrentProject();
      if (!project) {
        logger.debug("[PinnedManager] loadDiffsFromApi: no project");
        return;
      }

      logger.debug(`[PinnedManager] loadDiffsFromApi: trying session diff for ${sessionId}`);

      // Try session diff API first (v2: GET /api/session/{id}/diff)
      const { data, error } = await directApi<Array<{ file?: string; additions?: number; deletions?: number }>>(
        "GET",
        `/api/session/${sessionId}/diff`,
      );

      logger.debug(
        `[PinnedManager] session diff result: error=${!!error}, data.length=${data?.length ?? 0}`,
      );

      if (!error && data && data.length > 0) {
        this.state.changedFiles = data
          .filter((d): d is typeof d & { file: string } => !!d.file)
          .map((d) => ({
            file: d.file,
            additions: d.additions ?? 0,
            deletions: d.deletions ?? 0,
          }));
        logger.info(
          `[PinnedManager] Loaded ${this.state.changedFiles.length} file diffs from session.diff()`,
        );
        await this.updatePinnedMessage();
        return;
      }

      // Fallback: parse tool parts from session messages
      logger.debug("[PinnedManager] session.diff() empty, trying loadDiffsFromMessages()");
      await this.loadDiffsFromMessages(sessionId, project.worktree);
    } catch (err) {
      if (isExpectedOpencodeUnavailableError(err)) {
        logger.debug("[PinnedManager] OpenCode server unavailable; skipping diff restore");
      } else {
        logger.debug("[PinnedManager] Could not load diffs from API:", err);
      }
    }
  }

  /**
   * Fallback: extract file changes from session message tool parts
   */
  private async loadDiffsFromMessages(sessionId: string, _directory: string): Promise<void> {
    try {
      logger.debug(`[PinnedManager] loadDiffsFromMessages: fetching messages for ${sessionId}`);

      const { data: messagesBody, error } = await opencodeV2.session.messages({
        sessionID: sessionId,
      });

      if (error || !messagesBody) {
        if (isExpectedOpencodeUnavailableError(error)) {
          logger.debug("[PinnedManager] OpenCode server unavailable; skipping diff message restore");
        } else {
          logger.debug(`[PinnedManager] loadDiffsFromMessages: error or no data`);
        }
        return;
      }

      const messagesData = messagesBody.data;
      logger.debug(`[PinnedManager] loadDiffsFromMessages: ${messagesData.length} messages`);

      const filesMap = new Map<string, FileChange>();

      let toolCount = 0;
      let fileToolCount = 0;

      // v2 assistant content carries tool calls as {type:"tool", name, state:{status,input,outputPaths?}}
      for (const message of messagesData) {
        if (message.type !== "assistant") {
          continue;
        }
        for (const part of message.content) {
          if (part.type !== "tool") {
            continue;
          }
          toolCount++;

          const toolName = part.name;
          const state = part.state;
          if (state.status !== "completed") {
            continue;
          }

          if (toolName === "edit" || toolName === "write" || toolName === "patch") {
            fileToolCount++;
          }

          const paths = new Set<string>();
          for (const outputPath of state.outputPaths ?? []) {
            paths.add(outputPath);
          }
          if (toolName === "write") {
            const filePath = (state.input as { filePath?: unknown }).filePath;
            if (typeof filePath === "string" && filePath.length > 0) {
              paths.add(filePath);
            }
          }

          for (const file of paths) {
            if (!filesMap.has(file)) {
              filesMap.set(file, { file, additions: 0, deletions: 0 });
            }
          }
        }
      }

      logger.debug(
        `[PinnedManager] loadDiffsFromMessages: found ${toolCount} tool parts, ${fileToolCount} file tools`,
      );

      if (filesMap.size > 0) {
        this.state.changedFiles = Array.from(filesMap.values());
        logger.info(
          `[PinnedManager] Loaded ${this.state.changedFiles.length} file diffs from messages`,
        );
        await this.updatePinnedMessage();
      } else {
        logger.debug("[PinnedManager] loadDiffsFromMessages: no file changes found");
      }
    } catch (err) {
      if (isExpectedOpencodeUnavailableError(err)) {
        logger.debug("[PinnedManager] OpenCode server unavailable; skipping diff message restore");
      } else {
        logger.debug("[PinnedManager] Could not load diffs from messages:", err);
      }
    }
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
      const { data: sessionBody } = await opencodeV2.session.get({
        sessionID: session.id,
      });

      if (sessionBody && sessionBody.data.title !== this.state.sessionTitle) {
        this.state.sessionTitle = sessionBody.data.title;
        logger.debug(`[PinnedManager] Session title refreshed: ${sessionBody.data.title}`);
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
      await this.unpinMessageOrThrow(this.leftoverUnpinMessageId);
      this.forgetOwnedDashboard();
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
    const messageId = this.state.messageId ?? this.leftoverUnpinMessageId;
    if (!messageId) {
      return;
    }

    if (!this.api || !this.chatId) {
      this.forgetOwnedDashboard();
      return;
    }

    await this.unpinMessageOrThrow(messageId);
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
      this.parkLeftoverDashboard(messageId);
      return;
    }

    try {
      await this.api.unpinChatMessage(this.chatId, messageId);
    } catch (err) {
      if (!this.isMessageMissingError(err)) {
        logger.warn("[PinnedManager] Could not unpin leftover dashboard:", err);
        this.parkLeftoverDashboard(messageId);
        return;
      }
    }

    this.forgetOwnedDashboard();
  }

  private parkLeftoverDashboard(messageId: number): void {
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

    if (!this.api || !this.chatId || !this.state.messageId) {
      return;
    }

    this.pendingUpdate = true;
    if (forceUpdate) {
      this.pendingForceUpdate = true;
    }

    if (this.updateTask) {
      await this.updateTask;
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
      // Unpin all messages (ensures clean state)
      await this.api.unpinAllChatMessages(this.chatId).catch(() => {});

      this.state.messageId = null;
      this.lastRenderedMessageText = null;
      this.pendingUpdate = false;
      this.pendingForceUpdate = false;
      clearPinnedMessageId();

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
    if (!getPinnedDashboardEnabled()) {
      await this.dropOwnedDashboardQuietly();
    }

    const parkedLeftover = this.leftoverUnpinMessageId;

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
        await this.api.unpinAllChatMessages(this.chatId).catch(() => {});
      }

      this.resetClearedSessionState();
      this.leftoverUnpinMessageId = parkedLeftover;
      if (!parkedLeftover) {
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

  __resetForTests(): void {
    if (this.updateDebounceTimer) {
      clearTimeout(this.updateDebounceTimer);
    }

    this.api = null;
    this.chatId = null;
    this.contextLimit = null;
    this.onKeyboardUpdateCallback = undefined;
    this.updateDebounceTimer = null;
    this.updateTask = null;
    this.pendingUpdate = false;
    this.pendingForceUpdate = false;
    this.lastRenderedMessageText = null;
    this.leftoverUnpinMessageId = null;
    this.state = {
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
  }
}

export const pinnedMessageManager = new PinnedMessageManager();
