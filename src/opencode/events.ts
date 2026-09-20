import { opencodeV2 } from "./client.js";
import { logger } from "../utils/logger.js";
import { isRecord } from "../utils/type-guards.js";
import { isExpectedOpencodeUnavailableError } from "../utils/opencode-error.js";

// Bridge event: v2 envelope {type, data, location?} reshaped into the
// legacy {type, properties} form the bot's managers consume.
// Type names are translated where v2 renamed them; unknown types pass
// through untouched with properties = data.
export interface BotEvent {
  type: string;
  properties: Record<string, unknown>;
}

type EventCallback = (event: BotEvent) => void;
type EventStreamSource = "v2";
type EventStreamSubscription = {
  source: EventStreamSource;
  stream: AsyncGenerator<unknown, unknown, unknown>;
};

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 15000;
let sseIdleTimeoutMs = 30_000;
const FATAL_NO_STREAM_ERROR = "No stream returned from event subscription";
const SSE_IDLE_TIMEOUT_ERROR = "SSE stream idle timeout";

let eventStream: AsyncGenerator<unknown, unknown, unknown> | null = null;
let eventCallback: EventCallback | null = null;
let isListening = false;
let activeDirectory: string | null = null;
let streamAbortController: AbortController | null = null;
let listenerGeneration = 0;
let consecutiveTimeouts = 0;

// Tool calls stream across several events (input.started -> input.ended ->
// called -> success/failed). Track the tool name and parsed input by callID so
// `called`/`success` can be reshaped into a single message.part.updated.
const toolNameByCallId = new Map<string, string>();
const toolInputByCallId = new Map<string, Record<string, unknown>>();

type StreamReadResult =
  | { type: "next"; result: IteratorResult<unknown, unknown> }
  | { type: "error"; error: unknown }
  | { type: "aborted" }
  | { type: "timeout" };

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

function createAttemptAbortController(parentSignal: AbortSignal): {
  controller: AbortController;
  cleanup: () => void;
} {
  const controller = new AbortController();

  if (parentSignal.aborted) {
    controller.abort();
    return { controller, cleanup: () => {} };
  }

  const onAbort = () => controller.abort();
  parentSignal.addEventListener("abort", onAbort, { once: true });

  return {
    controller,
    cleanup: () => parentSignal.removeEventListener("abort", onAbort),
  };
}

function readStreamWithIdleTimeout(
  stream: AsyncGenerator<unknown, unknown, unknown>,
  signal: AbortSignal,
): Promise<StreamReadResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: StreamReadResult) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      resolve(result);
    };

    const onAbort = () => finish({ type: "aborted" });
    const timeout = setTimeout(() => finish({ type: "timeout" }), sseIdleTimeoutMs);

    if (signal.aborted) {
      finish({ type: "aborted" });
      return;
    }

    signal.addEventListener("abort", onAbort, { once: true });

    stream.next().then(
      (result) => finish({ type: "next", result }),
      (error) => finish({ type: "error", error }),
    );
  });
}

function isEventStreamIdleTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.message === SSE_IDLE_TIMEOUT_ERROR;
}

function isV2Envelope(value: unknown): value is {
  type: string;
  data?: unknown;
  location?: { directory?: string };
} {
  return (
    isRecord(value) &&
    typeof value.type === "string" &&
    (value.data === undefined || isRecord(value.data) || value.data === null)
  );
}

function asProperties(data: unknown): Record<string, unknown> {
  return isRecord(data) ? data : {};
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function normalizeDirectoryForComparison(directory: string): string {
  const normalized = directory.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-z]:/i.test(normalized) ? normalized.toLowerCase() : normalized;
}

function isSameDirectory(left: string, right: string): boolean {
  return normalizeDirectoryForComparison(left) === normalizeDirectoryForComparison(right);
}

// v2 tool inputs use `path` where the legacy aggregator reads `filePath`
// (write/edit). Normalize so the file-attachment pipeline works unchanged.
function normalizeToolInput(tool: string, input: Record<string, unknown>): Record<string, unknown> {
  if ((tool === "write" || tool === "edit") && input.filePath === undefined && typeof input.path === "string") {
    return { ...input, filePath: input.path };
  }
  return input;
}

// v2 `session.tool.success` carries diff info under `metadata.files[0]`
// ({file, patch, additions, deletions}); the legacy aggregator expects
// `metadata.filediff` + `metadata.diff`. Rebuild the legacy shape.
function buildToolMetadata(tool: string, metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (tool !== "edit" && tool !== "apply_patch") {
    return undefined;
  }
  const files = Array.isArray(metadata?.files) ? metadata.files : [];
  const first = isRecord(files[0]) ? files[0] : undefined;
  if (!first) {
    return undefined;
  }
  const file = str(first.file);
  const patch = str(first.patch);
  if (!file || !patch) {
    return undefined;
  }
  return {
    filediff: {
      file,
      additions: num(first.additions) ?? 0,
      deletions: num(first.deletions) ?? 0,
    },
    diff: patch,
  };
}

