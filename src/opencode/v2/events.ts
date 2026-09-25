import type { Event, Part, Session, ToolState } from "@opencode-ai/sdk/v2";
import type { FormInfo, OpenCodeEvent, SessionInboxItem } from "@opencode/client";
import {
  toolContentText,
  toV1ErrorPayload,
  toV1Permission,
  toV1Question,
  toV1ToolInput,
  toV1ToolName,
} from "./mappers.js";

/** A translated event in the envelope shape of the V1 global event stream. */
export interface V1GlobalEvent {
  directory?: string;
  payload: Event;
}

type ToolInput = Record<string, unknown>;

interface AssistantMessageState {
  sessionID: string;
  created: number;
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
}

/**
 * Translates the V2 event stream into the V1 events the bot consumes. One translator
 * belongs to one subscription, so partial state never leaks across reconnects.
 */
export function createV2EventTranslator(options: V2EventTranslatorOptions = {}) {
  const sessions = new Map<string, SessionState>();
  const messages = new Map<string, AssistantMessageState>();
  const tools = new Map<string, ToolCallState>();
  const inbox = new Map<string, SessionInboxItem>();

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
          },
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

  const toolPart = (callID: string, state: ToolState): Part | null => {
    const call = tools.get(callID);
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

  const ensureToolCall = (
    sessionID: string,
    messageID: string,
    callID: string,
    created: number,
  ) => {
    let call = tools.get(callID);
    if (!call) {
      call = { sessionID, messageID, tool: "unknown", input: {}, metadata: {}, start: created };
      tools.set(callID, call);
    }
    return call;
  };

  const idleEvents = (sessionID: string, id: string): Event[] => [
    {
      id: `${id}:status`,
      type: "session.status",
      properties: { sessionID, status: { type: "idle" } },
    },
    { id: `${id}:idle`, type: "session.idle", properties: { sessionID } },
  ];

  const translatePayload = (event: OpenCodeEvent): Event[] => {
    const created =
      "created" in event && typeof event.created === "number" ? event.created : Date.now();

    switch (event.type) {
      case "server.connected":
        return [{ id: event.id, type: "server.connected", properties: {} }];

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

      case "session.execution.succeeded":
      case "session.execution.interrupted":
        return idleEvents(event.data.sessionID, event.id);

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
        ];

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
        messages.set(data.assistantMessageID, {
          sessionID: data.sessionID,
          created: data.started,
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
        return translated;
      }

      case "session.step.failed": {
        const data = event.data;
        const translated = [
          assistantInfo(data.assistantMessageID, {
            completed: created,
            error: toV1ErrorPayload(data.error),
            ...(data.tokens ? { tokens: data.tokens } : {}),
            ...(data.cost !== undefined ? { cost: data.cost } : {}),
          }),
        ];
        messages.delete(data.assistantMessageID);
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
        const call = ensureToolCall(data.sessionID, data.assistantMessageID, data.id, created);
        call.tool = toV1ToolName(data.name);
        const part = toolPart(data.id, { status: "pending", input: {}, raw: "" });
        return part ? [partUpdated(part, created)] : [];
      }

      case "session.tool.called": {
        const data = event.data;
        const call = ensureToolCall(data.sessionID, data.assistantMessageID, data.id, created);
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
        const call = ensureToolCall(data.sessionID, data.assistantMessageID, data.id, created);
        call.metadata = { ...call.metadata, ...data.metadata };
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
        const call = ensureToolCall(data.sessionID, data.assistantMessageID, data.id, created);
        const part = toolPart(data.id, {
          status: "completed",
          input: call.input,
          output: toolContentText(data.content),
          title: "",
          metadata: { ...call.metadata, ...(data.metadata ?? {}) },
          time: { start: call.start, end: created },
        });
        tools.delete(data.id);
        return part ? [partUpdated(part, created)] : [];
      }

      case "session.tool.failed": {
        const data = event.data;
        const call = ensureToolCall(data.sessionID, data.assistantMessageID, data.id, created);
        const part = toolPart(data.id, {
          status: "error",
          input: call.input,
          error: data.error.message,
          metadata: { ...call.metadata, ...(data.metadata ?? {}) },
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

  return (event: OpenCodeEvent): V1GlobalEvent[] => {
    const location = "location" in event ? event.location?.directory : undefined;
    const data = "data" in event ? (event.data as { sessionID?: unknown }) : undefined;
    const sessionID = typeof data?.sessionID === "string" ? data.sessionID : undefined;
    if (sessionID) {
      rememberDirectory(sessionID, location);
    }
    const directory = location ?? (sessionID ? sessions.get(sessionID)?.directory : undefined);
    return translatePayload(event).map((payload) => ({
      ...(directory ? { directory } : {}),
      payload,
    }));
  };
}
