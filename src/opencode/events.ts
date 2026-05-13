import { opencodeClient } from "./client.js";
import { Event } from "@opencode-ai/sdk/v2";
import { logger } from "../utils/logger.js";
import { isExpectedOpencodeUnavailableError } from "../utils/opencode-error.js";

type EventCallback = (event: Event) => void;
type EventStreamSource = "global" | "legacy";
type EventStreamSubscription = {
  source: EventStreamSource;
  stream: AsyncGenerator<unknown, unknown, unknown>;
};
type EventSubscriptionResult = {
  stream?: AsyncGenerator<unknown, unknown, unknown> | null;
};
type OptionalGlobalEventApi = {
  event?: (options?: { signal?: AbortSignal }) => Promise<EventSubscriptionResult>;
};
type OptionalGlobalEventClient = {
  global?: OptionalGlobalEventApi;
};

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 15000;
const FATAL_NO_STREAM_ERROR = "No stream returned from event subscription";

let eventStream: AsyncGenerator<unknown, unknown, unknown> | null = null;
let eventCallback: EventCallback | null = null;
let isListening = false;
let activeDirectory: string | null = null;
let streamAbortController: AbortController | null = null;
let listenerGeneration = 0;

// SSE health tracking — a silently dead stream cannot be detected from inside
// the for-await loop (no events arrive). Expose timestamps + reconnect counter
// so an external watchdog can decide when to forcibly restart the subscription.
let lastSseEventTime = 0;
let consecutiveReconnectAttempts = 0;

function getReconnectDelayMs(attempt: number): number {
  const exponentialDelay = RECONNECT_BASE_DELAY_MS * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(exponentialDelay, RECONNECT_MAX_DELAY_MS);
}

function waitWithAbort(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }

    const onAbort = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      resolve(false);
    };

    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEventLike(value: unknown): value is Event {
  return isRecord(value) && typeof value.type === "string" && isRecord(value.properties);
}

function normalizeDirectoryForComparison(directory: string): string {
  const normalized = directory.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-z]:/i.test(normalized) ? normalized.toLowerCase() : normalized;
}

function isSameDirectory(left: string, right: string): boolean {
  return normalizeDirectoryForComparison(left) === normalizeDirectoryForComparison(right);
}

function normalizeGlobalEvent(rawEvent: unknown, directory: string): Event | null {
  if (isEventLike(rawEvent)) {
    return rawEvent;
  }

  if (!isRecord(rawEvent) || !("payload" in rawEvent)) {
    logger.debug("[Events] Ignoring global event with unknown shape");
    return null;
  }

  const eventDirectory = typeof rawEvent.directory === "string" ? rawEvent.directory : null;
  if (eventDirectory && !isSameDirectory(eventDirectory, directory)) {
    return null;
  }

  if (!isEventLike(rawEvent.payload)) {
    logger.debug("[Events] Ignoring global event with unknown payload shape");
    return null;
  }

  return rawEvent.payload;
}

function normalizeEvent(rawEvent: unknown, source: EventStreamSource, directory: string): Event | null {
  if (source === "global") {
    return normalizeGlobalEvent(rawEvent, directory);
  }

  if (!isEventLike(rawEvent)) {
    logger.debug("[Events] Ignoring legacy event with unknown shape");
    return null;
  }

  return rawEvent;
}

async function subscribeToGlobalEventStream(signal: AbortSignal): Promise<EventStreamSubscription> {
  const globalEvents = (opencodeClient as OptionalGlobalEventClient).global;
  if (!globalEvents?.event) {
    throw new Error("Global event subscription is not available");
  }

  const result = await globalEvents.event({ signal });
  if (!result.stream) {
    throw new Error(FATAL_NO_STREAM_ERROR);
  }

  return { source: "global", stream: result.stream };
}

async function subscribeToLegacyEventStream(
  directory: string,
  signal: AbortSignal,
): Promise<EventStreamSubscription> {
  const result = await opencodeClient.event.subscribe({ directory }, { signal });

  if (!result.stream) {
    throw new Error(FATAL_NO_STREAM_ERROR);
  }

  return { source: "legacy", stream: result.stream };
}

