import type { AssistantMessage, Event, Part, Session, ToolState } from "@opencode-ai/sdk/v2";
import type { FormInfo, OpenCodeEvent, SessionInboxItem } from "@opencode/client";
import {
  toolContentText,
  toV1ErrorPayload,
  toV1Permission,
  toV1Question,
  toV1ToolInput,
  toV1ToolMetadata,
  toV1ToolName,
} from "./mappers.js";

/** A translated event in the envelope shape of the V1 global event stream. */
export interface V1GlobalEvent {
  directory?: string;
  payload: Event;
}

type ToolInput = Record<string, unknown>;

/** A V1 idle, plus the mark of an execution that was interrupted rather than finished. */
type IdleEventProperties = Extract<Event, { type: "session.idle" }>["properties"] & {
  interrupted?: true;
  /** Why the execution stopped. Present only on an interrupted idle. */
  reason?: "user" | "shutdown" | "superseded" | "inactivity";
};

/**
 * A V1 connect, plus whether the server behind it is another process than the one the
 * previous connection reached; absent when that cannot be told.
 */
export interface ConnectedEventProperties {
  restarted?: boolean;
}

interface AssistantMessageState {
  sessionID: string;
  created: number;
  streamed?: number;
  agent: string;
  providerID: string;
  modelID: string;
  variant?: string;
}

interface ToolCallState {
  sessionID: string;
  messageID: string;
  tool: string;
  input: ToolInput;
  metadata: Record<string, unknown>;
  start: number;
}

/** A tool V2 reported done at launch while the operation it started keeps running. */
interface BackgroundCallState extends ToolCallState {
  callID: string;
  output: string;
}

interface SessionState {
  directory?: string;
  projectID?: string;
  parentID?: string;
  title?: string;
  created?: number;
}

export interface V2EventTranslatorOptions {
  /** Receives every form the stream announces, so replies can map answers back. */
  onForm?: (form: FormInfo) => void;
  /** Inbox items announced so far, kept by the caller across subscriptions. */
  inbox?: Map<string, SessionInboxItem>;
}

/**
 * Translates the V2 event stream into the V1 events the bot consumes. One translator
 * belongs to one subscription, so partial state never leaks across reconnects. Inbox
 * items are the exception when the caller passes them in: a message queued before a
 * reconnect is delivered on the next subscription, and its pickup needs the item.
 */
