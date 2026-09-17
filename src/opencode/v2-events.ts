import type {
  OpenCodeClient,
  V2Event,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  ToolContent,
  ToolContent1,
} from "@opencode/client";
import type { Event as LegacyEvent } from "@opencode-ai/sdk/v2";
import { emptyTokens, mapForm, mapMessage, mapPermission, mapSession } from "./v2-mappers.js";

type WithoutID<T> = T extends { id: string } ? Omit<T, "id"> : never;
type Event = WithoutID<LegacyEvent>;

function mapContent(item: ToolContent1): ToolContent {
  return item.type === "text"
    ? item
    : {
        type: "file",
        uri: item.uri,
        mime: item.mime,
        ...(item.name ? { name: item.name } : {}),
      };
}

/** One converter per subscription: partial messages never leak across reconnects. */
export function createV2EventMapper(client: OpenCodeClient, signal?: AbortSignal) {
  const messages = new Map<string, SessionMessageAssistant>();
  const recovering = new Set<string>();
  const directories = new Map<string, string>();
  const requestOptions = signal ? { signal } : undefined;

  function clearSession(sessionID: string) {
    for (const id of messages.keys()) {
      if (id.startsWith(`${sessionID}:`)) {
        messages.delete(id);
        recovering.delete(id);
      }
    }
    directories.delete(sessionID);
  }

  async function snapshot(
    sessionID: string,
    messageID: string,
    completed = true,
  ): Promise<Event[]> {
    const [session, message] = await Promise.all([
      client.session.get({ sessionID }, requestOptions),
      client.session.message.get({ sessionID, messageID }, requestOptions),
    ]);
    if (!completed && message.type === "assistant") {
      message.time = { created: message.time.created };
      messages.set(`${sessionID}:${messageID}`, message);
      recovering.add(`${sessionID}:${messageID}`);
    }
    const mapped = mapMessage(message, session);
    if (!mapped) return [];
    const parts = mapped.parts.map((part): Event => ({
      type: "message.part.updated",
      properties: { sessionID, part, time: Date.now() },
    }));
    const info: Event = { type: "message.updated", properties: { sessionID, info: mapped.info } };
    return mapped.info.role === "user" || !completed ? [info, ...parts] : [...parts, info];
  }

  function publish(sessionID: string, message: SessionMessageAssistant): Event[] {
    const mapped = mapMessage(message, {
      id: sessionID,
      location: { directory: directories.get(sessionID) ?? "" },
    });
    if (!mapped) return [];
    const info: Event = { type: "message.updated", properties: { sessionID, info: mapped.info } };
    const parts = mapped.parts.map((part): Event => ({
      type: "message.part.updated",
      properties: { sessionID, part, time: Date.now() },
    }));
    return [info, ...parts];
  }

  return async (event: V2Event): Promise<Event[]> => {
    switch (event.type) {
      case "server.connected":
        return [{ type: "server.connected", properties: {} }];
      case "session.status":
        return [{ type: "session.status", properties: event.data }];
      case "session.retry.scheduled":
        return [
          {
            type: "session.status",
            properties: {
              sessionID: event.data["sessionID"],
              status: {
                type: "retry",
                attempt: event.data.attempt,
                message: event.data.error.message,
                next: event.data.at,
              },
            },
          },
        ];
      case "session.execution.started":
        return [
          {
            type: "session.status",
            properties: {
              sessionID: event.data["sessionID"],
              status: { type: "busy" },
            },
          },
        ];
      case "session.execution.succeeded":
      case "session.execution.interrupted":
      case "session.idle": {
        clearSession(event.data.sessionID);
        return [
          {
            type: "session.status",
            properties: { sessionID: event.data["sessionID"], status: { type: "idle" } },
          },
          { type: "session.idle", properties: { sessionID: event.data["sessionID"] } },
        ];
      }
      case "session.execution.failed":
        clearSession(event.data.sessionID);
        return [
          {
            type: "session.error",
            properties: {
              sessionID: event.data["sessionID"],
              error: { name: "UnknownError", data: { message: event.data.error.message } },
            },
          },
          {
            type: "session.status",
            properties: { sessionID: event.data["sessionID"], status: { type: "idle" } },
          },
          { type: "session.idle", properties: { sessionID: event.data["sessionID"] } },
        ];
      case "session.created":
      case "session.renamed":
      case "session.model.selected":
      case "session.agent.selected":
      case "session.moved": {
        const session = await client.session.get(
          { sessionID: event.data["sessionID"] },
          requestOptions,
        );
        return [
          {
            type: event.type === "session.created" ? "session.created" : "session.updated",
            properties: { sessionID: session["id"], info: mapSession(session) },
          },
        ];
      }
      case "permission.asked":
        return [{ type: "permission.asked", properties: mapPermission(event.data) }];
      case "permission.replied":
        return [{ type: "permission.replied", properties: event.data }];
      case "form.created":
        return [{ type: "question.asked", properties: mapForm(event.data.form) }];
      case "form.replied":
        return [
          {
            type: "question.replied",
            properties: {
              sessionID: event.data["sessionID"],
              requestID: event.data.id,
              answers: Object.values(event.data.answer).map((value) =>
                Array.isArray(value) ? value : [String(value)],
              ),
            },
          },
        ];
      case "form.cancelled":
        return [
          {
            type: "question.rejected",
            properties: {
              sessionID: event.data["sessionID"],
              requestID: event.data.id,
            },
          },
        ];
      case "session.compaction.ended":
        return [{ type: "session.compacted", properties: { sessionID: event.data["sessionID"] } }];
      case "session.inbox.delivered":
        // Delivered inbox IDs are the IDs of their projected user messages.
        return snapshot(event.data.sessionID, event.data.inboxID);
    }

    if (!("assistantMessageID" in event.data) || !("sessionID" in event.data)) return [];
    const sessionID = String(event.data.sessionID);
    const messageID = String(event.data.assistantMessageID);
    const key = `${sessionID}:${messageID}`;
    if (event.location) directories.set(sessionID, event.location.directory);

    if (event.type === "session.step.started") {
      const message: SessionMessageAssistant = {
        id: messageID,
        type: "assistant",
        agent: event.data.agent,
        model: event.data.model,
        time: { created: event.created },
        content: [],
        tokens: emptyTokens(),
        cost: 0,
      };
      messages.set(key, message);
      recovering.delete(key);
      return [
        ...publish(sessionID, message),
        {
          type: "message.part.updated",
          properties: {
            sessionID,
            time: event.created,
            part: {
              id: `${messageID}:step-start`,
              sessionID,
              messageID,
              type: "step-start",
              ...(event.data.snapshot ? { snapshot: event.data.snapshot } : {}),
            },
          },
        },
      ];
    }

    if (event.type === "session.step.ended" || event.type === "session.step.failed") {
      messages.delete(key);
      recovering.delete(key);
      return snapshot(sessionID, messageID);
    }

    const message = messages.get(key);
    if (!message) {
      // A subscription can start in the middle of a step. Read authoritative state
      // and skip this delta, which is already included in the projected message.
      // Do not append future deltas to a snapshot that may be ahead of the stream.
      return snapshot(sessionID, messageID, false);
    }
    if (recovering.has(key)) return [];

    if (event.type === "session.text.started" || event.type === "session.reasoning.started") {
      message.content[event.data.ordinal] =
        event.type === "session.text.started"
          ? { type: "text", text: "" }
          : { type: "reasoning", text: "", time: { created: event.created } };
    } else if (event.type === "session.text.delta" || event.type === "session.reasoning.delta") {
      const part = message.content[event.data.ordinal];
      if (part && (part.type === "text" || part.type === "reasoning"))
        part.text += event.data.delta;
    } else if (event.type === "session.text.ended" || event.type === "session.reasoning.ended") {
      const part = message.content[event.data.ordinal];
      if (part && (part.type === "text" || part.type === "reasoning")) {
        part.text = event.data.text;
        if (part.type === "reasoning")
          part.time = { created: part.time?.created ?? event.created, completed: event.created };
      }
    } else if (event.type === "session.tool.input.started") {
      message.content.push({
        type: "tool",
        id: event.data.id,
        name: event.data.name,
        time: { created: event.created },
        state: { status: "streaming", input: "" },
      });
    } else if ("id" in event.data) {
      const toolID = event.data.id;
      const tool = message.content.find(
        (part): part is SessionMessageAssistantTool => part.type === "tool" && part.id === toolID,
      );
      if (!tool) return [];
      if (event.type === "session.tool.called") {
        tool.time.ran = event.created;
        tool.state = { status: "running", input: event.data.input, metadata: {} };
      } else if (event.type === "session.tool.progress" && tool.state.status === "running") {
        tool.state.metadata = event.data.metadata;
      } else if (event.type === "session.tool.success" || event.type === "session.tool.failed") {
        const input = tool.state.status === "streaming" ? {} : tool.state.input;
        tool.time.completed = event.created;
        if (event.type === "session.tool.success") {
          const [first, ...rest] = event.data.content;
          tool.state = {
            status: "completed",
            input,
            content: [mapContent(first), ...rest.map(mapContent)],
            metadata: event.data.metadata ?? {},
          };
        } else {
          tool.state = {
            status: "error",
            input,
            error: event.data.error,
            metadata: event.data.metadata ?? {},
          };
        }
      } else return [];
    } else return [];
    return publish(sessionID, message);
  };
}

export async function* subscribeV2Events(
  client: OpenCodeClient,
  options?: { signal?: AbortSignal; onActivity?: () => void },
): AsyncGenerator<unknown> {
  const convert = createV2EventMapper(client, options?.signal);
  for await (const event of client.event.subscribe(options)) {
    const converted = await convert(event);
    for (const [index, payload] of converted.entries())
      yield {
        directory: event.location?.directory,
        payload: { ...payload, id: `${event.id}:${index}` },
      };
  }
}