function buildToolPart(
  data: Record<string, unknown>,
  status: string,
  tool: string,
  input: Record<string, unknown>,
  metadata?: Record<string, unknown>,
): BotEvent | null {
  const sessionID = str(data.sessionID);
  const messageID = str(data.assistantMessageID);
  const callID = str(data.id);
  if (!sessionID || !messageID || !callID) {
    return null;
  }
  return {
    type: "message.part.updated",
    properties: {
      part: {
        type: "tool",
        sessionID,
        messageID,
        id: callID,
        tool,
        callID,
        state: {
          status,
          input,
          ...(metadata !== undefined ? { metadata } : {}),
        },
      },
    },
  };
}

function translateV2Event(type: string, data: Record<string, unknown>): BotEvent | null {
  const sessionID = str(data.sessionID);
  switch (type) {
    case "session.text.delta":
    case "session.reasoning.delta": {
      const assistantMessageID = str(data.assistantMessageID);
      const ordinal = num(data.ordinal) ?? 0;
      const delta = str(data.delta);
      if (!sessionID || !assistantMessageID || !delta) {
        return null;
      }
      return {
        type: "message.part.delta",
        properties: {
          sessionID,
          messageID: assistantMessageID,
          partID: `text-${ordinal}`,
          delta,
          type: type === "session.reasoning.delta" ? "reasoning" : "text",
        },
      };
    }
    case "session.execution.succeeded":
    case "session.execution.interrupted": {
      if (!sessionID) {
        return null;
      }
      return { type: "session.idle", properties: { sessionID } };
    }
    case "session.execution.failed": {
      if (!sessionID) {
        return null;
      }
      return { type: "session.error", properties: { sessionID, error: data.error } };
    }
    case "session.retry.scheduled": {
      if (!sessionID) {
        return null;
      }
      const error = isRecord(data.error) ? data.error : {};
      return {
        type: "session.status",
        properties: {
          sessionID,
          status: {
            type: "retry",
            message: str(error.message) ?? "Unknown retry error",
            attempt: num(data.attempt),
            next: num(data.at),
          },
        },
      };
    }
    case "session.step.started": {
      if (!sessionID) {
        return null;
      }
      return { type: "session.status", properties: { sessionID, status: { type: "busy" } } };
    }
    case "permission.asked": {
      const id = str(data.id);
      if (!id || !sessionID) {
        return null;
      }
      const source = isRecord(data.source) ? data.source : {};
      return {
        type: "permission.asked",
        properties: {
          id,
          sessionID,
          permission: data.action,
          patterns: Array.isArray(data.resources) ? data.resources : [],
          metadata: asProperties(data.metadata),
          always: Array.isArray(data.save) ? data.save : [],
          tool: {
            messageID: str(source.messageID) ?? "",
            callID: str(source.id) ?? "",
          },
        },
      };
    }
    case "question.asked": {
      const id = str(data.id);
      if (!id || !sessionID) {
        return null;
      }
      return { type: "question.asked", properties: { id, sessionID, questions: data.questions } };
    }
    case "session.created": {
      if (!sessionID) {
        return null;
      }
      const location = isRecord(data.location) ? data.location : {};
      return {
        type: "session.created",
        properties: {
          ...data,
          info: {
            id: sessionID,
            directory: str(location.directory),
            time: { updated: num(data.created) ?? Date.now() },
          },
        },
      };
    }
    case "session.compaction.ended": {
      if (!sessionID) {
        return null;
      }
      return { type: "session.compacted", properties: { sessionID } };
    }
    case "session.tool.input.started": {
      const callID = str(data.id);
      const name = str(data.name);
      if (callID && name) {
        toolNameByCallId.set(callID, name);
      }
      // Input-only lifecycle event; the real tool part is emitted on `called`.
      return null;
    }
    case "session.tool.called": {
      const callID = str(data.id);
      if (!callID) {
        return null;
      }
      const tool = toolNameByCallId.get(callID);
      if (!tool) {
        return null;
      }
      const input = isRecord(data.input) ? data.input : {};
      toolInputByCallId.set(callID, input);
      return buildToolPart(data, "running", tool, normalizeToolInput(tool, input));
    }
    case "session.tool.success": {
      const callID = str(data.id);
      if (!callID) {
        return null;
      }
      const tool = toolNameByCallId.get(callID);
      if (!tool) {
        return null;
      }
      const rawInput = toolInputByCallId.get(callID) ?? {};
      const input = normalizeToolInput(tool, rawInput);
      const metadata = buildToolMetadata(tool, isRecord(data.metadata) ? data.metadata : undefined);
      return buildToolPart(data, "completed", tool, input, metadata);
    }
    case "session.tool.failed": {
      const callID = str(data.id);
      if (!callID) {
        return null;
      }
      const tool = toolNameByCallId.get(callID);
      if (!tool) {
        return null;
      }
      const input = normalizeToolInput(tool, toolInputByCallId.get(callID) ?? {});
      return buildToolPart(data, "error", tool, input);
    }
    default:
      // passthrough: same type name, properties = data (v2 kept most names).
      return { type, properties: { ...data } };
  }
}

