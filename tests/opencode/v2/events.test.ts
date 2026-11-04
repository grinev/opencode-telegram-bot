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
  it("marks the idle of an interrupted execution and only that one", () => {
    const translate = createV2EventTranslator();

    const [interrupted, succeeded, failed] = [
      "session.execution.interrupted",
      "session.execution.succeeded",
      "session.execution.failed",
    ].map((type) =>
      payloads(translate, [
        event(
          type,
          type === "session.execution.failed"
            ? { sessionID: SESSION, error: { type: "unknown", message: "boom" } }
            : { sessionID: SESSION },
          false,
        ),
      ]).find((item) => item.type === "session.idle"),
    );

    expect(interrupted?.properties).toEqual({ sessionID: SESSION, interrupted: true });
    expect(succeeded?.properties).toEqual({ sessionID: SESSION });
    expect(failed?.properties).toEqual({ sessionID: SESSION });
  });

  it("carries the interrupt reason on the idle", () => {
    const translate = createV2EventTranslator();
    const idle = payloads(translate, [
      event(
        "session.execution.interrupted",
        { sessionID: SESSION, reason: "shutdown" },
        false,
      ),
    ]).find((item) => item.type === "session.idle");

    expect(idle?.properties).toEqual({
      sessionID: SESSION,
      interrupted: true,
      reason: "shutdown",
    });
  });

  it("keeps step stream time on the message update that ends the step", () => {
    const translate = createV2EventTranslator();
    const updated = payloads(translate, [
      event("session.step.started", {
        sessionID: SESSION,
        assistantMessageID: MESSAGE,
        agent: "build",
        model: { providerID: "openai", id: "gpt" },
        started: 100,
      }),
      event("session.step.streamed", { sessionID: SESSION, assistantMessageID: MESSAGE }),
      event("session.step.ended", {
        sessionID: SESSION,
        assistantMessageID: MESSAGE,
        finish: "stop",
        cost: 0,
        tokens: { input: 1, output: 4, reasoning: 2, cache: { read: 0, write: 0 } },
      }),
    ]).filter((item) => item.type === "message.updated");

    expect(updated.at(-1)?.properties).toMatchObject({
      info: { time: { created: 100, streamed: 1000, completed: 1000 } },
    });
  });

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

  it("gives a V2 edit and a patch the V1 file-change metadata", () => {
    const translate = createV2EventTranslator();
    const file = { file: "src/a.ts", patch: "+x", status: "modified", additions: 1, deletions: 0 };

    const [, , edited] = payloads(translate, [
      event("session.tool.input.started", {
        sessionID: SESSION,
        assistantMessageID: MESSAGE,
        id: "call-edit",
        name: "edit",
      }),
      event("session.tool.called", {
        sessionID: SESSION,
        assistantMessageID: MESSAGE,
        id: "call-edit",
        input: { path: "src/a.ts" },
        executed: false,
      }),
      event("session.tool.success", {
        sessionID: SESSION,
        assistantMessageID: MESSAGE,
        id: "call-edit",
        content: [],
        metadata: { files: [file] },
        executed: false,
      }),
    ]);
    expect(edited).toMatchObject({
      properties: {
        part: {
          tool: "edit",
          state: { metadata: { diff: "+x", filediff: { file: "src/a.ts", additions: 1 } } },
        },
      },
    });

    const [, , , failed] = payloads(translate, [
      event("session.tool.input.started", {
        sessionID: SESSION,
        assistantMessageID: MESSAGE,
        id: "call-patch",
        name: "patch",
      }),
      event("session.tool.called", {
        sessionID: SESSION,
        assistantMessageID: MESSAGE,
        id: "call-patch",
        input: { patchText: "*** Begin Patch" },
        executed: false,
      }),
      event("session.tool.progress", {
        sessionID: SESSION,
        assistantMessageID: MESSAGE,
        id: "call-patch",
        metadata: { files: [file] },
      }),
      event("session.tool.failed", {
        sessionID: SESSION,
        assistantMessageID: MESSAGE,
        id: "call-patch",
        error: { type: "tool.execution", message: "patch verification failed" },
      }),
    ]);
    expect(failed).toMatchObject({
      properties: {
        part: {
          tool: "apply_patch",
          state: { status: "error", metadata: { files: [{ relativePath: "src/a.ts" }] } },
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

  describe("inbox items kept across subscriptions", () => {
    const enqueued = event("session.inbox.enqueued", {
      sessionID: SESSION,
      inboxID: "msg-user",
      item: { type: "user", payload: { text: "hello" }, delivery: "steer" },
    });
    const delivered = event("session.inbox.delivered", { sessionID: SESSION, inboxID: "msg-user" });

    it("shows a prompt queued on one subscription and delivered on the next as a user message", () => {
      const inbox = new Map();
      payloads(createV2EventTranslator({ inbox }), [enqueued]);

      const result = payloads(createV2EventTranslator({ inbox }), [delivered]);

      expect(result.map((item) => item.type)).toEqual(["message.updated", "message.part.updated"]);
      expect(result[0]).toMatchObject({ properties: { info: { id: "msg-user", role: "user" } } });
      expect(result[1]).toMatchObject({ properties: { part: { text: "hello" } } });
      expect(inbox.size).toBe(0);
    });

    it("forgets a cancelled prompt", () => {
      const inbox = new Map();
      const translate = createV2EventTranslator({ inbox });

      payloads(translate, [
        enqueued,
        event("session.inbox.cancelled", { sessionID: SESSION, inboxID: "msg-user" }),
      ]);

      expect(inbox.size).toBe(0);
      expect(payloads(translate, [delivered])).toEqual([]);
    });

    it("keeps the items to one subscription when none are passed in", () => {
      payloads(createV2EventTranslator(), [enqueued]);

      expect(payloads(createV2EventTranslator(), [delivered])).toEqual([]);
    });
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

    expect(envelope).toBeUndefined();
  });

  it("drops every event of a call it never saw start instead of naming it", () => {
    const translate = createV2EventTranslator();
    const base = { sessionID: SESSION, assistantMessageID: MESSAGE, id: "call-lost" };

    const result = payloads(translate, [
      event("session.tool.called", { ...base, input: { command: "ls" }, executed: false }),
      event("session.tool.progress", { ...base, metadata: { output: "x" } }),
      event("session.tool.success", {
        ...base,
        content: [{ type: "text", text: "done" }],
        executed: true,
      }),
      event("session.tool.failed", {
        ...base,
        error: { type: "unknown", message: "interrupted" },
        executed: false,
      }),
    ]);

    expect(result).toEqual([]);
  });

  it("forgets the calls it knew once the stream connects again", () => {
    const translate = createV2EventTranslator();
    const base = { sessionID: SESSION, assistantMessageID: MESSAGE, id: "call-1" };
    translate(event("session.tool.input.started", { ...base, name: "shell" }));
    translate(event("server.connected", {}));

    const result = payloads(translate, [
      event("session.tool.failed", {
        ...base,
        error: { type: "unknown", message: "interrupted" },
        executed: false,
      }),
    ]);

    expect(result).toEqual([]);
  });

  it("marks the connect event with whether the server restarted, when told", () => {
    const translate = createV2EventTranslator();

    expect(translate(event("server.connected", {}), true)[0]?.payload).toMatchObject({
      type: "server.connected",
      properties: { restarted: true },
    });
    expect(translate(event("server.connected", {}), false)[0]?.payload).toMatchObject({
      properties: { restarted: false },
    });
    expect(translate(event("server.connected", {}))[0]?.payload.properties).toEqual({});
  });

  describe("background operations", () => {
    const base = { sessionID: SESSION, assistantMessageID: MESSAGE, id: "call-bg" };

    function toolStates(result: ReturnType<typeof payloads>) {
      return result
        .filter((item) => item.type === "message.part.updated")
        .map((item) => (item.properties as { part: { state: Record<string, unknown> } }).part.state);
    }

    function launchShell(translate: ReturnType<typeof createV2EventTranslator>) {
      return payloads(translate, [
        event("session.tool.input.started", { ...base, name: "shell" }),
        event("session.tool.called", {
          ...base,
          input: { command: "sleep 90", background: true },
          executed: false,
        }),
        event("session.tool.success", {
          ...base,
          content: [{ type: "text", text: "Command moved to the background" }],
          metadata: { shellID: "sh-1", status: "running" },
          executed: false,
        }),
      ]);
    }

    it("keeps a background command running when V2 reports it done at launch", () => {
      const translate = createV2EventTranslator();

      const states = toolStates(launchShell(translate));

      expect(states.map((state) => state.status)).toEqual(["pending", "running", "running"]);
      expect(states[2]).toMatchObject({
        input: { command: "sleep 90", background: true },
        metadata: { shellID: "sh-1", status: "running" },
      });
    });

    it("completes the background command when its shell exits", () => {
      const translate = createV2EventTranslator();
      launchShell(translate);

      const result = payloads(translate, [
        event("shell.exited", { id: "sh-other", exit: 0, status: "exited" }),
        event("shell.exited", { id: "sh-1", exit: 0, status: "exited" }),
        event("shell.exited", { id: "sh-1", exit: 0, status: "exited" }),
      ]);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        properties: {
          part: {
            callID: "call-bg",
            tool: "bash",
            sessionID: SESSION,
            messageID: MESSAGE,
            state: {
              status: "completed",
              output: "Command moved to the background",
              metadata: { shellID: "sh-1", status: "exited", exit: 0 },
              time: { start: 1000, end: 1000 },
            },
          },
        },
      });
    });

    it("leaves a command that finished before its success as an ordinary completion", () => {
      const translate = createV2EventTranslator();

      const result = payloads(translate, [
        event("session.tool.input.started", { ...base, name: "shell" }),
        event("session.tool.success", {
          ...base,
          content: [],
          metadata: { shellID: "sh-1", status: "completed" },
          executed: false,
        }),
      ]);

      expect(toolStates(result).map((state) => state.status)).toEqual(["pending", "completed"]);
    });

    function launchSubagent(translate: ReturnType<typeof createV2EventTranslator>) {
      return payloads(translate, [
        event("session.tool.input.started", { ...base, name: "subagent" }),
        event("session.tool.called", {
          ...base,
          input: { description: "Scan", agent: "general", background: true },
          executed: false,
        }),
        event("session.tool.success", {
          ...base,
          content: [{ type: "text", text: "The subagent is working in the background" }],
          metadata: { sessionID: "child-1", status: "running" },
          executed: false,
        }),
      ]);
    }

    it("keeps a background subagent's task running and names its child session", () => {
      const translate = createV2EventTranslator();

      const states = toolStates(launchSubagent(translate));

      expect(states[2]).toMatchObject({
        status: "running",
        input: { background: true },
        metadata: { sessionID: "child-1", sessionId: "child-1" },
      });
    });

    it("names the child session of a foreground subagent while it runs and when it ends", () => {
      const translate = createV2EventTranslator();

      const states = toolStates(
        payloads(translate, [
          event("session.tool.input.started", { ...base, name: "subagent" }),
          event("session.tool.called", {
            ...base,
            input: { description: "Scan", agent: "general" },
            executed: false,
          }),
          event("session.tool.progress", { ...base, metadata: { sessionID: "child-1" } }),
          event("session.tool.success", {
            ...base,
            content: [{ type: "text", text: "Done" }],
            metadata: { sessionID: "child-1" },
            executed: true,
          }),
        ]),
      );

      expect(states[2]).toMatchObject({
        status: "running",
        metadata: { sessionID: "child-1", sessionId: "child-1" },
      });
      expect(states[3]).toMatchObject({
        status: "completed",
        metadata: { sessionID: "child-1", sessionId: "child-1" },
      });
    });

    it("completes the parent's task after the child session ends", () => {
      const translate = createV2EventTranslator();
      launchSubagent(translate);

      const result = payloads(translate, [
        event("session.execution.succeeded", { sessionID: "child-1" }, false),
      ]);

      expect(result.map((item) => item.type)).toEqual([
        "session.status",
        "session.idle",
        "message.part.updated",
      ]);
      expect(result[1]).toMatchObject({ properties: { sessionID: "child-1" } });
      expect(result[2]).toMatchObject({
        properties: {
          part: { callID: "call-bg", tool: "task", sessionID: SESSION, state: { status: "completed" } },
        },
      });
    });

    it("fails the parent's task when the child session fails", () => {
      const translate = createV2EventTranslator();
      launchSubagent(translate);

      const result = payloads(translate, [
        event(
          "session.execution.failed",
          { sessionID: "child-1", error: { type: "unknown", message: "boom" } },
          false,
        ),
      ]);

      expect(result.at(-1)).toMatchObject({
        properties: { part: { callID: "call-bg", state: { status: "error", error: "boom" } } },
      });
    });
  });
});
