import type { Api } from "grammy";
import { logger } from "../utils/logger.js";
import { opencodeClient } from "../opencode/client.js";
import {
  getScopedPinnedMessageId,
  setScopedPinnedMessageId,
  clearScopedPinnedMessageId,
  getCurrentProject,
} from "../settings/manager.js";
import { getStoredModel } from "../model/manager.js";
import type { FileChange, PinnedMessageState, TokensInfo } from "./types.js";
import { t } from "../i18n/index.js";
import { getThreadIdFromScopeKey, getThreadSendOptions } from "../bot/scope.js";

interface ScopeContext {
  api: Api | null;
  chatId: number | null;
  state: PinnedMessageState;
  contextLimit: number | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
}

class PinnedMessageManager {
  private contexts = new Map<string, ScopeContext>();
  private onKeyboardUpdateCallback?: (
    tokensUsed: number,
    tokensLimit: number,
    scopeKey: string,
  ) => void;

  private createDefaultState(scopeKey: string): PinnedMessageState {
    return {
      scopeKey,
      messageId: null,
      chatId: null,
      threadId: null,
      sessionId: null,
      sessionTitle: t("pinned.default_session_title"),
      projectName: "",
      tokensUsed: 0,
      tokensLimit: 0,
      lastUpdated: 0,
      changedFiles: [],
    };
  }

  private getContext(scopeKey: string): ScopeContext {
    const existing = this.contexts.get(scopeKey);
    if (existing) {
      return existing;
    }

    const savedId = getScopedPinnedMessageId(scopeKey);
    const context: ScopeContext = {
      api: null,
      chatId: null,
      state: {
        ...this.createDefaultState(scopeKey),
        messageId: savedId ?? null,
      },
      contextLimit: null,
      debounceTimer: null,
    };
    this.contexts.set(scopeKey, context);
    return context;
  }

  initialize(
    api: Api,
    chatId: number,
    scopeKey: string = "global",
    threadId: number | null = null,
  ): void {
    const context = this.getContext(scopeKey);
    const scopeThreadId = getThreadIdFromScopeKey(scopeKey);
    const resolvedThreadId = threadId ?? scopeThreadId ?? context.state.threadId;
    context.api = api;
    context.chatId = chatId;
    context.state.chatId = chatId;
    context.state.threadId = resolvedThreadId;
  }

  private persistPinnedId(scopeKey: string, messageId: number): void {
    setScopedPinnedMessageId(scopeKey, messageId);
  }

  private clearPersistedPinnedId(scopeKey: string): void {
    clearScopedPinnedMessageId(scopeKey);
  }

  async onSessionChange(
    sessionId: string,
    sessionTitle: string,
    scopeKey: string = "global",
  ): Promise<void> {
    const context = this.getContext(scopeKey);
    const state = context.state;
    state.tokensUsed = 0;
    state.sessionId = sessionId;
    state.sessionTitle = sessionTitle || t("pinned.default_session_title");

    const project = getCurrentProject(scopeKey);
    state.projectName =
      project?.name || this.extractProjectName(project?.worktree) || t("pinned.unknown");

    await this.fetchContextLimit(scopeKey);

    if (this.onKeyboardUpdateCallback && state.tokensLimit > 0) {
      this.onKeyboardUpdateCallback(state.tokensUsed, state.tokensLimit, scopeKey);
    }

    state.changedFiles = [];
    await this.unpinOldMessage(scopeKey);
    await this.createPinnedMessage(scopeKey);
    await this.loadDiffsFromApi(sessionId, scopeKey);
  }

  async onSessionTitleUpdate(newTitle: string, scopeKey: string = "global"): Promise<void> {
    const state = this.getContext(scopeKey).state;
    if (state.sessionTitle !== newTitle && newTitle) {
      state.sessionTitle = newTitle;
      await this.updatePinnedMessage(scopeKey);
    }
  }

