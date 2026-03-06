import { Event } from "@opencode-ai/sdk/v2";
import { opencodeClient } from "./client.js";
import { logger } from "../utils/logger.js";

type EventCallback = (event: Event) => void | Promise<void>;

interface DirectoryStreamWorker {
  directory: string;
  callbacks: Set<EventCallback>;
  abortController: AbortController;
  loopPromise: Promise<void> | null;
}

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 15000;
const FATAL_NO_STREAM_ERROR = "No stream returned from event subscription";

const workersByDirectory = new Map<string, DirectoryStreamWorker>();

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
      clearTimeout(timeoutId);
      signal.removeEventListener("abort", onAbort);
      resolve(false);
    };

    const timeoutId = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function getOrCreateWorker(directory: string): DirectoryStreamWorker {
  const existingWorker = workersByDirectory.get(directory);
  if (existingWorker) {
    return existingWorker;
  }

  const nextWorker: DirectoryStreamWorker = {
    directory,
    callbacks: new Set<EventCallback>(),
    abortController: new AbortController(),
    loopPromise: null,
  };

  workersByDirectory.set(directory, nextWorker);
  return nextWorker;
}

function dispatchEvent(worker: DirectoryStreamWorker, event: Event): void {
  const callbacks = Array.from(worker.callbacks);
  for (const callback of callbacks) {
    setImmediate(() => {
      try {
        const result = callback(event);
        if (result && typeof (result as PromiseLike<unknown>).then === "function") {
          void (result as PromiseLike<unknown>).then(undefined, (error) => {
            logger.error(
              "[Events] Async callback rejected",
              { directory: worker.directory, eventType: event.type },
              error,
            );
          });
        }
      } catch (error) {
        logger.error(
          "[Events] Event callback failed",
          { directory: worker.directory, eventType: event.type },
          error,
        );
      }
    });
  }
}

async function runWorkerLoop(worker: DirectoryStreamWorker): Promise<void> {
  let reconnectAttempt = 0;
  const { directory, abortController } = worker;

  while (!abortController.signal.aborted && worker.callbacks.size > 0) {
    try {
      const result = await opencodeClient.event.subscribe(
        { directory },
        { signal: abortController.signal },
      );

      if (!result.stream) {
        throw new Error(FATAL_NO_STREAM_ERROR);
      }

      reconnectAttempt = 0;

      for await (const event of result.stream) {
        if (abortController.signal.aborted || worker.callbacks.size === 0) {
          break;
        }

        await new Promise<void>((resolve) => setImmediate(resolve));
        dispatchEvent(worker, event);
      }

      if (abortController.signal.aborted || worker.callbacks.size === 0) {
        break;
      }

      reconnectAttempt++;
      const reconnectDelay = getReconnectDelayMs(reconnectAttempt);
      logger.warn(`[Events] Stream ended, reconnecting`, {
        directory,
        reconnectAttempt,
        reconnectDelay,
      });

      const shouldContinue = await waitWithAbort(reconnectDelay, abortController.signal);
      if (!shouldContinue) {
        break;
      }
    } catch (error) {
      if (abortController.signal.aborted || worker.callbacks.size === 0) {
        break;
      }

      if (error instanceof Error && error.message === FATAL_NO_STREAM_ERROR) {
        logger.error("[Events] Fatal event stream error", { directory }, error);
        break;
      }

      reconnectAttempt++;
      const reconnectDelay = getReconnectDelayMs(reconnectAttempt);
      logger.error(
        `[Events] Stream failed, reconnecting`,
        { directory, reconnectAttempt, reconnectDelay },
        error,
      );

      const shouldContinue = await waitWithAbort(reconnectDelay, abortController.signal);
      if (!shouldContinue) {
        break;
      }
    }
  }
}

function ensureWorkerStarted(worker: DirectoryStreamWorker): void {
  if (worker.loopPromise) {
    return;
  }

  worker.loopPromise = runWorkerLoop(worker)
    .catch((error) => {
      logger.error(
        "[Events] Worker loop failed unexpectedly",
        { directory: worker.directory },
        error,
      );
    })
    .finally(() => {
      worker.loopPromise = null;
      if (worker.callbacks.size === 0 || worker.abortController.signal.aborted) {
        workersByDirectory.delete(worker.directory);
      }
    });
}

export async function subscribeToEvents(directory: string, callback: EventCallback): Promise<void> {
  const worker = getOrCreateWorker(directory);
  worker.callbacks.add(callback);
  ensureWorkerStarted(worker);
}

export function unsubscribeFromEvents(directory: string, callback: EventCallback): void {
  const worker = workersByDirectory.get(directory);
  if (!worker) {
    return;
  }

  worker.callbacks.delete(callback);
  if (worker.callbacks.size > 0) {
    return;
  }

  worker.abortController.abort();
  workersByDirectory.delete(directory);
}

export function stopEventListening(directory?: string): void {
  if (directory) {
    const worker = workersByDirectory.get(directory);
    if (!worker) {
      return;
    }

    worker.abortController.abort();
    workersByDirectory.delete(directory);
    logger.info("[Events] Stopped event listener", { directory });
    return;
  }

  for (const [workerDirectory, worker] of workersByDirectory.entries()) {
    worker.abortController.abort();
    workersByDirectory.delete(workerDirectory);
  }

  logger.info("[Events] Stopped all event listeners");
}