export async function subscribeToEvents(directory: string, callback: EventCallback): Promise<void> {
  if (isListening && activeDirectory === directory) {
    eventCallback = callback;
    logger.debug(`Event listener already running for ${directory}`);
    return;
  }

  if (isListening && activeDirectory !== directory) {
    logger.info(`Stopping event listener for ${activeDirectory}, starting for ${directory}`);
    streamAbortController?.abort();
    streamAbortController = null;
    isListening = false;
    activeDirectory = null;
  }

  const controller = new AbortController();
  const generation = ++listenerGeneration;

  activeDirectory = directory;
  eventCallback = callback;
  isListening = true;
  streamAbortController = controller;

  try {
    let reconnectAttempt = 0;
    let useLegacyEventsOnce = false;

    while (isListening && activeDirectory === directory && !controller.signal.aborted) {
      try {
        let subscription: EventStreamSubscription;
        if (useLegacyEventsOnce) {
          useLegacyEventsOnce = false;
          subscription = await subscribeToLegacyEventStream(directory, controller.signal);
        } else {
          try {
            subscription = await subscribeToGlobalEventStream(controller.signal);
            logger.debug(`Using global OpenCode event stream for ${directory}`);
          } catch (error) {
            if (controller.signal.aborted || !isListening || activeDirectory !== directory) {
              throw error;
            }

            if (isExpectedOpencodeUnavailableError(error)) {
              throw error;
            }

            logger.warn(
              `Global event stream unavailable for ${directory}, falling back to project event stream`,
              error,
            );
            subscription = await subscribeToLegacyEventStream(directory, controller.signal);
          }
        }

        reconnectAttempt = 0;
        eventStream = subscription.stream;
        let usefulEventCount = 0;

        for await (const event of eventStream) {
          if (!isListening || activeDirectory !== directory || controller.signal.aborted) {
            logger.debug(`Event listener stopped or changed directory, breaking loop`);
            break;
          }

          // Mark stream as healthy: any event proves the SSE channel is alive.
          lastSseEventTime = Date.now();
          consecutiveReconnectAttempts = 0;

          // CRITICAL: Explicitly yield to the event loop BEFORE processing the event
          // This allows grammY to handle getUpdates between SSE events
          await new Promise<void>((resolve) => setImmediate(resolve));

          const normalizedEvent = normalizeEvent(event, subscription.source, directory);
          if (!normalizedEvent) {
            continue;
          }

          if (normalizedEvent.type !== "server.connected") {
            usefulEventCount++;
          }

          if (eventCallback) {
            // Use setImmediate to avoid blocking the event loop
            // and let grammY process incoming Telegram updates
            const callbackSnapshot = eventCallback;
            setImmediate(() => {
              if (
                streamAbortController !== controller ||
                controller.signal.aborted ||
                !isListening ||
                activeDirectory !== directory ||
                listenerGeneration !== generation
              ) {
                return;
              }

              callbackSnapshot(normalizedEvent);
            });
          }
        }

        eventStream = null;

        if (!isListening || activeDirectory !== directory || controller.signal.aborted) {
          break;
        }

        if (subscription.source === "global" && usefulEventCount === 0) {
          useLegacyEventsOnce = true;
          logger.warn(
            `Global event stream ended without project events for ${directory}, falling back to project event stream`,
          );
          continue;
        }

        reconnectAttempt++;
        consecutiveReconnectAttempts++;
        const reconnectDelay = getReconnectDelayMs(reconnectAttempt);
        logger.warn(
          `Event stream ended for ${directory}, reconnecting in ${reconnectDelay}ms (attempt=${reconnectAttempt})`,
        );

        const shouldContinue = await waitWithAbort(reconnectDelay, controller.signal);
        if (!shouldContinue) {
          break;
        }
      } catch (error) {
        eventStream = null;

        if (controller.signal.aborted || !isListening || activeDirectory !== directory) {
          logger.info("Event listener aborted");
          return;
        }

        if (error instanceof Error && error.message === FATAL_NO_STREAM_ERROR) {
          logger.error("Event stream fatal error:", error);
          throw error;
        }

        reconnectAttempt++;
        consecutiveReconnectAttempts++;
        const reconnectDelay = getReconnectDelayMs(reconnectAttempt);
        if (isExpectedOpencodeUnavailableError(error)) {
          logger.warn(
            `Event stream unavailable for ${directory}, reconnecting in ${reconnectDelay}ms (attempt=${reconnectAttempt})`,
          );
        } else {
          logger.error(
            `Event stream error for ${directory}, reconnecting in ${reconnectDelay}ms (attempt=${reconnectAttempt})`,
            error,
          );
        }

        const shouldContinue = await waitWithAbort(reconnectDelay, controller.signal);
        if (!shouldContinue) {
          break;
        }
      }
    }
  } catch (error) {
    if (controller.signal.aborted) {
      logger.info("Event listener aborted");
      return;
    }

    if (isExpectedOpencodeUnavailableError(error)) {
      logger.warn("Event stream unavailable; listener stopped");
    } else {
      logger.error("Event stream error:", error);
    }
    isListening = false;
    activeDirectory = null;
    streamAbortController = null;
    throw error;
  } finally {
    if (streamAbortController === controller) {
      if (isListening && activeDirectory === directory && !controller.signal.aborted) {
        logger.warn(`Event stream ended for ${directory}, listener marked as disconnected`);
      }

      streamAbortController = null;
      eventStream = null;
      eventCallback = null;
      isListening = false;
      activeDirectory = null;
    }
  }
}

export function stopEventListening(): void {
  listenerGeneration++;
  streamAbortController?.abort();
  streamAbortController = null;
  isListening = false;
  eventCallback = null;
  eventStream = null;
  activeDirectory = null;
  logger.info("Event listener stopped");
}

export function getLastSseEventTime(): number {
  return lastSseEventTime;
}

export function getConsecutiveReconnectAttempts(): number {
  return consecutiveReconnectAttempts;
}

export function isEventListening(): boolean {
  return isListening;
}

export function getActiveEventDirectory(): string | null {
  return activeDirectory;
}
