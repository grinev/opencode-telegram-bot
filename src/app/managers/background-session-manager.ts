import type { Event, Message, Session } from "@opencode-ai/sdk/v2";
import { isScheduledTaskSessionIgnored } from "../services/scheduled-task-session-ignore-service.js";
import { getCurrentSession } from "../stores/settings-store.js";
import { logger } from "../../utils/logger.js";

export type BackgroundSessionNotificationKind =
  "assistant_response" | "question_asked" | "permission_asked";

export interface BackgroundSessionNotification {
  kind: BackgroundSessionNotificationKind;
  sessionId: string;
  sessionTitle?: string | undefined;
  sessionDirectory?: string | undefined;
  requestId?: string | undefined;
  messageId?: string | undefined;
}

type NotificationCallback = (notification: BackgroundSessionNotification) => void | Promise<void>;

interface PendingAssistantResponse {
  messageId: string;
}

/** Everything a project switch wipes, taken so a failed open can put it back. */
export interface BackgroundSessionTrackerSnapshot {
  directory: string | null;
  sessionTitles: ReadonlyMap<string, string>;
  sessionDirectories: ReadonlyMap<string, string>;
  childSessionIds: ReadonlySet<string>;
  completedAssistantMessageIds: ReadonlySet<string>;
  pendingAssistantResponsesBySessionId: ReadonlyMap<string, PendingAssistantResponse>;
  questionRequestIds: ReadonlySet<string>;
  permissionRequestIds: ReadonlySet<string>;
}

class BackgroundSessionTracker {
  private directory: string | null = null;
  private onNotification: NotificationCallback | null = null;
  private sessionTitles = new Map<string, string>();
  private sessionDirectories = new Map<string, string>();
  private childSessionIds = new Set<string>();
  private completedAssistantMessageIds = new Set<string>();
  private pendingAssistantResponsesBySessionId = new Map<string, PendingAssistantResponse>();
  private questionRequestIds = new Set<string>();
  private permissionRequestIds = new Set<string>();

  setDirectory(directory: string): void {
    if (this.directory === directory) {
      return;
    }

    this.clear();
    this.directory = directory;
  }

  snapshot(): BackgroundSessionTrackerSnapshot {
    return {
      directory: this.directory,
      sessionTitles: new Map(this.sessionTitles),
      sessionDirectories: new Map(this.sessionDirectories),
      childSessionIds: new Set(this.childSessionIds),
      completedAssistantMessageIds: new Set(this.completedAssistantMessageIds),
      pendingAssistantResponsesBySessionId: new Map(this.pendingAssistantResponsesBySessionId),
      questionRequestIds: new Set(this.questionRequestIds),
      permissionRequestIds: new Set(this.permissionRequestIds),
    };
  }

  /** Puts back a snapshot taken in the current directory; one from another project is dropped. */
  restore(state: BackgroundSessionTrackerSnapshot): void {
    if (state.directory !== this.directory) {
      logger.warn(
        `[BackgroundSessionTracker] Skipped a snapshot taken for ${state.directory ?? "no directory"} while tracking ${this.directory ?? "none"}`,
      );
      return;
    }

    this.sessionTitles = new Map(state.sessionTitles);
    this.sessionDirectories = new Map(state.sessionDirectories);
    this.childSessionIds = new Set(state.childSessionIds);
    this.completedAssistantMessageIds = new Set(state.completedAssistantMessageIds);
    this.pendingAssistantResponsesBySessionId = new Map(state.pendingAssistantResponsesBySessionId);
    this.questionRequestIds = new Set(state.questionRequestIds);
    this.permissionRequestIds = new Set(state.permissionRequestIds);
  }

  setOnNotification(callback: NotificationCallback): void {
    this.onNotification = callback;
  }

  clear(): void {
    this.directory = null;
    this.sessionTitles.clear();
    this.sessionDirectories.clear();
    this.childSessionIds.clear();
    this.completedAssistantMessageIds.clear();
    this.pendingAssistantResponsesBySessionId.clear();
    this.questionRequestIds.clear();
    this.permissionRequestIds.clear();
  }

