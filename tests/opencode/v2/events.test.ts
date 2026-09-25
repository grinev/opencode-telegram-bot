import { describe, expect, it, vi } from "vitest";
import type { OpenCodeEvent } from "@opencode/client";
import { createV2EventTranslator } from "../../../src/opencode/v2/events.js";

const DIRECTORY = "D:/repo";
const SESSION = "ses-1";
const MESSAGE = "msg-a";

function event(type: string, data: Record<string, unknown>, located = true): OpenCodeEvent {
  return {
    id: `evt-${type}`,
    created: 1000,
    type,
    data,
    ...(located ? { location: { directory: DIRECTORY } } : {}),
  } as unknown as OpenCodeEvent;
}

function payloads(translate: ReturnType<typeof createV2EventTranslator>, events: OpenCodeEvent[]) {
  return events.flatMap((item) => translate(item)).map((envelope) => envelope.payload);
}

describe("opencode/v2/events", () => {
  it("turns a streamed V2 reply into the V1 message and part events", () => {
    const translate = createV2EventTranslator();

    const result = payloads(translate, [
      event("session.execution.started", { sessionID: SESSION }, false),
      event("session.step.started", {
        sessionID: SESSION,
        assistantMessageID: MESSAGE,
        agent: "build",
        model: { id: "m", providerID: "p" },
        started: 900,
      }),
      event("session.text.started", {
        sessionID: SESSION,
        assistantMessageID: MESSAGE,
        ordinal: 0,
      }),
      event("session.text.delta", {
        sessionID: SESSION,
        assistantMessageID: MESSAGE,
        ordinal: 0,
        delta: "DO",
      }),
      event("session.text.ended", {
        sessionID: SESSION,
        assistantMessageID: MESSAGE,
        ordinal: 0,
        text: "DONE",
      }),
      event("session.step.ended", {
        sessionID: SESSION,
        assistantMessageID: MESSAGE,
        finish: "stop",
        cost: 0.1,
        tokens: { input: 5, output: 1, reasoning: 0, cache: { read: 2, write: 0 } },
      }),
      event("session.execution.succeeded", { sessionID: SESSION }, false),
    ]);

    expect(result.map((item) => item.type)).toEqual([
      "session.status",
      "message.updated",
      "message.part.updated",
      "message.part.updated",
      "message.part.delta",
      "message.part.updated",
      "message.part.updated",
      "message.updated",
      "session.status",
      "session.idle",
    ]);
    expect(result[0]).toMatchObject({ properties: { status: { type: "busy" } } });
    expect(result[1]).toMatchObject({
      properties: { info: { id: MESSAGE, role: "assistant", agent: "build", providerID: "p" } },
    });
    expect(result[4]).toMatchObject({
      properties: { messageID: MESSAGE, partID: `${MESSAGE}:text:0`, delta: "DO" },
    });
    expect(result[5]).toMatchObject({ properties: { part: { type: "text", text: "DONE" } } });
    expect(result[7]).toMatchObject({
      properties: { info: { time: { completed: 1000 }, cost: 0.1, tokens: { input: 5 } } },
    });
  });

  it("follows a tool call from input to result under its V1 name", () => {
    const translate = createV2EventTranslator();
    const base = { sessionID: SESSION, assistantMessageID: MESSAGE, id: "call-1" };

    const result = payloads(translate, [
      event("session.tool.input.started", { ...base, name: "read" }),
      event("session.tool.called", { ...base, input: { path: "a.txt" }, executed: false }),
      event("session.tool.success", {
        ...base,
        content: [{ type: "text", text: "1: hello" }],
        metadata: { truncated: false },
        executed: false,
      }),
    ]);

    expect(
      result.map(
        (item) => (item.properties as { part: { state: { status: string } } }).part.state.status,
      ),
    ).toEqual(["pending", "running", "completed"]);
    expect(result[2]).toMatchObject({
      properties: {
        part: {
          type: "tool",
          tool: "read",
          callID: "call-1",
          state: { input: { filePath: "a.txt" }, output: "1: hello" },
        },
      },
    });
  });

  it("reports a failed run as a session error followed by idle", () => {
    const translate = createV2EventTranslator();

    const result = payloads(translate, [
      event(
        "session.execution.failed",
        { sessionID: SESSION, error: { type: "provider.no-route", message: "Model unavailable" } },
        false,
      ),
    ]);

    expect(result.map((item) => item.type)).toEqual([
      "session.error",
      "session.status",
      "session.idle",
    ]);
    expect(result[0]).toMatchObject({
      properties: { sessionID: SESSION, error: { data: { message: "Model unavailable" } } },
    });
  });

  it("shows a delivered prompt as a V1 user message", () => {
    const translate = createV2EventTranslator();

    const result = payloads(translate, [
      event("session.inbox.enqueued", {
        sessionID: SESSION,
        inboxID: "msg-user",
        item: { type: "user", payload: { text: "hello" }, delivery: "queue" },
      }),
      event("session.inbox.delivered", { sessionID: SESSION, inboxID: "msg-user" }),
    ]);

    expect(result.map((item) => item.type)).toEqual(["message.updated", "message.part.updated"]);
    expect(result[0]).toMatchObject({ properties: { info: { id: "msg-user", role: "user" } } });
    expect(result[1]).toMatchObject({ properties: { part: { text: "hello" } } });
  });

  it("turns V2 permissions and forms into V1 permission and question events", () => {
    const onForm = vi.fn();
    const translate = createV2EventTranslator({ onForm });
    const form = {
      id: "form-1",
      sessionID: SESSION,
      title: "Continue?",
      fields: [{ key: "go", type: "boolean" }],
    };

    const result = payloads(translate, [
      event("permission.asked", {
        id: "perm-1",
        sessionID: SESSION,
        action: "shell",
        resources: ["npm test"],
        save: ["npm *"],
      }),
      event("permission.replied", { sessionID: SESSION, requestID: "perm-1", reply: "always" }),
      event("form.created", { form }),
      event("form.cancelled", { id: "form-1", sessionID: SESSION }),
    ]);

    expect(result[0]).toMatchObject({
      type: "permission.asked",
      properties: { id: "perm-1", permission: "shell", patterns: ["npm test"], always: ["npm *"] },
    });
    expect(result[1]).toMatchObject({
      type: "permission.replied",
      properties: { requestID: "perm-1", reply: "always" },
    });
    expect(result[2]).toMatchObject({ type: "question.asked", properties: { id: "form-1" } });
    expect(onForm).toHaveBeenCalledWith(form);
    expect(result[3]).toMatchObject({
      type: "question.rejected",
      properties: { requestID: "form-1" },
    });
  });

  it("carries the session directory onto events that arrive without a location", () => {
    const translate = createV2EventTranslator();
    translate(
      event("session.created", {
        sessionID: SESSION,
        projectID: "project",
        location: { directory: DIRECTORY },
        slug: "s",
        parentID: "ses-parent",
        version: "2",
      }),
    );

    const [envelope] = translate(event("session.execution.started", { sessionID: SESSION }, false));

    expect(envelope?.directory).toBe(DIRECTORY);
  });

  it("keeps each subscription's partial state to itself", () => {
    const first = createV2EventTranslator();
    first(
      event("session.tool.input.started", {
        sessionID: SESSION,
        assistantMessageID: MESSAGE,
        id: "call-1",
        name: "shell",
      }),
    );

    const second = createV2EventTranslator();
    const [envelope] = second(
      event("session.tool.called", {
        sessionID: SESSION,
        assistantMessageID: MESSAGE,
        id: "call-1",
        input: { command: "ls" },
        executed: false,
      }),
    );

    expect(envelope?.payload).toMatchObject({ properties: { part: { tool: "unknown" } } });
  });
});