  async loadContextFromHistory(
    sessionId: string,
    directory: string,
    scopeKey: string = "global",
  ): Promise<void> {
    const context = this.getContext(scopeKey);
    try {
      const { data: messagesData, error } = await opencodeClient.session.messages({
        sessionID: sessionId,
        directory,
      });
      if (error || !messagesData) {
        return;
      }

      let maxContextSize = 0;
      messagesData.forEach(({ info }) => {
        if (info.role !== "assistant") {
          return;
        }

        const assistantInfo = info as {
          summary?: boolean;
          tokens?: { input: number; cache?: { read: number } };
        };
        if (assistantInfo.summary) {
          return;
        }

        const contextSize =
          (assistantInfo.tokens?.input || 0) + (assistantInfo.tokens?.cache?.read || 0);
        if (contextSize > maxContextSize) {
          maxContextSize = contextSize;
        }
      });

      context.state.tokensUsed = maxContextSize;
      context.state.sessionId = sessionId;
      await this.updatePinnedMessage(scopeKey);
    } catch (err) {
      logger.error("[PinnedManager] Error loading context from history:", err);
    }
  }

  async onSessionCompacted(
    sessionId: string,
    directory: string,
    scopeKey: string = "global",
  ): Promise<void> {
    await this.loadContextFromHistory(sessionId, directory, scopeKey);
  }

  async onMessageComplete(tokens: TokensInfo, scopeKey: string = "global"): Promise<void> {
    if (this.getContextLimit(scopeKey) === 0) {
      await this.fetchContextLimit(scopeKey);
    }

    const context = this.getContext(scopeKey);
    context.state.tokensUsed = tokens.input + tokens.cacheRead;
    await this.refreshSessionTitle(scopeKey);
    this.scheduleDebouncedUpdate(scopeKey, 1200);
  }

  setOnKeyboardUpdate(
    callback: (tokensUsed: number, tokensLimit: number, scopeKey: string) => void,
  ): void {
    this.onKeyboardUpdateCallback = callback;
  }

  getContextInfo(scopeKey: string = "global"): { tokensUsed: number; tokensLimit: number } | null {
    const context = this.getContext(scopeKey);
    const limit =
      context.state.tokensLimit > 0 ? context.state.tokensLimit : context.contextLimit || 0;
    if (limit === 0) {
      return null;
    }

    return { tokensUsed: context.state.tokensUsed, tokensLimit: limit };
  }

  getContextLimit(scopeKey: string = "global"): number {
    const context = this.getContext(scopeKey);
    return context.contextLimit || context.state.tokensLimit || 0;
  }

  async refreshContextLimit(scopeKey: string = "global"): Promise<void> {
    await this.fetchContextLimit(scopeKey);
  }

  async onSessionDiff(diffs: FileChange[], scopeKey: string = "global"): Promise<void> {
    const context = this.getContext(scopeKey);
    if (diffs.length === 0 && context.state.changedFiles.length > 0) {
      return;
    }

    context.state.changedFiles = diffs;
    this.scheduleDebouncedUpdate(scopeKey, 1200);
  }

  addFileChange(change: FileChange, scopeKey: string = "global"): void {
    const context = this.getContext(scopeKey);
    const existing = context.state.changedFiles.find((f) => f.file === change.file);
    if (existing) {
      existing.additions += change.additions;
      existing.deletions += change.deletions;
    } else {
      context.state.changedFiles.push(change);
    }

    this.scheduleDebouncedUpdate(scopeKey);
  }

  private scheduleDebouncedUpdate(scopeKey: string, delayMs: number = 1500): void {
    const context = this.getContext(scopeKey);
    if (context.debounceTimer) {
      clearTimeout(context.debounceTimer);
    }

    context.debounceTimer = setTimeout(() => {
      context.debounceTimer = null;
      void this.updatePinnedMessage(scopeKey);
    }, delayMs);
  }

