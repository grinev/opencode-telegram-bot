import type { Event } from "@opencode-ai/sdk/v2";
import { isScheduledTaskSessionIgnored } from "../scheduled-task/session-ignore.js";
import { logger } from "../utils/logger.js";

export type BackgroundSessionNotificationKind =
  | "assistant_response"
  | "question_asked"
  | "permission_asked";

export interface BackgroundSessionNotification {
  kind: BackgroundSessionNotificationKind;
  sessionId: string;
  sessionTitle?: string;
  requestId?: string;
  messageId?: string;
}

type NotificationCallback = (notification: BackgroundSessionNotification) => void | Promise<void>;

interface SessionInfoEventProperties {
  info?: {
    id?: string;
    title?: string;
    parentID?: string;
  };
}

interface MessageUpdatedEventProperties {
  info?: {
    id?: string;
    sessionID?: string;
    role?: string;
    time?: {
      completed?: number;
    };
  };
}

interface SessionIdleEventProperties {
  sessionID?: string;
}

interface PendingAssistantResponse {
  messageId: string;
}

class BackgroundSessionTracker {
  private directory: string | null = null;
  private onNotification: NotificationCallback | null = null;
  private sessionTitles = new Map<string, string>();
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

  setOnNotification(callback: NotificationCallback): void {
    this.onNotification = callback;
  }

  clear(): void {
    this.directory = null;
    this.sessionTitles.clear();
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
        this.handleSessionInfo(event.properties as SessionInfoEventProperties);
        break;
      case "message.updated":
        this.handleMessageUpdated(
          event.properties as MessageUpdatedEventProperties,
          currentSessionId,
        );
        break;
      case "session.idle":
        this.handleSessionIdle(event.properties as SessionIdleEventProperties, currentSessionId);
        break;
      case "question.asked":
        this.handleRequestEvent(
          "question_asked",
          event.properties as { id?: string; sessionID?: string },
          currentSessionId,
        );
        break;
      case "permission.asked":
        this.handleRequestEvent(
          "permission_asked",
          event.properties as { id?: string; sessionID?: string },
          currentSessionId,
        );
        break;
      default:
        break;
    }
  }

  private handleSessionInfo(properties: SessionInfoEventProperties): void {
    const info = properties.info;
    if (!info?.id) {
      return;
    }

    const title = info.title?.trim();
    if (title) {
      this.sessionTitles.set(info.id, title);
    }

    if (info.parentID) {
      this.childSessionIds.add(info.id);
    }
  }

  private handleMessageUpdated(
    properties: MessageUpdatedEventProperties,
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
    properties: SessionIdleEventProperties,
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
    this.emitNotification({
      kind: "assistant_response",
      sessionId,
      sessionTitle: this.sessionTitles.get(sessionId),
      messageId: pendingResponse.messageId,
    });
  }

  private handleRequestEvent(
    kind: Extract<BackgroundSessionNotificationKind, "question_asked" | "permission_asked">,
    properties: { id?: string; sessionID?: string },
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
      requestId: id,
    });
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
export const backgroundSessionTracker = new BackgroundSessionTracker();
