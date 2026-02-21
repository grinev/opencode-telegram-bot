import type { Api } from "grammy";
import { logger } from "../utils/logger.js";
import { opencodeClient } from "../opencode/client.js";
import { getCurrentSession } from "../session/manager.js";
import {
  getCurrentProject,
  getPinnedMessageId,
  setPinnedMessageId,
  clearPinnedMessageId,
} from "../settings/manager.js";
import { getStoredModel } from "../model/manager.js";
import type { FileChange, PinnedMessageState, TokensInfo } from "./types.js";
import { t } from "../i18n/index.js";

class PinnedMessageManager {
  private api: Api | null = null;
  private chatId: number | null = null;
  private state: PinnedMessageState = {
    messageId: null,
    chatId: null,
    sessionId: null,
    sessionTitle: t("pinned.default_session_title"),
    projectName: "",
    tokensUsed: 0,
    tokensLimit: 0,
    lastUpdated: 0,
    changedFiles: [],
  };
  private contextLimit: number | null = null;
  private onKeyboardUpdateCallback?: (tokensUsed: number, tokensLimit: number) => void;

  /**
   * Initialize manager with bot API and chat ID
   */
  initialize(api: Api, chatId: number): void {
    this.api = api;
    this.chatId = chatId;

    // Restore pinned message ID from settings
    const savedMessageId = getPinnedMessageId();
    if (savedMessageId) {
      this.state.messageId = savedMessageId;
      this.state.chatId = chatId;
    }
  }