  private async loadDiffsFromApi(sessionId: string, scopeKey: string): Promise<void> {
    try {
      const project = getCurrentProject(scopeKey);
      if (!project) {
        return;
      }

      const { data, error } = await opencodeClient.session.diff({
        sessionID: sessionId,
        directory: project.worktree,
      });
      const context = this.getContext(scopeKey);

      if (!error && data && data.length > 0) {
        context.state.changedFiles = data.map((d) => ({
          file: d.file,
          additions: d.additions,
          deletions: d.deletions,
        }));
        await this.updatePinnedMessage(scopeKey);
      }
    } catch (err) {
      logger.debug("[PinnedManager] Could not load diffs from API:", err);
    }
  }

  private async refreshSessionTitle(scopeKey: string): Promise<void> {
    const context = this.getContext(scopeKey);
    const sessionId = context.state.sessionId;
    const project = getCurrentProject(scopeKey);
    if (!sessionId || !project) {
      return;
    }

    try {
      const { data: sessionData } = await opencodeClient.session.get({
        sessionID: sessionId,
        directory: project.worktree,
      });

      if (sessionData && sessionData.title !== context.state.sessionTitle) {
        context.state.sessionTitle = sessionData.title;
      }
    } catch {
      // Ignore refresh failures.
    }
  }

  private extractProjectName(worktree: string | undefined): string {
    if (!worktree) {
      return "";
    }

    const parts = worktree.replace(/\\/g, "/").split("/");
    return parts[parts.length - 1] || "";
  }

  private makeRelativePath(filePath: string, scopeKey: string): string {
    const normalized = filePath.replace(/\\/g, "/");
    const project = getCurrentProject(scopeKey);
    if (!project?.worktree) {
      return normalized;
    }

    const worktree = project.worktree.replace(/\\/g, "/");
    if (normalized.startsWith(worktree)) {
      let relative = normalized.slice(worktree.length);
      if (relative.startsWith("/")) {
        relative = relative.slice(1);
      }
      return relative || normalized;
    }

    const segments = normalized.split("/");
    if (segments.length <= 3) {
      return normalized;
    }

    return ".../" + segments.slice(-3).join("/");
  }

  private async fetchContextLimit(scopeKey: string): Promise<void> {
    const context = this.getContext(scopeKey);
    try {
      const model = getStoredModel(scopeKey);
      if (!model.providerID || !model.modelID) {
        context.contextLimit = 200000;
        context.state.tokensLimit = context.contextLimit;
        return;
      }

      const { data: providersData, error } = await opencodeClient.config.providers();
      if (error || !providersData) {
        context.contextLimit = 200000;
        context.state.tokensLimit = context.contextLimit;
        return;
      }

      for (const provider of providersData.providers) {
        if (provider.id !== model.providerID) {
          continue;
        }

        const modelInfo = provider.models[model.modelID];
        if (modelInfo?.limit?.context) {
          context.contextLimit = modelInfo.limit.context;
          context.state.tokensLimit = context.contextLimit;
          return;
        }
      }

      context.contextLimit = 200000;
      context.state.tokensLimit = context.contextLimit;
    } catch {
      context.contextLimit = 200000;
      context.state.tokensLimit = context.contextLimit;
    }
  }