function normalizeEvent(rawEvent: unknown, directory: string): BotEvent | null {
  if (!isV2Envelope(rawEvent)) {
    logger.debug("[Events] Ignoring event with unknown shape");
    return null;
  }

  // v2 events carry location.directory; events without location (execution,
  // usage, deletion) are kept — downstream matches by sessionID.
  const eventDirectory =
    rawEvent.location && typeof rawEvent.location.directory === "string"
      ? rawEvent.location.directory
      : null;
  if (eventDirectory && !isSameDirectory(eventDirectory, directory)) {
    return null;
  }

  return translateV2Event(rawEvent.type, asProperties(rawEvent.data));
}

async function subscribeToEventStream(_signal: AbortSignal): Promise<EventStreamSubscription> {
  const result = await opencodeV2.event.subscribe();
  const stream = (result as unknown as { stream?: AsyncGenerator<unknown, unknown, unknown> })
    .stream;
  if (!stream) {
    throw new Error(FATAL_NO_STREAM_ERROR);
  }

  return { source: "v2", stream };
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
      let attemptAbort: ReturnType<typeof createAttemptAbortController> | null = null;
      try {
        attemptAbort = createAttemptAbortController(controller.signal);
        let subscription: EventStreamSubscription;
        try {
          subscription = await subscribeToEventStream(attemptAbort.controller.signal);
          logger.debug(`Using v2 OpenCode event stream for ${directory}`);
        } catch (error) {
          if (controller.signal.aborted || !isListening || activeDirectory !== directory) {
            throw error;
          }

          if (isExpectedOpencodeUnavailableError(error)) {
            throw error;
          }

          logger.warn(`Event stream unavailable for ${directory}, will retry`, error);
          throw error;
        }

        reconnectAttempt = 0;
        consecutiveTimeouts = 0;
        eventStream = subscription.stream;

        try {
          while (isListening && activeDirectory === directory && !controller.signal.aborted) {
            const readResult = await readStreamWithIdleTimeout(
              eventStream,
              attemptAbort.controller.signal,
            );

            if (readResult.type === "aborted") {
              logger.debug(`Event listener stopped or changed directory, breaking loop`);
              break;
            }

            if (readResult.type === "timeout") {
              attemptAbort.controller.abort();
              const closeStream = eventStream.return?.(undefined);
              void closeStream?.catch(() => undefined);
              throw new Error(SSE_IDLE_TIMEOUT_ERROR);
            }

            if (readResult.type === "error") {
              throw readResult.error;
            }

            if (readResult.result.done) {
              break;
            }

            const event = readResult.result.value;

            // CRITICAL: Explicitly yield to the event loop BEFORE processing the event
            // This allows grammY to handle getUpdates between SSE events
            await new Promise<void>((resolve) => setImmediate(resolve));

            const normalizedEvent = normalizeEvent(event, directory);
            if (!normalizedEvent) {
              continue;
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

                try {
                  callbackSnapshot(normalizedEvent);
                } catch (error) {
                  logger.error("[Events] Callback failed:", error);
                }
              });
            }
          }
        } finally {
          attemptAbort.cleanup();
        }

        eventStream = null;

        if (!isListening || activeDirectory !== directory || controller.signal.aborted) {
          break;
        }

        reconnectAttempt++;
        consecutiveTimeouts = 0;
        const reconnectDelay = getReconnectDelayMs(reconnectAttempt);
        logger.warn(
          `Event stream ended for ${directory}, reconnecting in ${reconnectDelay}ms (attempt=${reconnectAttempt})`,
        );

        const shouldContinue = await waitWithAbort(reconnectDelay, controller.signal);
        if (!shouldContinue) {
          break;
        }
      } catch (error) {
        attemptAbort?.cleanup();
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
        consecutiveTimeouts++;
        const reconnectDelay = getReconnectDelayMs(reconnectAttempt);
        if (isEventStreamIdleTimeoutError(error)) {
          const timeoutWarning =
            consecutiveTimeouts >= 5
              ? ` (${consecutiveTimeouts} consecutive timeouts — OpenCode server may be unreachable)`
              : "";
          logger.warn(
            `Event stream idle timeout for ${directory}, reconnecting in ${reconnectDelay}ms (attempt=${reconnectAttempt})${timeoutWarning}`,
          );
        } else if (isExpectedOpencodeUnavailableError(error)) {
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

export function __setSseIdleTimeoutForTests(timeoutMs: number): void {
  sseIdleTimeoutMs = timeoutMs;
}
