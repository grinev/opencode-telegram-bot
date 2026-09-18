import type { Event } from "@opencode-ai/sdk/v2";
import { opencodeClient } from "./client.js";
import { logger } from "../utils/logger.js";
import { isRecord } from "../utils/type-guards.js";

type EventCallback = (event: Event) => void;
type EventSubscriptionResult = {
  stream?: AsyncGenerator<unknown, unknown, unknown> | null;
};
type OptionalGlobalEventClient = {
  global?: {
    event?: (options?: { signal?: AbortSignal }) => Promise<EventSubscriptionResult>;
  };
};

const FATAL_NO_STREAM_ERROR = "No stream returned from event subscription";
const RECONNECT_BASE_DELAY_MS = 1000;

function isEventLike(value: unknown): value is Event {
  return (
    isRecord(value) &&
    typeof (value as { type?: unknown }).type === "string" &&
    isRecord((value as { properties?: unknown }).properties)
  );
}

function waitWithAbort(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const timeout = setTimeout(() => resolve(true), ms);
    const onAbort = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      resolve(false);
    };
    signal.addEventListener("abort", onAbort);
  });
}

let abortController: AbortController | null = null;
let callback: EventCallback | null = null;

/**
 * Unfiltered global event stream from ALL projects/directories.
 * Used exclusively by cross-project auto-follow detection - independent
 * lifecycle from the filtered subscribeToEvents pipeline.
 */
export async function subscribeToAllSessionEvents(cb: EventCallback): Promise<void> {
  callback = cb;
  if (abortController) {
    return; // already streaming; callback reference updated above
  }

  const controller = new AbortController();
  abortController = controller;

  while (abortController === controller && !controller.signal.aborted) {
    try {
      const client = opencodeClient as OptionalGlobalEventClient;
      if (!client.global?.event) {
        throw new Error(FATAL_NO_STREAM_ERROR);
      }
      const result = await client.global.event({ signal: controller.signal });
      if (!result.stream) {
        throw new Error(FATAL_NO_STREAM_ERROR);
      }
      logger.debug("[AllEvents] Global unfiltered stream connected");

      for (;;) {
        if (controller.signal.aborted) break;
        const read = await result.stream.next();
        if (read.done || controller.signal.aborted) break;

        const raw = read.value as unknown;
        let payload: unknown = raw;
        if (
          isRecord(raw) &&
          "payload" in raw &&
          isEventLike((raw as { payload: unknown }).payload)
        ) {
          payload = (raw as { payload: unknown }).payload;
        }
        if (isEventLike(payload) && callback) {
          callback(payload);
        }
      }
    } catch (error) {
      if (controller.signal.aborted || abortController !== controller) break;
      logger.warn("[AllEvents] Stream error, reconnecting:", error);
    }

    if (abortController !== controller || controller.signal.aborted) break;
    await waitWithAbort(RECONNECT_BASE_DELAY_MS, controller.signal);
  }
}

export function stopAllSessionEvents(): void {
  abortController?.abort();
  abortController = null;
  callback = null;
}