  private formatTokenCount(count: number): string {
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(1)}M`;
    }

    if (count >= 1000) {
      return `${Math.round(count / 1000)}K`;
    }

    return count.toString();
  }

  private formatMessage(scopeKey: string): string {
    const context = this.getContext(scopeKey);
    const state = context.state;
    const percentage =
      state.tokensLimit > 0 ? Math.round((state.tokensUsed / state.tokensLimit) * 100) : 0;
    const currentModel = getStoredModel(scopeKey);
    const modelName =
      currentModel.providerID && currentModel.modelID
        ? `${currentModel.providerID}/${currentModel.modelID}`
        : t("pinned.unknown");

    const lines = [
      `${state.sessionTitle}`,
      t("pinned.line.project", { project: state.projectName }),
      t("pinned.line.model", { model: modelName }),
      t("pinned.line.context", {
        used: this.formatTokenCount(state.tokensUsed),
        limit: this.formatTokenCount(state.tokensLimit),
        percent: percentage,
      }),
    ];

    if (state.changedFiles.length > 0) {
      const maxFiles = 10;
      const filesToShow = state.changedFiles.slice(0, maxFiles);
      lines.push("");
      lines.push(t("pinned.files.title", { count: state.changedFiles.length }));

      for (const fileChange of filesToShow) {
        const parts: string[] = [];
        if (fileChange.additions > 0) parts.push(`+${fileChange.additions}`);
        if (fileChange.deletions > 0) parts.push(`-${fileChange.deletions}`);
        const diff = parts.length > 0 ? ` (${parts.join(" ")})` : "";
        lines.push(
          t("pinned.files.item", { path: this.makeRelativePath(fileChange.file, scopeKey), diff }),
        );
      }

      if (state.changedFiles.length > maxFiles) {
        lines.push(t("pinned.files.more", { count: state.changedFiles.length - maxFiles }));
      }
    }

    return lines.join("\n");
  }

  private async createPinnedMessage(scopeKey: string): Promise<void> {
    const context = this.getContext(scopeKey);
    if (!context.api || !context.chatId) {
      return;
    }

    const threadId = context.state.threadId ?? getThreadIdFromScopeKey(scopeKey);

    const sent = await context.api.sendMessage(context.chatId, this.formatMessage(scopeKey), {
      ...getThreadSendOptions(threadId),
    });

    context.state.messageId = sent.message_id;
    context.state.lastUpdated = Date.now();
    this.persistPinnedId(scopeKey, sent.message_id);

    await context.api.pinChatMessage(context.chatId, sent.message_id, {
      disable_notification: true,
    });
  }

  private async updatePinnedMessage(scopeKey: string): Promise<void> {
    const context = this.getContext(scopeKey);
    if (!context.api || !context.chatId || !context.state.messageId) {
      return;
    }

    try {
      await context.api.editMessageText(
        context.chatId,
        context.state.messageId,
        this.formatMessage(scopeKey),
      );
      context.state.lastUpdated = Date.now();

      if (this.onKeyboardUpdateCallback && context.state.tokensLimit > 0) {
        this.onKeyboardUpdateCallback(
          context.state.tokensUsed,
          context.state.tokensLimit,
          scopeKey,
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("message is not modified")) {
        return;
      }

      if (err instanceof Error && err.message.includes("message to edit not found")) {
        context.state.messageId = null;
        this.clearPersistedPinnedId(scopeKey);
        await this.createPinnedMessage(scopeKey);
        return;
      }

      logger.error("[PinnedManager] Error updating pinned message:", err);
    }
  }

  private async unpinOldMessage(scopeKey: string): Promise<void> {
    const context = this.getContext(scopeKey);
    if (!context.api || !context.chatId) {
      return;
    }

    try {
      if (context.state.messageId) {
        await context.api.unpinChatMessage(context.chatId, context.state.messageId).catch(() => {});
      }
    } finally {
      context.state.messageId = null;
      this.clearPersistedPinnedId(scopeKey);
    }
  }

  getState(scopeKey: string = "global"): PinnedMessageState {
    return { ...this.getContext(scopeKey).state };
  }

  isInitialized(scopeKey: string = "global"): boolean {
    const context = this.contexts.get(scopeKey);
    return Boolean(context?.api && context?.chatId);
  }

  async clear(scopeKey: string = "global"): Promise<void> {
    const context = this.getContext(scopeKey);
    if (context.api && context.chatId && context.state.messageId) {
      await context.api.unpinChatMessage(context.chatId, context.state.messageId).catch(() => {});
      await context.api.deleteMessage(context.chatId, context.state.messageId).catch(() => {});
    }

    if (context.debounceTimer) {
      clearTimeout(context.debounceTimer);
      context.debounceTimer = null;
    }

    context.state = this.createDefaultState(scopeKey);
    this.clearPersistedPinnedId(scopeKey);
  }
}

export const pinnedMessageManager = new PinnedMessageManager();