  processEvent(event: Event, currentSessionId: string | null): void {
    switch (event.type) {
      case "session.created":
      case "session.updated":
        this.handleSessionInfo(event.properties);
        break;
      case "message.updated":
        this.handleMessageUpdated(event.properties, currentSessionId);
        break;
      case "session.idle":
        this.handleSessionIdle(event.properties, currentSessionId);
        break;
      case "question.asked":
        this.handleRequestEvent("question_asked", event.properties, currentSessionId);
        break;
      case "permission.asked":
        this.handleRequestEvent("permission_asked", event.properties, currentSessionId);
        break;
      default:
        break;
    }
  }

  private handleSessionInfo(properties: { info: Session }): void {
    const info = properties.info;
    if (!info?.id) {
      return;
    }

    const title = info.title?.trim();
    if (title) {
      this.sessionTitles.set(info.id, title);
    }

    const directory = info.directory?.trim();
    if (directory) {
      this.sessionDirectories.set(info.id, directory);
    }

    if (info.parentID) {
      this.childSessionIds.add(info.id);
    }
  }

  private handleMessageUpdated(
    properties: { info: Message },
    currentSessionId: string | null,
  ): void {
    const info = properties.info;
    const sessionId = info?.sessionID;
    const messageId = info?.id;
    if (!sessionId || !messageId || info?.role !== "assistant" || !info.time?.completed) {
      return;
    }

    if (this.shouldIgnoreSession(sessionId, currentSessionId)) {
      return;
    }

    if (this.completedAssistantMessageIds.has(messageId)) {
      return;
    }

    this.completedAssistantMessageIds.add(messageId);
    this.pendingAssistantResponsesBySessionId.set(sessionId, { messageId });
  }

  private handleSessionIdle(
    properties: { sessionID: string },
    currentSessionId: string | null,
  ): void {
    const sessionId = properties.sessionID;
    if (!sessionId || this.shouldIgnoreSession(sessionId, currentSessionId)) {
      return;
    }

    const pendingResponse = this.pendingAssistantResponsesBySessionId.get(sessionId);
    if (!pendingResponse) {
      return;
    }

    this.pendingAssistantResponsesBySessionId.delete(sessionId);
    logger.info(
      `[BackgroundSessionTracker] Assistant replied in a background session: session=${sessionId}, followed=${getCurrentSession()?.id ?? "none"}`,
    );
    this.emitNotification({
      kind: "assistant_response",
      sessionId,
      sessionTitle: this.sessionTitles.get(sessionId),
      sessionDirectory: this.sessionDirectory(sessionId),
      messageId: pendingResponse.messageId,
    });
  }

  private handleRequestEvent(
    kind: Extract<BackgroundSessionNotificationKind, "question_asked" | "permission_asked">,
    properties: { id: string; sessionID: string },
    currentSessionId: string | null,
  ): void {
    const { id, sessionID: sessionId } = properties;
    if (!id || !sessionId) {
      return;
    }

    if (this.shouldIgnoreSession(sessionId, currentSessionId)) {
      return;
    }

    const deliveredRequestIds =
      kind === "question_asked" ? this.questionRequestIds : this.permissionRequestIds;
    if (deliveredRequestIds.has(id)) {
      return;
    }

    deliveredRequestIds.add(id);
    this.emitNotification({
      kind,
      sessionId,
      sessionTitle: this.sessionTitles.get(sessionId),
      sessionDirectory: this.sessionDirectory(sessionId),
      requestId: id,
    });
  }

  /** The session's own folder, or the one being tracked when its event carried none. */
  private sessionDirectory(sessionId: string): string | undefined {
    return this.sessionDirectories.get(sessionId) ?? this.directory ?? undefined;
  }

  private shouldIgnoreSession(sessionId: string, currentSessionId: string | null): boolean {
    return (
      sessionId === currentSessionId ||
      this.childSessionIds.has(sessionId) ||
      isScheduledTaskSessionIgnored(sessionId)
    );
  }

  private emitNotification(notification: BackgroundSessionNotification): void {
    if (!this.onNotification) {
      return;
    }

    const callback = this.onNotification;
    setImmediate(() => {
      Promise.resolve(callback(notification)).catch((error) => {
        logger.error("[BackgroundSessionTracker] Failed to deliver notification:", error);
      });
    });
  }
}

export { BackgroundSessionTracker };