  /**
   * Called when session changes - create new pinned message
   */
  async onSessionChange(sessionId: string, sessionTitle: string): Promise<void> {
    logger.info(`[PinnedManager] Session changed: ${sessionId}, title: ${sessionTitle}`);

    // Reset tokens for new session
    this.state.tokensUsed = 0;

    // Update state
    this.state.sessionId = sessionId;
    this.state.sessionTitle = sessionTitle || t("pinned.default_session_title");

    const project = getCurrentProject();
    this.state.projectName =
      project?.name || this.extractProjectName(project?.worktree) || t("pinned.unknown");

    // Fetch context limit for current model
    await this.fetchContextLimit();

    // Trigger keyboard update callback with reset context (0 tokens)
    if (this.onKeyboardUpdateCallback && this.state.tokensLimit > 0) {
      this.onKeyboardUpdateCallback(this.state.tokensUsed, this.state.tokensLimit);
    }

    // Reset changed files for new session
    this.state.changedFiles = [];

    // Unpin old message and create new one
    await this.unpinOldMessage();
    await this.createPinnedMessage();

    // Load existing diffs from API (for session restoration)
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

  /**
   * Load context token usage from session history
   */
  async loadContextFromHistory(sessionId: string, directory: string): Promise<void> {
    try {
      logger.debug(`[PinnedManager] Loading context from history for session: ${sessionId}`);

      const { data: messagesData, error } = await opencodeClient.session.messages({
        sessionID: sessionId,
        directory,
      });

      if (error || !messagesData) {
        logger.warn("[PinnedManager] Failed to load session history:", error);
        return;
      }

      // Get the maximum context size from session history
      // Context = input + cache.read (cache.read contains previously cached context)
      let maxContextSize = 0;
      logger.debug(`[PinnedManager] Processing ${messagesData.length} messages from history`);

      messagesData.forEach(({ info }) => {
        if (info.role === "assistant") {
          const assistantInfo = info as {
            summary?: boolean;
            tokens?: {
              input: number;
              cache?: { read: number };
            };
          };

          // Skip summary messages (technical, not real agent responses)
          if (assistantInfo.summary) {
            logger.debug(`[PinnedManager] Skipping summary message`);
            return;
          }

          const input = assistantInfo.tokens?.input || 0;
          const cacheRead = assistantInfo.tokens?.cache?.read || 0;
          const contextSize = input + cacheRead;

          logger.debug(
            `[PinnedManager] Assistant message: input=${input}, cache.read=${cacheRead}, total=${contextSize}`,
          );

          // Keep track of maximum context size (peak usage in session)
          if (contextSize > maxContextSize) {
            maxContextSize = contextSize;
          }
        }
      });

      this.state.tokensUsed = maxContextSize;
      this.state.sessionId = sessionId;

      logger.info(`[PinnedManager] Loaded context from history: ${this.state.tokensUsed} tokens`);

      await this.updatePinnedMessage();
    } catch (err) {
      logger.error("[PinnedManager] Error loading context from history:", err);
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
    // without a fresh onSessionChange call (for example after /stop + continue).
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
   * Set callback for keyboard updates when context changes
   */
  setOnKeyboardUpdate(callback: (tokensUsed: number, tokensLimit: number) => void): void {
    this.onKeyboardUpdateCallback = callback;
    logger.debug("[PinnedManager] Keyboard update callback registered");
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
    this.state.changedFiles = diffs;
    logger.debug(`[PinnedManager] Session diff updated: ${diffs.length} files`);
    await this.updatePinnedMessage();
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

  private updateDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  private scheduleDebouncedUpdate(): void {
    if (this.updateDebounceTimer) {
      clearTimeout(this.updateDebounceTimer);
    }
    this.updateDebounceTimer = setTimeout(() => {
      this.updateDebounceTimer = null;
      this.updatePinnedMessage();
    }, 500);
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

      logger.debug(`[PinnedManager] loadDiffsFromApi: trying session.diff() for ${sessionId}`);

      // Try session.diff() API first
      const { data, error } = await opencodeClient.session.diff({
        sessionID: sessionId,
        directory: project.worktree,
      });

      logger.debug(
        `[PinnedManager] session.diff() result: error=${!!error}, data.length=${data?.length ?? 0}`,
      );

      if (!error && data && data.length > 0) {
        this.state.changedFiles = data.map((d) => ({
          file: d.file,
          additions: d.additions,
          deletions: d.deletions,
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
      logger.debug("[PinnedManager] Could not load diffs from API:", err);
    }
  }

  /**
   * Fallback: extract file changes from session message tool parts
   */
  private async loadDiffsFromMessages(sessionId: string, directory: string): Promise<void> {
    try {
      logger.debug(`[PinnedManager] loadDiffsFromMessages: fetching messages for ${sessionId}`);

      const { data: messagesData, error } = await opencodeClient.session.messages({
        sessionID: sessionId,
        directory,
      });

      if (error || !messagesData) {
        logger.debug(`[PinnedManager] loadDiffsFromMessages: error or no data`);
        return;
      }

      logger.debug(`[PinnedManager] loadDiffsFromMessages: ${messagesData.length} messages`);

      const filesMap = new Map<string, FileChange>();

      let toolCount = 0;
      let fileToolCount = 0;

      for (const { parts } of messagesData) {
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

          if (
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
      logger.debug("[PinnedManager] Could not load diffs from messages:", err);
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
      const { data: sessionData } = await opencodeClient.session.get({
        sessionID: session.id,
        directory: project.worktree,
      });

      if (sessionData && sessionData.title !== this.state.sessionTitle) {
        this.state.sessionTitle = sessionData.title;
        logger.debug(`[PinnedManager] Session title refreshed: ${sessionData.title}`);
      }
    } catch (err) {
      logger.debug("[PinnedManager] Could not refresh session title:", err);
    }
  }

  /**
   * Extract project name from worktree path
   */
  private extractProjectName(worktree: string | undefined): string {
    if (!worktree) return "";
    // Get last part of path
    const parts = worktree.replace(/\\/g, "/").split("/");
    return parts[parts.length - 1] || "";
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

  /**
   * Fetch context limit from current model configuration
   */
  private async fetchContextLimit(): Promise<void> {
    try {
      const model = getStoredModel();
      if (!model.providerID || !model.modelID) {
        logger.warn("[PinnedManager] No model configured, using default limit");
        this.contextLimit = 200000;
        this.state.tokensLimit = this.contextLimit;
        return;
      }

      const { data: providersData, error } = await opencodeClient.config.providers();

      if (error || !providersData) {
        logger.warn("[PinnedManager] Failed to fetch providers, using default limit");
        this.contextLimit = 200000;
        this.state.tokensLimit = this.contextLimit;
        return;
      }

      // Find the model in providers
      for (const provider of providersData.providers) {
        if (provider.id === model.providerID) {
          const modelInfo = provider.models[model.modelID];
          if (modelInfo?.limit?.context) {
            this.contextLimit = modelInfo.limit.context;
            this.state.tokensLimit = this.contextLimit;
            logger.debug(`[PinnedManager] Context limit: ${this.contextLimit}`);
            return;
          }
        }
      }

      logger.warn("[PinnedManager] Model not found in providers, using default limit");
      this.contextLimit = 200000;
      this.state.tokensLimit = this.contextLimit;
    } catch (err) {
      logger.error("[PinnedManager] Error fetching context limit:", err);
      this.contextLimit = 200000;
      this.state.tokensLimit = this.contextLimit;
    }
  }

  /**
   * Format the pinned message text
   */
  private formatMessage(): string {
    const percentage =
      this.state.tokensLimit > 0
        ? Math.round((this.state.tokensUsed / this.state.tokensLimit) * 100)
        : 0;

    const tokensFormatted = this.formatTokenCount(this.state.tokensUsed);
    const limitFormatted = this.formatTokenCount(this.state.tokensLimit);

    // Get current model info
    const currentModel = getStoredModel();
    const modelName =
      currentModel.providerID && currentModel.modelID
        ? `${currentModel.providerID}/${currentModel.modelID}`
        : t("pinned.unknown");

    const lines = [
      `${this.state.sessionTitle}`,
      t("pinned.line.project", { project: this.state.projectName }),
      t("pinned.line.model", { model: modelName }),
      t("pinned.line.context", {
        used: tokensFormatted,
        limit: limitFormatted,
        percent: percentage,
      }),
    ];

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

  /**
   * Format token count (e.g., 150000 -> "150K")
   */
  private formatTokenCount(count: number): string {
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(1)}M`;
    } else if (count >= 1000) {
      return `${Math.round(count / 1000)}K`;
    }
    return count.toString();
  }

  /**
   * Create and pin a new status message
   */
  private async createPinnedMessage(): Promise<void> {
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
  private async updatePinnedMessage(): Promise<void> {
    if (!this.api || !this.chatId || !this.state.messageId) {
      return;
    }

    try {
      const text = this.formatMessage();

      await this.api.editMessageText(this.chatId, this.state.messageId, text);
      this.state.lastUpdated = Date.now();

      logger.debug(`[PinnedManager] Updated pinned message: ${this.state.messageId}`);

      // Trigger keyboard update callback
      if (this.onKeyboardUpdateCallback && this.state.tokensLimit > 0) {
        setImmediate(() => {
          this.onKeyboardUpdateCallback!(this.state.tokensUsed, this.state.tokensLimit);
        });
      }
    } catch (err: unknown) {
      // Handle "message is not modified" error silently
      if (err instanceof Error && err.message.includes("message is not modified")) {
        return;
      }

      // Handle "message to edit not found" - recreate
      if (err instanceof Error && err.message.includes("message to edit not found")) {
        logger.warn("[PinnedManager] Pinned message was deleted, recreating...");
        this.state.messageId = null;
        clearPinnedMessageId();
        await this.createPinnedMessage();
        return;
      }

      logger.error("[PinnedManager] Error updating pinned message:", err);
    }
  }

  /**
   * Unpin old message before creating new one
   */
  private async unpinOldMessage(): Promise<void> {
    if (!this.api || !this.chatId) {
      return;
    }

    try {
      // Unpin all messages (ensures clean state)
      await this.api.unpinAllChatMessages(this.chatId).catch(() => {});

      this.state.messageId = null;
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
    if (!this.api || !this.chatId) {
      // Just reset state if not initialized
      this.state.messageId = null;
      this.state.sessionId = null;
      this.state.tokensUsed = 0;
      this.state.tokensLimit = 0;
      this.state.changedFiles = [];
      clearPinnedMessageId();
      return;
    }

    try {
      // Unpin all messages
      await this.api.unpinAllChatMessages(this.chatId).catch(() => {});

      // Reset state
      this.state.messageId = null;
      this.state.sessionId = null;
      this.state.sessionTitle = t("pinned.default_session_title");
      this.state.projectName = "";
      this.state.tokensUsed = 0;
      this.state.tokensLimit = 0;
      this.state.changedFiles = [];
      clearPinnedMessageId();

      logger.info("[PinnedManager] Cleared pinned message state");
    } catch (err) {
      logger.error("[PinnedManager] Error clearing pinned message:", err);
    }
  }
}

export const pinnedMessageManager = new PinnedMessageManager();
