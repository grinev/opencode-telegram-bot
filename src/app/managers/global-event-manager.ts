import { Bot, Context } from "grammy";
import { Event } from "@opencode-ai/sdk/v2";
import { subscribeToAllSessionEvents, stopAllSessionEvents } from "../../opencode/all-events.js";
import { logger } from "../../utils/logger.js";
import { isRecord } from "../../utils/type-guards.js";
import { backgroundSessionTracker } from "./background-session-manager.js";
import { externalUserInputSuppressionManager } from "./external-input-suppression-manager.js";
import { summaryAggregator } from "./summary-aggregation-manager.js";
import { getCurrentSession } from "../services/session-service.js";
import { getCurrentProject } from "../stores/settings-store.js";
import { deliverExternalUserInputNotification } from "../../bot/messages/external-user-input-notification.js";
import { safeBackgroundTask } from "../../utils/safe-background-task.js";

interface MessageUpdatedProperties {
  info?: {
    id?: string;
    sessionID?: string;
    role?: string;
    text?: string;
    time?: { completed?: number };
  };
}

interface SessionStatusProperties {
  sessionID?: string;
  info?: { id?: string; status?: { type?: string } };
  status?: { type?: string };
}

interface GlobalEventManagerDeps {
  bot: Bot<Context>;
  chatId: number;
}

function isMessageUpdatedProperties(properties: unknown): properties is MessageUpdatedProperties {
  return isRecord(properties) && ("info" in properties);
}

function isSessionStatusProperties(properties: unknown): properties is SessionStatusProperties {
  return isRecord(properties) && ("sessionID" in properties || "info" in properties || "status" in properties);
}

function extractSessionIdFromProperties(props: Record<string, unknown>, eventType: string): string | null {
  if (typeof props.sessionID === "string") return props.sessionID;
  if (isRecord(props.info) && typeof props.info.sessionID === "string") return props.info.sessionID;
  if (eventType.startsWith("session.") && isRecord(props.info) && typeof props.info.id === "string") return props.info.id;
  if ("sessionID" in props && typeof (props as { sessionID?: unknown }).sessionID === "string") {
    return (props as { sessionID?: string }).sessionID!;
  }
  return null;
}

class GlobalEventManager {
  private bot: Bot<Context> | null = null;
  private chatId: number | null = null;
  private isRunning = false;
  private currentProjectDirectory: string | null = null;

  setDependencies(deps: GlobalEventManagerDeps): void {
    this.bot = deps.bot;
    this.chatId = deps.chatId;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.debug("[GlobalEvents] Already running");
      return;
    }

    this.isRunning = true;
    logger.info("[GlobalEvents] Starting global event subscription");

    // Subscribe to global unfiltered events
    await subscribeToAllSessionEvents(this.handleGlobalEvent.bind(this));
  }

  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    logger.info("[GlobalEvents] Stopping global event subscription");
    stopAllSessionEvents();
  }

  private handleGlobalEvent = (event: Event): void => {
    if (!this.bot || !this.chatId) {
      return;
    }

    const currentSession = getCurrentSession();
    const currentProject = getCurrentProject();

    // Update current project directory for reference
    if (currentProject) {
      this.currentProjectDirectory = currentProject.worktree;
    }

    // Process event through background session tracker for notifications
    backgroundSessionTracker.processEvent(event, currentSession?.id ?? null);

    // Handle external user input (prompts from OpenCode CLI/TUI)
    if (event.type === "message.updated") {
      this.handleExternalUserInput(event);
    }

    // Handle session status changes for auto-follow
    if (event.type === "session.status") {
      this.handleSessionStatus(event);
    }

    // Forward relevant events to summary aggregator for current session
    this.forwardToSummaryAggregator(event, currentSession?.id ?? null);
  };

  private handleExternalUserInput(event: Event): void {
    if (!isMessageUpdatedProperties(event.properties)) {
      return;
    }
    const info = event.properties.info;
    if (!info || info.role !== "user") {
      return;
    }

    const sessionId = info.sessionID;
    const messageId = info.id;
    const messageText = info.text?.trim();

    if (!sessionId || !messageId || !messageText) {
      return;
    }

    const currentSession = getCurrentSession();

    // Skip if this is the current session (already handled by normal flow)
    if (currentSession && currentSession.id === sessionId) {
      return;
    }

    // Skip if it's a child session (subagent)
    if (summaryAggregator.isSubagentSession(sessionId)) {
      return;
    }

    // Check if this external input was already sent by us (suppression)
    if (externalUserInputSuppressionManager.consume(sessionId, messageText)) {
      logger.debug(`[GlobalEvents] Suppressed duplicate external input for session ${sessionId}`);
      return;
    }

    logger.info(`[GlobalEvents] External user input detected: session=${sessionId}, messageId=${messageId}`);

    // Deliver notification to Telegram
    safeBackgroundTask({
      taskName: "global_events.deliver_external_input",
      task: async () => {
        try {
          await deliverExternalUserInputNotification({
            api: this.bot!.api,
            chatId: this.chatId!,
            currentSessionId: currentSession?.id ?? null,
            sessionId,
            text: messageText,
            consumeSuppressedInput: (incomingSessionId, incomingText) =>
              externalUserInputSuppressionManager.consume(incomingSessionId, incomingText),
          });
        } catch (err) {
          logger.error("[GlobalEvents] Failed to deliver external user input:", err);
        }
      },
    });
  }

  private handleSessionStatus(event: Event): void {
    if (!isSessionStatusProperties(event.properties)) {
      return;
    }
    const sessionId = event.properties.sessionID || event.properties.info?.id;
    const status = event.properties.status?.type || event.properties.info?.status?.type;

    if (!sessionId || status !== "busy") {
      return;
    }

    const currentSession = getCurrentSession();

    // Skip if this is already the current session
    if (currentSession && currentSession.id === sessionId) {
      return;
    }

    // Auto-follow logic is handled by subscribeToAllSessionEvents internally
    // But we can add custom handling here if needed
    logger.debug(`[GlobalEvents] Session went busy: ${sessionId}`);
  }

  private forwardToSummaryAggregator(event: Event, currentSessionId: string | null): void {
    // Only forward events for the current session to the summary aggregator
    // The summary aggregator already filters by currentSessionId internally
    // But we can help by not sending irrelevant events

    if (isRecord(event.properties)) {
      const eventSessionId = extractSessionIdFromProperties(event.properties, event.type);
      if (eventSessionId && currentSessionId && eventSessionId !== currentSessionId) {
        // Check if it's a subagent of current session
        if (!summaryAggregator.isSubagentSession(eventSessionId)) {
          return; // Not relevant to current session
        }
      }
    }

    // Process through summary aggregator
    summaryAggregator.processEvent(event);
  }

  // Public method to get current state
  getState(): { isRunning: boolean; currentProjectDirectory: string | null } {
    return {
      isRunning: this.isRunning,
      currentProjectDirectory: this.currentProjectDirectory,
    };
  }
}

export const globalEventManager = new GlobalEventManager();