import { opencodeClient } from "./client.js";
import { Event } from "@opencode-ai/sdk/v2";
import { logger } from "../utils/logger.js";

type EventCallback = (event: Event) => void;

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 15000;
const FATAL_NO_STREAM_ERROR = "No stream returned from event subscription";

let eventStream: AsyncGenerator<Event, unknown, unknown> | null = null;
let eventCallback: EventCallback | null = null;
let isListening = false;
let activeDirectory: string | null = null;
let streamAbortController: AbortController | null = null;
let listenerGeneration = 0;

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

    while (isListening && activeDirectory === directory && !controller.signal.aborted) {
      try {
        const result = await opencodeClient.event.subscribe(
          { directory },
          { signal: controller.signal },
        );

        if (!result.stream) {
          throw new Error(FATAL_NO_STREAM_ERROR);
        }

        reconnectAttempt = 0;
        eventStream = result.stream;

        for await (const event of eventStream) {
          if (!isListening || activeDirectory !== directory || controller.signal.aborted) {
            logger.debug(`Event listener stopped or changed directory, breaking loop`);
            break;
          }

          // CRITICAL: Explicitly yield to the event loop BEFORE processing the event
          // This allows grammY to handle getUpdates between SSE events
          await new Promise<void>((resolve) => setImmediate(resolve));

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

              callbackSnapshot(event);
            });
          }
        }

        eventStream = null;

        if (!isListening || activeDirectory !== directory || controller.signal.aborted) {
          break;
        }

        reconnectAttempt++;
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
        const reconnectDelay = getReconnectDelayMs(reconnectAttempt);
        logger.error(
          `Event stream error for ${directory}, reconnecting in ${reconnectDelay}ms (attempt=${reconnectAttempt})`,
          error,
        );

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

    logger.error("Event stream error:", error);
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