export function createV2EventTranslator(options: V2EventTranslatorOptions = {}) {
  const sessions = new Map<string, SessionState>();
  const messages = new Map<string, AssistantMessageState>();
  // Stream time that arrived before the step's message state existed.
  const streamedAt = new Map<string, number>();
  const tools = new Map<string, ToolCallState>();
  // Keyed by what announces the real end: `shell:<shell id>` or `session:<child session id>`.
  const backgroundCalls = new Map<string, BackgroundCallState>();
  const inbox = options.inbox ?? new Map<string, SessionInboxItem>();

  const rememberDirectory = (sessionID: string, directory: string | undefined) => {
    if (!directory) {
      return;
    }
    const state = sessions.get(sessionID) ?? {};
    state.directory = directory;
    sessions.set(sessionID, state);
  };

  const toSession = (sessionID: string, now: number): Session => {
    const state = sessions.get(sessionID) ?? {};
    return {
      id: sessionID,
      slug: sessionID,
      projectID: state.projectID ?? "",
      directory: state.directory ?? "",
      ...(state.parentID ? { parentID: state.parentID } : {}),
      title: state.title ?? "",
      version: "v2",
      time: { created: state.created ?? now, updated: now },
    };
  };

  const assistantInfo = (
    messageID: string,
    extra: {
      completed?: number;
      tokens?: {
        input: number;
        output: number;
        reasoning: number;
        cache: { read: number; write: number };
      };
      cost?: number;
      finish?: string;
      error?: ReturnType<typeof toV1ErrorPayload>;
    } = {},
  ): Event => {
    const state = messages.get(messageID);
    const sessionID = state?.sessionID ?? "";
    const directory = sessions.get(sessionID)?.directory ?? "";
    return {
      id: `${messageID}:updated`,
      type: "message.updated",
      properties: {
        sessionID,
        info: {
          id: messageID,
          sessionID,
          role: "assistant",
          time: {
            created: state?.created ?? Date.now(),
            ...(extra.completed ? { completed: extra.completed } : {}),
            ...(state?.streamed !== undefined ? { streamed: state.streamed } : {}),
          } as AssistantMessage["time"],
          ...(extra.error ? { error: extra.error } : {}),
          parentID: "",
          modelID: state?.modelID ?? "",
          providerID: state?.providerID ?? "",
          mode: state?.agent ?? "",
          agent: state?.agent ?? "",
          path: { cwd: directory, root: directory },
          cost: extra.cost ?? 0,
          tokens: extra.tokens ?? {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          ...(state?.variant ? { variant: state.variant } : {}),
          ...(extra.finish ? { finish: extra.finish } : {}),
        },
      },
    };
  };

  const partUpdated = (part: Part, time: number): Event => ({
    id: `${part.id}:${time}`,
    type: "message.part.updated",
    properties: { sessionID: part.sessionID, part, time },
  });

  const toolPart = (
    callID: string,
    state: ToolState,
    call: ToolCallState | undefined = tools.get(callID),
  ): Part | null => {
    if (!call) {
      return null;
    }
    return {
      id: callID,
      sessionID: call.sessionID,
      messageID: call.messageID,
      type: "tool",
      callID,
      tool: call.tool,
      state,
    };
  };

  const idleEvents = (
    sessionID: string,
    id: string,
    interrupted = false,
    reason?: IdleEventProperties["reason"],
  ): Event[] => {
    // V1 has no way to say a turn was stopped: the idle of an interrupted execution carries it.
    const idleProperties: IdleEventProperties = interrupted
      ? { sessionID, interrupted: true, ...(reason ? { reason } : {}) }
      : { sessionID };
    return [
      {
        id: `${id}:status`,
        type: "session.status",
        properties: { sessionID, status: { type: "idle" } },
      },
      { id: `${id}:idle`, type: "session.idle", properties: idleProperties },
    ];
  };

  const backgroundKey = (metadata: Record<string, unknown>): string | null => {
    if (typeof metadata.shellID === "string") {
      return `shell:${metadata.shellID}`;
    }
    if (typeof metadata.sessionID === "string") {
      return `session:${metadata.sessionID}`;
    }
    return null;
  };

  /** The completion V2 never sends for a background call, built when its operation ends. */
  const endBackgroundCall = (
    key: string,
    created: number,
    end: { error: string } | { metadata: Record<string, unknown> },
  ): Event[] => {
    const call = backgroundCalls.get(key);
    if (!call) {
      return [];
    }
    backgroundCalls.delete(key);
    const time = { start: call.start, end: created };
    const state: ToolState =
      "error" in end
        ? { status: "error", input: call.input, error: end.error, metadata: call.metadata, time }
        : {
            status: "completed",
            input: call.input,
            output: call.output,
            title: "",
            metadata: { ...call.metadata, ...end.metadata },
            time,
          };
    const part = toolPart(call.callID, state, call);
    return part ? [partUpdated(part, created)] : [];
  };

  const translatePayload = (event: OpenCodeEvent, restarted?: boolean): Event[] => {
    const created =
      "created" in event && typeof event.created === "number" ? event.created : Date.now();

    switch (event.type) {
      case "server.connected": {
        // Calls started before this connection never get a start here: their later events
        // are dropped rather than shown under a made-up name.
        tools.clear();
        const properties: ConnectedEventProperties = restarted === undefined ? {} : { restarted };
        return [{ id: event.id, type: "server.connected", properties } as Event];
      }

      case "session.created": {
        const data = event.data;
        sessions.set(data.sessionID, {
          directory: data.location.directory,
          projectID: data.projectID,
          ...(data.parentID ? { parentID: data.parentID } : {}),
          ...(data.title ? { title: data.title } : {}),
          created,
        });
        return [
          {
            id: event.id,
            type: "session.created",
            properties: { sessionID: data.sessionID, info: toSession(data.sessionID, created) },
          },
        ];
      }

      case "session.renamed": {
        const state = sessions.get(event.data.sessionID) ?? {};
        state.title = event.data.title;
        sessions.set(event.data.sessionID, state);
        return [
          {
            id: event.id,
            type: "session.updated",
            properties: {
              sessionID: event.data.sessionID,
              info: toSession(event.data.sessionID, created),
            },
          },
        ];
      }

      case "session.moved":
        rememberDirectory(event.data.sessionID, event.data.location.directory);
        return [
          {
            id: event.id,
            type: "session.updated",
            properties: {
              sessionID: event.data.sessionID,
              info: toSession(event.data.sessionID, created),
            },
          },
        ];

      case "session.deleted":
        return [
          {
            id: event.id,
            type: "session.deleted",
            properties: {
              sessionID: event.data.sessionID,
              info: toSession(event.data.sessionID, created),
            },
          },
        ];

      case "session.execution.started":
        return [
          {
            id: event.id,
            type: "session.status",
            properties: { sessionID: event.data.sessionID, status: { type: "busy" } },
          },
        ];

      // A background subagent ends with its child session; its parent's task call ends there too.
      case "session.execution.succeeded":
      case "session.execution.interrupted":
        return [
          ...idleEvents(
            event.data.sessionID,
            event.id,
            event.type === "session.execution.interrupted",
            event.type === "session.execution.interrupted" ? event.data.reason : undefined,
          ),
          ...endBackgroundCall(`session:${event.data.sessionID}`, created, { metadata: {} }),
        ];

      case "session.execution.failed":
        return [
          {
            id: `${event.id}:error`,
            type: "session.error",
            properties: {
              sessionID: event.data.sessionID,
              error: toV1ErrorPayload(event.data.error),
            },
          },
          ...idleEvents(event.data.sessionID, event.id),
          ...endBackgroundCall(`session:${event.data.sessionID}`, created, {
            error: event.data.error.message,
          }),
        ];

      case "shell.exited":
        return endBackgroundCall(`shell:${event.data.id}`, created, {
          metadata: {
            status: event.data.status,
            ...(event.data.exit !== undefined ? { exit: event.data.exit } : {}),
          },
        });

      case "session.retry.scheduled":
        return [
          {
            id: event.id,
            type: "session.status",
            properties: {
              sessionID: event.data.sessionID,
              status: {
                type: "retry",
                attempt: event.data.attempt,
                message: event.data.error.message,
                next: event.data.at,
              },
            },
          },
        ];

      case "session.inbox.enqueued":
        inbox.set(event.data.inboxID, event.data.item);
        return [];

      case "session.inbox.cancelled":
        inbox.delete(event.data.inboxID);
        return [];

      case "session.inbox.delivered": {
        const item = inbox.get(event.data.inboxID);
        inbox.delete(event.data.inboxID);
        if (!item || item.type !== "user") {
          return [];
        }
        const { sessionID, inboxID } = event.data;
        return [
          {
            id: `${event.id}:message`,
            type: "message.updated",
            properties: {
              sessionID,
              info: {
                id: inboxID,
                sessionID,
                role: "user",
                time: { created },
                agent: "",
                model: { providerID: "", modelID: "" },
              },
            },
          },
          partUpdated(
            {
              id: `${inboxID}:text`,
              sessionID,
              messageID: inboxID,
              type: "text",
              text: item.payload.text,
            },
            created,
          ),
        ];
      }

      case "session.step.started": {
        const data = event.data;
        const rememberedStreamed = streamedAt.get(data.assistantMessageID);
        streamedAt.delete(data.assistantMessageID);
        messages.set(data.assistantMessageID, {
          sessionID: data.sessionID,
          created: data.started,
          ...(rememberedStreamed !== undefined ? { streamed: rememberedStreamed } : {}),
          agent: data.agent,
          providerID: data.model.providerID,
          modelID: data.model.id,
          ...(data.model.variant ? { variant: data.model.variant } : {}),
        });
        return [
          assistantInfo(data.assistantMessageID),
          partUpdated(
            {
              id: `${data.assistantMessageID}:step-start`,
              sessionID: data.sessionID,
              messageID: data.assistantMessageID,
              type: "step-start",
              ...(data.snapshot ? { snapshot: data.snapshot } : {}),
            },
            created,
          ),
        ];
      }

      case "session.step.ended": {
        const data = event.data;
        const rememberedStreamed = streamedAt.get(data.assistantMessageID);
        const state = messages.get(data.assistantMessageID);
        if (state && rememberedStreamed !== undefined) {
          state.streamed = rememberedStreamed;
        }
        const translated: Event[] = [
          partUpdated(
            {
              id: `${data.assistantMessageID}:step-finish`,
              sessionID: data.sessionID,
              messageID: data.assistantMessageID,
              type: "step-finish",
              reason: data.finish,
              ...(data.snapshot ? { snapshot: data.snapshot } : {}),
              cost: data.cost,
              tokens: data.tokens,
            },
            created,
          ),
          assistantInfo(data.assistantMessageID, {
            completed: created,
            tokens: data.tokens,
            cost: data.cost,
            finish: data.finish,
          }),
        ];
        messages.delete(data.assistantMessageID);
        streamedAt.delete(data.assistantMessageID);
        return translated;
      }

      case "session.step.streamed": {
        const data = event.data;
        const state = messages.get(data.assistantMessageID);
        if (state) {
          state.streamed = created;
        } else {
          streamedAt.set(data.assistantMessageID, created);
        }
        return [];
      }

      case "session.step.failed": {
        const data = event.data;
        const rememberedStreamed = streamedAt.get(data.assistantMessageID);
        const state = messages.get(data.assistantMessageID);
        if (state && rememberedStreamed !== undefined) {
          state.streamed = rememberedStreamed;
        }
        const translated = [
          assistantInfo(data.assistantMessageID, {
            completed: created,
            error: toV1ErrorPayload(data.error),
            ...(data.tokens ? { tokens: data.tokens } : {}),
            ...(data.cost !== undefined ? { cost: data.cost } : {}),
          }),
        ];
        messages.delete(data.assistantMessageID);
        streamedAt.delete(data.assistantMessageID);
        return translated;
      }

      case "session.text.started":
      case "session.text.ended": {
        const data = event.data;
        const text = event.type === "session.text.ended" ? event.data.text : "";
        return [
          partUpdated(
            {
              id: `${data.assistantMessageID}:text:${data.ordinal}`,
              sessionID: data.sessionID,
              messageID: data.assistantMessageID,
              type: "text",
              text,
            },
            created,
          ),
        ];
      }

      case "session.reasoning.started":
      case "session.reasoning.ended": {
        const data = event.data;
        const ended = event.type === "session.reasoning.ended";
        return [
          partUpdated(
            {
              id: `${data.assistantMessageID}:reasoning:${data.ordinal}`,
              sessionID: data.sessionID,
              messageID: data.assistantMessageID,
              type: "reasoning",
              text: ended ? event.data.text : "",
              time: { start: created, ...(ended ? { end: created } : {}) },
            },
            created,
          ),
        ];
      }

      case "session.text.delta":
      case "session.reasoning.delta": {
        const data = event.data;
        const kind = event.type === "session.text.delta" ? "text" : "reasoning";
        return [
          {
            id: event.id,
            type: "message.part.delta",
            properties: {
              sessionID: data.sessionID,
              messageID: data.assistantMessageID,
              partID: `${data.assistantMessageID}:${kind}:${data.ordinal}`,
              field: "text",
              delta: data.delta,
            },
          },
        ];
      }

      case "session.tool.input.started": {
        const data = event.data;
        tools.set(data.id, {
          sessionID: data.sessionID,
          messageID: data.assistantMessageID,
          tool: toV1ToolName(data.name),
          input: {},
          metadata: {},
          start: created,
        });
        const part = toolPart(data.id, { status: "pending", input: {}, raw: "" });
        return part ? [partUpdated(part, created)] : [];
      }

      case "session.tool.called": {
        const data = event.data;
        const call = tools.get(data.id);
        if (!call) {
          return [];
        }
        call.input = toV1ToolInput(call.tool, data.input);
        call.start = created;
        const part = toolPart(data.id, {
          status: "running",
          input: call.input,
          metadata: call.metadata,
          time: { start: call.start },
        });
        return part ? [partUpdated(part, created)] : [];
      }

      case "session.tool.progress": {
        const data = event.data;
        const call = tools.get(data.id);
        if (!call) {
          return [];
        }
        call.metadata = toV1ToolMetadata(call.tool, { ...call.metadata, ...data.metadata });
        const part = toolPart(data.id, {
          status: "running",
          input: call.input,
          metadata: call.metadata,
          time: { start: call.start },
        });
        return part ? [partUpdated(part, created)] : [];
      }

      case "session.tool.success": {
        const data = event.data;
        const call = tools.get(data.id);
        if (!call) {
          return [];
        }
        const metadata = toV1ToolMetadata(call.tool, {
          ...call.metadata,
          ...(data.metadata ?? {}),
        });
        const output = toolContentText(data.content);
        tools.delete(data.id);

        // V2 reports a background command or subagent done as soon as it is launched; it
        // stays a running tool here until the operation itself ends.
        const key = metadata.status === "running" ? backgroundKey(metadata) : null;
        if (key) {
          backgroundCalls.set(key, { ...call, metadata, callID: data.id, output });
          const part = toolPart(
            data.id,
            { status: "running", input: call.input, metadata, time: { start: call.start } },
            call,
          );
          return part ? [partUpdated(part, created)] : [];
        }

        const part = toolPart(
          data.id,
          {
            status: "completed",
            input: call.input,
            output,
            title: "",
            metadata,
            time: { start: call.start, end: created },
          },
          call,
        );
        return part ? [partUpdated(part, created)] : [];
      }

      case "session.tool.failed": {
        const data = event.data;
        const call = tools.get(data.id);
        if (!call) {
          return [];
        }
        const part = toolPart(data.id, {
          status: "error",
          input: call.input,
          error: data.error.message,
          metadata: toV1ToolMetadata(call.tool, { ...call.metadata, ...(data.metadata ?? {}) }),
          time: { start: call.start, end: created },
        });
        tools.delete(data.id);
        return part ? [partUpdated(part, created)] : [];
      }

      case "session.compaction.ended":
        return [
          {
            id: event.id,
            type: "session.compacted",
            properties: { sessionID: event.data.sessionID },
          },
        ];

      case "permission.asked": {
        const request = toV1Permission(event.data);
        return [{ id: event.id, type: "permission.asked", properties: request }];
      }

      case "permission.replied":
        return [
          {
            id: event.id,
            type: "permission.replied",
            properties: {
              sessionID: event.data.sessionID,
              requestID: event.data.requestID,
              reply: event.data.reply,
            },
          },
        ];

      case "form.created": {
        const form = event.data.form as FormInfo;
        options.onForm?.(form);
        return [{ id: event.id, type: "question.asked", properties: toV1Question(form) }];
      }

      case "form.replied":
        return [
          {
            id: event.id,
            type: "question.replied",
            properties: { sessionID: event.data.sessionID, requestID: event.data.id, answers: [] },
          },
        ];

      case "form.cancelled":
        return [
          {
            id: event.id,
            type: "question.rejected",
            properties: { sessionID: event.data.sessionID, requestID: event.data.id },
          },
        ];

      default:
        return [];
    }
  };

  /** `restarted` is the connect event's mark, when the caller could tell. */
  return (event: OpenCodeEvent, restarted?: boolean): V1GlobalEvent[] => {
    const location = "location" in event ? event.location?.directory : undefined;
    const data = "data" in event ? (event.data as { sessionID?: unknown }) : undefined;
    const sessionID = typeof data?.sessionID === "string" ? data.sessionID : undefined;
    if (sessionID) {
      rememberDirectory(sessionID, location);
    }
    const directory = location ?? (sessionID ? sessions.get(sessionID)?.directory : undefined);
    return translatePayload(event, restarted).map((payload) => ({
      ...(directory ? { directory } : {}),
      payload,
    }));
  };
}
